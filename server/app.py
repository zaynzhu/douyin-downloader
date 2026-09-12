"""FastAPI REST 服务入口。

HTTP 层薄封装：
- 接收 URL，创建 job，返回 job_id
- 实际下载委托给 core.download_service.DownloadService（与 CLI 共用同一编排）

fastapi/uvicorn 是**可选**依赖。若未安装，导入本模块会 ImportError。
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

from auth import CookieManager
from config import ConfigLoader
from control import QueueManager, RateLimiter, RetryHandler
from core.download_service import DownloadService
from server.jobs import JobManager, JobStatus
from storage import Database, FileManager
from utils.logger import setup_logger

logger = setup_logger("REST")

# 静态 Web UI 目录；目录缺失时保持纯 API 模式（守卫见 build_app 末尾）
_STATIC_DIR = Path(__file__).resolve().parent / "static"


class DownloadRequest(BaseModel):
    url: str


class JobResponse(BaseModel):
    job_id: str
    status: str
    url: str


class _ServerDeps:
    """跨请求复用的重量级依赖。

    REST 服务在进程生命周期内只需要一份 FileManager / RateLimiter / RetryHandler /
    QueueManager / CookieManager；每个请求重新构造既浪费又会触发文件系统 mkdir。
    DouyinAPIClient 由于持有 aiohttp.ClientSession，依旧按请求创建，避免跨请求泄漏
    连接状态或触发 "Session is closed" 错误。
    """

    def __init__(self, config: ConfigLoader):
        self.config = config
        # Resolve the cookie file path relative to the config file's directory
        # so the sidecar can find it regardless of its working directory (which
        # on macOS is often '/' when launched by Electron).
        if config.config_path:
            from pathlib import Path

            cookie_file = str(Path(config.config_path).resolve().parent / ".cookies.json")
        else:
            cookie_file = ".cookies.json"
        self.cookie_manager = CookieManager(cookie_file=cookie_file)
        # Load cookies from the config (env var / YAML cookie key) first, then
        # fall back to whatever is already on disk in the cookie file. This
        # ensures that cookies saved by a previous session are picked up on
        # restart even when the config doesn't embed them inline.
        initial_cookies = config.get_cookies()
        if initial_cookies:
            self.cookie_manager.set_cookies(initial_cookies)
        else:
            # Trigger a load from disk so get_cookies() returns the persisted
            # session without requiring a fresh login on every app restart.
            self.cookie_manager.get_cookies()
        self.file_manager = FileManager(config.get("path"))
        self.rate_limiter = RateLimiter(max_per_second=float(config.get("rate_limit", 2) or 2))
        self.retry_handler = RetryHandler(max_retries=int(config.get("retry_times", 3) or 3))
        self.queue_manager = QueueManager(max_workers=int(config.get("thread", 5) or 5))
        # server 与 CLI 各自持有独立的 Database 连接（WAL 支持多连接读写）；
        # 构造是同步的，真正的 initialize/close 在 lifespan 里完成。
        if config.get("database"):
            db_path = config.get("database_path", "dy_downloader.db") or "dy_downloader.db"
            self.database: Optional[Database] = Database(db_path=str(db_path))
        else:
            self.database = None


async def _execute_download(
    url: str, deps: "_ServerDeps", job_id: Optional[str] = None
) -> Dict[str, int]:
    """REST 编排薄壳：复用 _ServerDeps 的共享依赖，委托 DownloadService 执行。

    DownloadError / LoginRequiredError 直接上抛，由 JobManager 落为
    job.error。``database`` 与 ``job_id`` 使 API 任务写入 aweme/history
    并与 job 记录关联（aweme.job_id）。
    """
    service = DownloadService(
        config=deps.config,
        cookie_manager=deps.cookie_manager,
        file_manager=deps.file_manager,
        rate_limiter=deps.rate_limiter,
        retry_handler=deps.retry_handler,
        queue_manager=deps.queue_manager,
        database=deps.database,
        job_id=job_id,
    )
    result = await service.run(url)
    return {
        "total": result.total,
        "success": result.success,
        "failed": result.failed,
        "skipped": result.skipped,
    }


def build_app(config: ConfigLoader) -> FastAPI:
    deps = _ServerDeps(config)

    async def executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return await _execute_download(url, deps, job_id=job_id)

    server_cfg = config.get("server") or {}
    if not isinstance(server_cfg, dict):
        server_cfg = {}
    manager = JobManager(
        executor=executor,
        max_concurrency=int(config.get("thread", 2) or 2),
        max_jobs=int(server_cfg.get("max_jobs") or JobManager.DEFAULT_MAX_JOBS),
        job_ttl_seconds=float(
            server_cfg.get("job_ttl_seconds") or JobManager.DEFAULT_JOB_TTL_SECONDS
        ),
        database=deps.database,
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if deps.database is not None:
            await deps.database.initialize()
            await manager.load_persisted()
        yield
        await manager.shutdown()
        if deps.database is not None:
            await deps.database.close()

    app = FastAPI(
        title="Douyin Downloader API",
        version="1.0",
        description="REST API for dispatching Douyin download jobs.",
        lifespan=lifespan,
    )
    app.state.job_manager = manager
    app.state.deps = deps

    @app.get("/api/v1/health")
    async def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/api/v1/download", response_model=JobResponse)
    async def create_job(req: DownloadRequest) -> JobResponse:
        if not req.url:
            raise HTTPException(status_code=400, detail="url is required")
        job = await manager.submit(req.url)
        return JobResponse(job_id=job.job_id, status=job.status, url=job.url)

    @app.get("/api/v1/jobs/{job_id}")
    async def get_job(job_id: str) -> Dict[str, Any]:
        job = await manager.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        return job.to_dict()

    @app.post("/api/v1/jobs/{job_id}/cancel")
    async def cancel_job(job_id: str) -> Dict[str, Any]:
        job = await manager.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        if job.status in JobStatus.TERMINAL:
            raise HTTPException(status_code=409, detail=f"job already {job.status}")
        await manager.cancel(job_id)
        refreshed = await manager.get(job_id)
        return refreshed.to_dict() if refreshed is not None else {}

    @app.post("/api/v1/jobs/{job_id}/retry", status_code=201, response_model=JobResponse)
    async def retry_job(job_id: str) -> JobResponse:
        """重试 = 用原 URL 提交一个新任务。

        磁盘增量下载保证幂等：已成功的作品会自动跳过，只补失败/缺失的部分。
        """
        job = await manager.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail="job not found")
        if job.status not in JobStatus.TERMINAL:
            raise HTTPException(status_code=409, detail="job still in flight")
        if not job.url:
            raise HTTPException(status_code=400, detail="original url missing")
        new_job = await manager.submit(job.url)
        return JobResponse(job_id=new_job.job_id, status=new_job.status, url=new_job.url)

    @app.get("/api/v1/downloads")
    async def list_downloads(
        page: int = 1,
        size: int = 50,
        author: Optional[str] = None,
        author_sec_uid: Optional[str] = None,
        job_id: Optional[str] = None,
        aweme_type: Optional[str] = None,
        title: Optional[str] = None,
        date_from: Optional[int] = None,
        date_to: Optional[int] = None,
        sort: str = "download_time",
    ) -> Dict[str, Any]:
        """分页查询下载历史，直接包装 Database.get_aweme_history。

        ``date_from`` / ``date_to`` 为 unix 秒（按作品发布时间 create_time 过滤）；
        ``author`` / ``title`` 为大小写不敏感子串匹配。
        """
        if deps.database is None:
            raise HTTPException(status_code=409, detail="database is not enabled")
        return await deps.database.get_aweme_history(
            page=max(1, page),
            size=min(200, max(1, size)),
            author=author or None,
            author_sec_uid=author_sec_uid or None,
            job_id=job_id or None,
            aweme_type=aweme_type or None,
            title=title or None,
            date_from=date_from,
            date_to=date_to,
            sort=sort,
        )

    @app.get("/api/v1/downloads/authors")
    async def top_authors(days: int = 30, limit: int = 20) -> Dict[str, Any]:
        """近 N 天下载量 Top 作者，包装 Database.get_top_authors。"""
        if deps.database is None:
            raise HTTPException(status_code=409, detail="database is not enabled")
        authors = await deps.database.get_top_authors(
            days=max(1, days), limit=min(100, max(1, limit))
        )
        return {"authors": authors}

    @app.get("/api/v1/jobs")
    async def list_jobs() -> Dict[str, List[Dict[str, Any]]]:
        jobs = await manager.list_jobs()
        return {"jobs": [j.to_dict() for j in jobs]}

    # 静态 UI 兜底必须放在全部 API 路由之后：Starlette 按注册顺序匹配，
    # mount("/") 在最后才不会遮蔽 /api/v1（含未知 API 路径仍返回 404）。
    if _STATIC_DIR.is_dir():
        from fastapi.staticfiles import StaticFiles

        app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")

    return app


async def run_server(config: ConfigLoader, *, host: str, port: int) -> None:
    import uvicorn

    app = build_app(config)
    uv_config = uvicorn.Config(app, host=host, port=port, log_level="info")
    server = uvicorn.Server(uv_config)
    await server.serve()
