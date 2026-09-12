"""FastAPI 服务测试：验证 job 生命周期与 HTTP 接口。

仅测试 HTTP 层 + JobManager 抽象；不触达真实 Douyin API。
"""

import asyncio
import time
from typing import Any, Dict, List, Optional

import pytest

try:
    from fastapi.testclient import TestClient  # type: ignore
except ImportError:  # pragma: no cover
    pytest.skip("fastapi not installed", allow_module_level=True)


from config import ConfigLoader
from server.app import build_app
from server.jobs import JobManager

_TERMINAL = ("success", "failed", "cancelled")


class _FakeJobDB:
    """只实现 JobManager 用到的两个方法，记录 upsert 调用。"""

    def __init__(self, rows: Optional[List[Dict[str, Any]]] = None):
        self.upserts: List[Dict[str, Any]] = []
        self._rows = rows or []

    async def upsert_job(self, job_dict: Dict[str, Any]) -> None:
        self.upserts.append(dict(job_dict))

    async def load_terminal_jobs(self, limit: Optional[int] = None) -> List[Dict[str, Any]]:
        return [dict(r) for r in self._rows]


@pytest.mark.asyncio
async def test_job_manager_runs_executor(tmp_path):
    async def fake_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fake_executor, max_concurrency=2)
    job = await manager.submit("https://example/one")
    assert job.status == "pending"

    # 等待后台任务跑完
    await asyncio.wait_for(job._task, timeout=2.0)
    fetched = await manager.get(job.job_id)
    assert fetched is not None
    assert fetched.status == "success"
    assert fetched.success == 1


@pytest.mark.asyncio
async def test_job_manager_marks_failure_on_executor_error(tmp_path):
    async def boom(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        raise RuntimeError("bad url")

    manager = JobManager(executor=boom)
    job = await manager.submit("x")
    await asyncio.wait_for(job._task, timeout=2.0)
    fetched = await manager.get(job.job_id)
    assert fetched is not None
    assert fetched.status == "failed"
    assert fetched.error is not None
    assert "bad url" in fetched.error


def test_health_endpoint(tmp_path):
    config = ConfigLoader(None)
    # database=False：server 会按配置建库，测试绝不能碰仓库根目录的真实 dy_downloader.db
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    with TestClient(app) as client:
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}


def test_download_endpoint_creates_job(tmp_path, monkeypatch):
    config = ConfigLoader(None)
    # database=False：server 会按配置建库，测试绝不能碰仓库根目录的真实 dy_downloader.db
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    # 替换 job executor 为 fake（不去触达 Douyin）
    async def fake_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = fake_executor

    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": "https://www.douyin.com/video/123"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] in ("pending", "running", "success")
        assert data["url"] == "https://www.douyin.com/video/123"
        assert len(data["job_id"]) > 0

        job_id = data["job_id"]
        # job 列表应包含该 id
        list_resp = client.get("/api/v1/jobs")
        assert list_resp.status_code == 200
        ids = [j["job_id"] for j in list_resp.json()["jobs"]]
        assert job_id in ids

        # 详情接口
        detail = client.get(f"/api/v1/jobs/{job_id}")
        assert detail.status_code == 200
        assert detail.json()["job_id"] == job_id


def test_download_endpoint_rejects_empty_url(tmp_path):
    config = ConfigLoader(None)
    # database=False：server 会按配置建库，测试绝不能碰仓库根目录的真实 dy_downloader.db
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.post("/api/v1/download", json={"url": ""})
        assert resp.status_code == 400


def test_get_unknown_job_returns_404(tmp_path):
    config = ConfigLoader(None)
    # database=False：server 会按配置建库，测试绝不能碰仓库根目录的真实 dy_downloader.db
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/jobs/unknown-id")
        assert resp.status_code == 404


def test_build_app_shares_deps_across_requests(tmp_path):
    """重请求应复用同一个 FileManager / RateLimiter 等（避免每次重建）。"""
    config = ConfigLoader(None)
    # database=False：server 会按配置建库，测试绝不能碰仓库根目录的真实 dy_downloader.db
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    deps = app.state.deps
    assert deps.file_manager is not None
    assert deps.rate_limiter is not None
    assert deps.retry_handler is not None
    assert deps.queue_manager is not None
    assert deps.cookie_manager is not None

    # 构建第二次 app 时应该是完全独立的 deps 实例，但同一 app 内是共享的
    app2 = build_app(config)
    assert app2.state.deps is not app.state.deps
    assert app.state.deps.file_manager is app.state.deps.file_manager  # identity


@pytest.mark.asyncio
async def test_job_manager_prunes_by_max_jobs():
    """max_jobs 超限时应优先淘汰最老的终态 job，保留 in-flight。"""

    async def fast_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fast_executor, max_jobs=3, job_ttl_seconds=0.0)
    jobs = []
    for i in range(5):
        j = await manager.submit(f"u{i}")
        jobs.append(j)
        await asyncio.wait_for(j._task, timeout=1.0)

    remaining = await manager.list_jobs()
    # max_jobs=3：新任务 submit 时先剪裁，最终存量 ≤ max_jobs
    assert len(remaining) <= 3
    # 最新的那一批一定在，最早的那几个被淘汰
    ids_remaining = {j.job_id for j in remaining}
    assert jobs[-1].job_id in ids_remaining


@pytest.mark.asyncio
async def test_job_manager_prunes_by_ttl():
    """TTL 过期的终态 job 应在下次 submit 时被清理。"""

    async def fast_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=fast_executor, max_jobs=100, job_ttl_seconds=0.01)
    old_job = await manager.submit("old")
    await asyncio.wait_for(old_job._task, timeout=1.0)

    # 等 TTL 过期
    await asyncio.sleep(0.05)

    new_job = await manager.submit("new")
    await asyncio.wait_for(new_job._task, timeout=1.0)

    remaining_ids = {j.job_id for j in await manager.list_jobs()}
    assert old_job.job_id not in remaining_ids
    assert new_job.job_id in remaining_ids


# ---------- 任务持久化 / 取消 / 重试（中期 #2） ----------


@pytest.mark.asyncio
async def test_job_manager_passes_job_id_to_executor():
    seen: Dict[str, Any] = {}

    async def recording_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        seen["job_id"] = job_id
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    manager = JobManager(executor=recording_executor)
    job = await manager.submit("https://x/1")
    await asyncio.wait_for(job._task, timeout=1.0)

    assert seen["job_id"] == job.job_id


@pytest.mark.asyncio
async def test_job_manager_persists_terminal_job_to_database():
    db = _FakeJobDB()

    async def ok_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 2, "success": 1, "failed": 1, "skipped": 0}

    manager = JobManager(executor=ok_executor, database=db)
    job = await manager.submit("https://x/1")
    await asyncio.wait_for(job._task, timeout=1.0)

    assert len(db.upserts) == 1
    record = db.upserts[0]
    assert record["job_id"] == job.job_id
    assert record["url"] == "https://x/1"
    # failed > 0 → 终态 failed；计数一并落库
    assert record["status"] == "failed"
    assert record["total"] == 2 and record["success"] == 1 and record["failed"] == 1


@pytest.mark.asyncio
async def test_job_manager_without_database_skips_persistence():
    # database=None 时不得抛错（兼容旧用法），也无所谓 upsert
    async def ok_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    manager = JobManager(executor=ok_executor, database=None)
    job = await manager.submit("https://x/1")
    await asyncio.wait_for(job._task, timeout=1.0)
    assert job.status == "success"


@pytest.mark.asyncio
async def test_job_manager_cancel_running_job_marks_cancelled():
    started = asyncio.Event()

    async def slow_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        started.set()
        await asyncio.Event().wait()  # 一直阻塞直到被取消
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=slow_executor)
    job = await manager.submit("https://x/slow")
    await asyncio.wait_for(started.wait(), timeout=1.0)

    cancelled = await manager.cancel(job.job_id)

    assert cancelled is not None
    await asyncio.wait_for(job._task, timeout=1.0)
    assert job.status == "cancelled"
    assert job.finished_at is not None


@pytest.mark.asyncio
async def test_job_manager_cancel_persists_cancelled_state():
    db = _FakeJobDB()
    started = asyncio.Event()

    async def slow_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        started.set()
        await asyncio.Event().wait()
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=slow_executor, database=db)
    job = await manager.submit("https://x/slow")
    await asyncio.wait_for(started.wait(), timeout=1.0)

    await manager.cancel(job.job_id)
    await asyncio.wait_for(job._task, timeout=1.0)

    assert db.upserts and db.upserts[-1]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_job_manager_cancel_unknown_job_returns_none():
    async def ok_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=ok_executor)
    assert await manager.cancel("no-such-job") is None


@pytest.mark.asyncio
async def test_job_manager_load_persisted_restores_terminal_jobs():
    rows = [
        {
            "job_id": "old1",
            "url": "https://x/old1",
            "status": "failed",
            "created_at": "2026-09-12T00:00:00Z",
            "started_at": "2026-09-12T00:00:01Z",
            "finished_at": "2026-09-12T00:00:02Z",
            "total": 3,
            "success": 1,
            "failed": 2,
            "skipped": 0,
            "error": "boom",
            "author_nickname": None,
            "author_sec_uid": None,
            "retry_count": 0,
            "last_retry_at": None,
            "last_retry_summary": None,
            "retry_history": [],
            "overrides": None,
        }
    ]
    db = _FakeJobDB(rows=rows)

    async def ok_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    manager = JobManager(executor=ok_executor, database=db)
    await manager.load_persisted()

    jobs = {j.job_id: j for j in await manager.list_jobs()}
    restored = jobs.get("old1")
    assert restored is not None
    assert restored.status == "failed"
    assert restored.url == "https://x/old1"
    assert restored.total == 3 and restored.failed == 2
    assert restored.error == "boom"


def _wait_terminal(client: TestClient, job_id: str) -> Dict[str, Any]:
    for _ in range(100):
        detail = client.get(f"/api/v1/jobs/{job_id}").json()
        if detail.get("status") in _TERMINAL:
            return detail
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} never reached terminal state: {detail}")


def test_cancel_endpoint_unknown_job_returns_404(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.post("/api/v1/jobs/no-such-id/cancel")
        assert resp.status_code == 404


def test_cancel_endpoint_conflicts_on_terminal_job(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    async def ok_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = ok_executor

    with TestClient(app) as client:
        job_id = client.post("/api/v1/download", json={"url": "https://x/1"}).json()["job_id"]
        _wait_terminal(client, job_id)
        resp = client.post(f"/api/v1/jobs/{job_id}/cancel")
        assert resp.status_code == 409


def test_retry_endpoint_resubmits_failed_job_as_new(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    attempts: List[str] = []

    async def flaky_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        attempts.append(url)
        if len(attempts) == 1:
            return {"total": 1, "success": 0, "failed": 1, "skipped": 0}
        return {"total": 1, "success": 1, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = flaky_executor

    with TestClient(app) as client:
        first = client.post("/api/v1/download", json={"url": "https://x/flaky"}).json()
        assert _wait_terminal(client, first["job_id"])["status"] == "failed"

        retry = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        assert retry.status_code == 201
        body = retry.json()
        assert body["job_id"] != first["job_id"]
        assert body["url"] == "https://x/flaky"

        detail = _wait_terminal(client, body["job_id"])
        assert detail["status"] == "success"
        assert attempts == ["https://x/flaky", "https://x/flaky"]


def test_retry_endpoint_conflicts_while_in_flight(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)

    async def slow_executor(url: str, job_id: Optional[str] = None) -> Dict[str, int]:
        await asyncio.sleep(5)
        return {"total": 0, "success": 0, "failed": 0, "skipped": 0}

    app.state.job_manager.executor = slow_executor

    with TestClient(app) as client:
        first = client.post("/api/v1/download", json={"url": "https://x/slow"}).json()
        resp = client.post(f"/api/v1/jobs/{first['job_id']}/retry")
        assert resp.status_code == 409


def test_retry_endpoint_unknown_job_returns_404(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.post("/api/v1/jobs/no-such-id/retry")
        assert resp.status_code == 404


def test_build_app_initializes_database_when_enabled(tmp_path):
    """database=true 时 server 应建库并初始化；lifespan 退出时关闭。"""
    config = ConfigLoader(None)
    config.update(
        path=str(tmp_path), database=True, database_path=str(tmp_path / "jobs.db")
    )
    app = build_app(config)
    with TestClient(app):
        assert app.state.deps.database is not None


# ---------- 历史查询端点（中期 #3） ----------


def _history_row(
    aweme_id: str,
    *,
    author: str = "作者甲",
    sec_uid: str = "sec-1",
    aweme_type: str = "video",
    file_path: Optional[str] = None,
) -> Dict[str, Any]:
    if file_path is None:
        file_path = f"Downloaded/{author}/{aweme_id}.mp4"
    return {
        "aweme_id": aweme_id,
        "aweme_type": aweme_type,
        "title": f"作品{aweme_id}",
        "author_id": f"aid-{sec_uid}",
        "author_name": author,
        "author_sec_uid": sec_uid,
        "create_time": int(time.time()),
        "file_path": file_path,
    }


def _seed_history_db(db_path, rows) -> None:
    from storage import Database

    async def _seed():
        db = Database(db_path=str(db_path))
        await db.initialize()
        for row in rows:
            await db.add_aweme(row)
        await db.close()

    asyncio.run(_seed())


def _history_app(tmp_path, rows):
    db_path = tmp_path / "history.db"
    if rows:
        _seed_history_db(db_path, rows)
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=True, database_path=str(db_path))
    return build_app(config)


def test_downloads_endpoint_requires_database(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/downloads")
        assert resp.status_code == 409


def test_downloads_endpoint_returns_paginated_history(tmp_path):
    rows = [
        _history_row("7001"),
        _history_row("7002"),
        _history_row("7003", author="作者乙", sec_uid="sec-2"),
    ]
    app = _history_app(tmp_path, rows)
    with TestClient(app) as client:
        resp = client.get("/api/v1/downloads")
        assert resp.status_code == 200
        body = resp.json()
        assert body["total"] == 3
        assert body["page"] == 1 and body["size"] == 50
        assert {item["aweme_id"] for item in body["items"]} == {"7001", "7002", "7003"}
        first = body["items"][0]
        for key in ("aweme_id", "aweme_type", "title", "author_name", "file_path"):
            assert key in first


def test_downloads_endpoint_pagination(tmp_path):
    rows = [_history_row(f"70{i:02d}") for i in range(1, 4)]
    app = _history_app(tmp_path, rows)
    with TestClient(app) as client:
        page1 = client.get("/api/v1/downloads", params={"size": 2, "page": 1}).json()
        page2 = client.get("/api/v1/downloads", params={"size": 2, "page": 2}).json()
        assert page1["total"] == 3 and len(page1["items"]) == 2
        assert page2["total"] == 3 and len(page2["items"]) == 1


def test_downloads_endpoint_filters_by_author(tmp_path):
    rows = [
        _history_row("7001", author="作者甲"),
        _history_row("7002", author="作者甲"),
        _history_row("7003", author="作者乙", sec_uid="sec-2"),
    ]
    app = _history_app(tmp_path, rows)
    with TestClient(app) as client:
        body = client.get("/api/v1/downloads", params={"author": "作者乙"}).json()
        assert body["total"] == 1
        assert body["items"][0]["aweme_id"] == "7003"

        body_all = client.get("/api/v1/downloads", params={"author": "作者"}).json()
        assert body_all["total"] == 3  # 子串匹配，两个作者都命中


def test_downloads_authors_endpoint_requires_database(tmp_path):
    config = ConfigLoader(None)
    config.update(path=str(tmp_path), database=False)
    app = build_app(config)
    with TestClient(app) as client:
        resp = client.get("/api/v1/downloads/authors")
        assert resp.status_code == 409


def test_downloads_authors_endpoint_returns_top_authors(tmp_path):
    rows = [
        _history_row("7001", author="作者甲", sec_uid="sec-1"),
        _history_row("7002", author="作者甲", sec_uid="sec-1"),
        _history_row("7003", author="作者乙", sec_uid="sec-2"),
    ]
    app = _history_app(tmp_path, rows)
    with TestClient(app) as client:
        resp = client.get("/api/v1/downloads/authors", params={"days": 30, "limit": 10})
        assert resp.status_code == 200
        authors = resp.json()["authors"]
        assert authors[0]["sec_uid"] == "sec-1"
        assert authors[0]["download_count"] == 2
        assert authors[1]["sec_uid"] == "sec-2"
        assert authors[1]["download_count"] == 1
