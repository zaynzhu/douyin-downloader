"""统一下载编排：CLI 与 REST 共用的单一入口。

链路：短链解析 → URL 解析 → 能力门禁 → 工厂 → 执行 → 写历史。
此前 cli.main.download_url 与 server.app._execute_download 各自维护一份
同构代码（server 注释自述"有意不复用"），新增链接类型或门禁规则需要双改、
且已经漂移（server 不写历史、不传 job_id）。本模块收敛为唯一实现，
两个入口退化为薄壳：

- CLI 壳：捕获 DownloadError 转终端提示 + None（保持批处理韧性）；
  LoginRequiredError 穿透给 _run_with_relogin 触发自动重登。
- REST 壳：DownloadError / LoginRequiredError 直接上抛，由 JobManager
  落为 job.error。

入口差异全部下沉为构造参数：database / progress_reporter / job_id / info。
"""

from __future__ import annotations

import json
from typing import Any, Callable, Optional

from core.api_client import DouyinAPIClient, LoginRequiredError
from core.downloader_factory import UNSUPPORTED_URL_TYPE_DETAIL, DownloaderFactory
from core.url_parser import URLParser
from utils.logger import setup_logger
from utils.validators import is_short_url, normalize_short_url

logger = setup_logger("DownloadService")


class DownloadError(Exception):
    """URL 处理失败；message 面向用户，可直接展示。"""


class DownloadService:
    """一次 ``run(url)`` = 一条链接的完整下载编排。"""

    def __init__(
        self,
        *,
        config: Any,
        cookie_manager: Any,
        file_manager: Any,
        rate_limiter: Any,
        retry_handler: Any,
        queue_manager: Any,
        database: Any = None,
        progress_reporter: Any = None,
        job_id: Optional[str] = None,
        info: Optional[Callable[[str], None]] = None,
    ):
        self.config = config
        self.cookie_manager = cookie_manager
        self.file_manager = file_manager
        self.rate_limiter = rate_limiter
        self.retry_handler = retry_handler
        self.queue_manager = queue_manager
        self.database = database
        self.progress_reporter = progress_reporter
        self.job_id = job_id
        self._info = info or (lambda _msg: None)

    async def run(self, url: str) -> Any:
        """执行完整链路；成功返回 DownloadResult，失败抛 DownloadError。"""
        original_url = url
        async with DouyinAPIClient(
            self.cookie_manager.get_cookies(),
            proxy=self.config.get("proxy"),
        ) as api_client:
            if self.progress_reporter:
                self.progress_reporter.advance_step("解析链接", "检查短链并解析 URL")

            # 支持多种短链变体：v.douyin.com / v.iesdouyin.com / 无 scheme 的裸链接
            if is_short_url(url):
                resolved = await api_client.resolve_short_url(normalize_short_url(url))
                if not resolved:
                    if self.progress_reporter:
                        self.progress_reporter.update_step("解析链接", "短链解析失败")
                    raise DownloadError(f"Failed to resolve short URL: {url}")
                url = resolved

            parsed = URLParser.parse(url)
            if not parsed:
                if self.progress_reporter:
                    self.progress_reporter.update_step("解析链接", "URL 解析失败")
                raise DownloadError(f"Failed to parse URL: {url}")

            # 能力门禁：这些类型解析得出来，但永远不会有下载器（见
            # core.downloader_factory.UNSUPPORTED_URL_TYPE_DETAIL）。在建下载器
            # 之前拦，用户才能看到真实原因而不是 "No downloader found for ..."。
            gated_detail = UNSUPPORTED_URL_TYPE_DETAIL.get(str(parsed.get("type") or ""))
            if gated_detail:
                if self.progress_reporter:
                    self.progress_reporter.update_step("解析链接", gated_detail)
                raise DownloadError(gated_detail)

            if self.progress_reporter:
                self.progress_reporter.advance_step(
                    "创建下载器", f"URL 类型: {parsed['type']}"
                )
            else:
                self._info(f"URL type: {parsed['type']}")

            downloader = DownloaderFactory.create(
                parsed["type"],
                self.config,
                api_client,
                self.file_manager,
                self.cookie_manager,
                self.database,
                self.rate_limiter,
                self.retry_handler,
                self.queue_manager,
                progress_reporter=self.progress_reporter,
                job_id=self.job_id,
            )
            if downloader is None:
                if self.progress_reporter:
                    self.progress_reporter.update_step("创建下载器", "未找到匹配下载器")
                raise DownloadError(f"No downloader found for type: {parsed['type']}")

            if self.progress_reporter:
                self.progress_reporter.advance_step("执行下载", "开始拉取与下载资源")
            try:
                result = await downloader.download(parsed)
            except LoginRequiredError:
                # 必须穿透给调用方的重登流程（cli._run_with_relogin），
                # 掉进下面那个宽泛 except 的话，自动重登就成了永远收不到
                # 信号的死代码。
                raise
            except Exception as exc:
                # 单条 URL 的致命错误（如 Cookie 失效导致 user_info 拉不到）降级为
                # 该 URL 的失败，不拖垮整个批次；调用方决定呈现方式。
                if self.progress_reporter:
                    self.progress_reporter.update_step("执行下载", f"失败：{exc}")
                raise DownloadError(f"Download failed for {url}: {exc}") from exc

            if self.progress_reporter:
                self.progress_reporter.advance_step(
                    "记录历史",
                    "写入数据库历史" if (result and self.database) else "数据库未启用，跳过",
                )
            if result and self.database:
                # 配置快照剔除敏感键，历史记录里不能落 Cookie。
                safe_config = {
                    k: v
                    for k, v in self.config.config.items()
                    if k not in ("cookies", "cookie", "transcript")
                }
                await self.database.add_history(
                    {
                        "url": original_url,
                        "url_type": parsed["type"],
                        "total_count": result.total,
                        "success_count": result.success,
                        "config": json.dumps(safe_config, ensure_ascii=False),
                    }
                )

            if self.progress_reporter:
                if result:
                    self.progress_reporter.advance_step(
                        "收尾",
                        f"成功 {result.success} / 失败 {result.failed} / 跳过 {result.skipped}",
                    )
                else:
                    self.progress_reporter.advance_step("收尾", "无可统计结果")

            return result
