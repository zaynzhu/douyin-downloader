"""core.download_service：统一下载编排的单一入口行为。

链路：短链解析 → URL 解析 → 能力门禁 → 工厂 → 执行 → 写历史。
失败语义：普通失败抛 DownloadError（用户可读消息）；
LoginRequiredError 原样上抛——CLI 的 _run_with_relogin 靠它触发自动重登。
"""

import importlib
import json
from types import SimpleNamespace

import pytest

from config import ConfigLoader
from core.api_client import LoginRequiredError

ds = importlib.import_module("core.download_service")
DownloadError = ds.DownloadError
DownloadService = ds.DownloadService


class _FakeCookieManager:
    def get_cookies(self):
        return {"msToken": "token-1"}


class _FakeDatabase:
    def __init__(self):
        self.history = []

    async def add_history(self, record):
        self.history.append(record)


class _RecordingReporter:
    def __init__(self):
        self.steps = []

    def advance_step(self, step, detail=""):
        self.steps.append(("advance", step, detail))

    def update_step(self, step, detail=""):
        self.steps.append(("update", step, detail))


def _client_cls(*, resolution=None):
    class _Client:
        def __init__(self, cookies, proxy=None):
            self.proxy = proxy

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def resolve_short_url(self, url):
            return resolution

    return _Client


def _downloader_cls(*, result=None, exc=None):
    class _Downloader:
        async def download(self, parsed):
            if exc is not None:
                raise exc
            return result

    return _Downloader


_VIDEO_PARSED = {"type": "video", "aweme_id": "7604129988555574538"}
_VIDEO_URL = "https://www.douyin.com/video/7604129988555574538"


def _make_service(
    monkeypatch,
    tmp_path,
    *,
    downloader=None,
    parse=None,
    resolution=None,
    database=None,
    progress_reporter=None,
    job_id=None,
    info=None,
):
    config = ConfigLoader()
    config.update(path=str(tmp_path))
    monkeypatch.setattr(ds, "DouyinAPIClient", _client_cls(resolution=resolution))
    if parse is not None:
        monkeypatch.setattr(ds.URLParser, "parse", parse)

    created = {}

    def _fake_create(url_type, *_args, **kwargs):
        created["url_type"] = url_type
        created["kwargs"] = kwargs
        return downloader

    monkeypatch.setattr(ds.DownloaderFactory, "create", _fake_create)

    service = DownloadService(
        config=config,
        cookie_manager=_FakeCookieManager(),
        file_manager=None,
        rate_limiter=None,
        retry_handler=None,
        queue_manager=None,
        database=database,
        progress_reporter=progress_reporter,
        job_id=job_id,
        info=info,
    )
    return service, created


def _ok_result():
    return SimpleNamespace(total=2, success=1, failed=1, skipped=0)


@pytest.mark.asyncio
async def test_success_returns_result_and_writes_history(monkeypatch, tmp_path):
    database = _FakeDatabase()
    config_cookies = {"ttwid": "sample"}
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        database=database,
    )
    service.config.update(cookies=config_cookies)

    result = await service.run(_VIDEO_URL)

    assert result.total == 2 and result.success == 1
    assert len(database.history) == 1
    record = database.history[0]
    assert record["url"] == _VIDEO_URL
    assert record["url_type"] == "video"
    assert record["total_count"] == 2
    assert record["success_count"] == 1
    # 配置快照必须剔除敏感键，历史里不能落 Cookie
    snapshot = json.loads(record["config"])
    assert "cookies" not in snapshot and "cookie" not in snapshot


@pytest.mark.asyncio
async def test_history_records_original_short_url(monkeypatch, tmp_path):
    database = _FakeDatabase()
    short_url = "https://v.douyin.com/AbCdEf/"
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        resolution=_VIDEO_URL,
        database=database,
    )

    await service.run(short_url)

    assert database.history[0]["url"] == short_url


@pytest.mark.asyncio
async def test_history_skipped_when_no_database(monkeypatch, tmp_path):
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        database=None,
    )

    result = await service.run(_VIDEO_URL)

    assert result.success == 1


@pytest.mark.asyncio
async def test_short_link_resolve_failure_raises(monkeypatch, tmp_path):
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        resolution=None,
        parse=lambda _url: dict(_VIDEO_PARSED),
    )

    with pytest.raises(DownloadError, match="Failed to resolve short URL"):
        await service.run("https://v.douyin.com/AbCdEf/")


@pytest.mark.asyncio
async def test_short_link_resolved_before_parse_and_download(monkeypatch, tmp_path):
    parsed_inputs = []
    downloader = _downloader_cls(result=_ok_result())()

    def _parse(url):
        parsed_inputs.append(url)
        return dict(_VIDEO_PARSED)

    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=downloader,
        parse=_parse,
        resolution=_VIDEO_URL,
    )

    await service.run("https://v.douyin.com/AbCdEf/")

    assert parsed_inputs == [_VIDEO_URL]


@pytest.mark.asyncio
async def test_unparsed_url_raises(monkeypatch, tmp_path):
    service, _ = _make_service(monkeypatch, tmp_path, parse=lambda _url: None)

    with pytest.raises(DownloadError, match="Failed to parse URL"):
        await service.run("https://example.com/nope")


@pytest.mark.asyncio
async def test_gated_type_raises_with_real_reason_and_skips_factory(monkeypatch, tmp_path):
    service, created = _make_service(
        monkeypatch,
        tmp_path,
        parse=lambda _url: {"type": "lvdetail", "episode_id": "6828500371023856142"},
    )

    with pytest.raises(DownloadError) as exc_info:
        await service.run("https://www.douyin.com/lvdetail/6828500371023856142")

    assert str(exc_info.value) == ds.UNSUPPORTED_URL_TYPE_DETAIL["lvdetail"]
    assert created == {}


@pytest.mark.asyncio
async def test_missing_downloader_raises(monkeypatch, tmp_path):
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=None,
        parse=lambda _url: dict(_VIDEO_PARSED),
    )

    with pytest.raises(DownloadError, match="No downloader found for type: video"):
        await service.run(_VIDEO_URL)


@pytest.mark.asyncio
async def test_downloader_exception_wrapped_as_download_error(monkeypatch, tmp_path):
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(exc=RuntimeError("cdn boom"))(),
        parse=lambda _url: dict(_VIDEO_PARSED),
    )

    with pytest.raises(DownloadError, match="Download failed.*cdn boom"):
        await service.run(_VIDEO_URL)


@pytest.mark.asyncio
async def test_login_required_propagates_untouched(monkeypatch, tmp_path):
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(
            exc=LoginRequiredError(2483, "请先登录", "/aweme/v1/web/post/")
        )(),
        parse=lambda _url: dict(_VIDEO_PARSED),
    )

    with pytest.raises(LoginRequiredError):
        await service.run(_VIDEO_URL)


@pytest.mark.asyncio
async def test_job_id_passed_to_factory(monkeypatch, tmp_path):
    service, created = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        job_id="job-42",
    )

    await service.run(_VIDEO_URL)

    assert created["url_type"] == "video"
    assert created["kwargs"].get("job_id") == "job-42"


@pytest.mark.asyncio
async def test_progress_reporter_receives_full_step_sequence(monkeypatch, tmp_path):
    reporter = _RecordingReporter()
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        progress_reporter=reporter,
    )

    await service.run(_VIDEO_URL)

    advanced = [step for kind, step, _ in reporter.steps if kind == "advance"]
    assert advanced == ["解析链接", "创建下载器", "执行下载", "记录历史", "收尾"]


@pytest.mark.asyncio
async def test_info_callback_receives_url_type_without_reporter(monkeypatch, tmp_path):
    infos = []
    service, _ = _make_service(
        monkeypatch,
        tmp_path,
        downloader=_downloader_cls(result=_ok_result())(),
        parse=lambda _url: dict(_VIDEO_PARSED),
        info=infos.append,
    )

    await service.run(_VIDEO_URL)

    assert any("URL type: video" in msg for msg in infos)
