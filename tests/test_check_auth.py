"""--check-auth 子命令与启动时 Cookie 活性探测的 CLI 接线。

fake 的只是网络边界（DouyinAPIClient），分类逻辑走真实的
check_cookie_liveness——接线层测试只断言呈现与退出码。
"""

import importlib
from types import SimpleNamespace

import aiohttp
import pytest

from core.api_client import LoginRequiredError

main_module = importlib.import_module("cli.main")

_NEW_COOKIES = {"sessionid": "fresh-session", "ttwid": "fresh-ttwid"}


class _RecordingCookieManager:
    def __init__(self):
        self.set_calls = []

    def set_cookies(self, cookies):
        self.set_calls.append(cookies)


def _record_display(monkeypatch):
    calls = {"error": [], "warning": [], "info": [], "success": []}
    for level in calls:
        monkeypatch.setattr(
            main_module.display,
            f"print_{level}",
            lambda msg, _level=level: calls[_level].append(msg),
        )
    return calls


def _fake_config(cookies=None, proxy=None):
    return SimpleNamespace(
        get_cookies=lambda: dict(cookies or {}),
        get=lambda key, default=None: proxy if key == "proxy" else default,
    )


def _fake_client_class(*, exc=None, user=None):
    class _Client:
        def __init__(self, cookies, proxy=None):
            self.cookies = cookies

        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return None

        async def get_self_info(self):
            if exc is not None:
                raise exc
            return user

    return _Client


def _alive_client_class():
    return _fake_client_class(user={"sec_uid": "MS4wLjABAAAAtest", "nickname": "小明"})


# ---------- --check-auth 子命令 ----------


@pytest.mark.asyncio
async def test_check_auth_alive_returns_zero(monkeypatch):
    monkeypatch.setattr(main_module, "DouyinAPIClient", _alive_client_class())
    calls = _record_display(monkeypatch)

    rc = await main_module._run_check_auth_subcommand(_fake_config(cookies={"ttwid": "x"}))

    assert rc == 0
    assert any("小明" in msg for msg in calls["success"])


@pytest.mark.asyncio
async def test_check_auth_invalid_returns_one_with_guidance(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=LoginRequiredError(2483, "请先登录", "/aweme/v1/web/user/profile/self/")),
    )
    calls = _record_display(monkeypatch)

    rc = await main_module._run_check_auth_subcommand(_fake_config(cookies={"ttwid": "x"}))

    assert rc == 1
    assert any("cookie_fetcher" in msg for msg in calls["error"])


@pytest.mark.asyncio
async def test_check_auth_unreachable_returns_one_as_warning_not_error(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=aiohttp.ClientError("connection reset")),
    )
    calls = _record_display(monkeypatch)

    rc = await main_module._run_check_auth_subcommand(_fake_config(cookies={"ttwid": "x"}))

    assert rc == 1
    assert calls["error"] == []
    assert len(calls["warning"]) == 1


@pytest.mark.asyncio
async def test_check_auth_without_cookies_returns_one_without_probing(monkeypatch):
    probed = []

    class _NeverClient:
        def __init__(self, cookies, proxy=None):
            probed.append(cookies)

    monkeypatch.setattr(main_module, "DouyinAPIClient", _NeverClient)
    calls = _record_display(monkeypatch)

    rc = await main_module._run_check_auth_subcommand(_fake_config())

    assert rc == 1
    assert probed == []
    assert any("未配置" in msg for msg in calls["error"])


# ---------- 启动时自动探测 ----------


@pytest.mark.asyncio
async def test_startup_probe_alive_prints_success_and_never_prompts(monkeypatch):
    monkeypatch.setattr(main_module, "DouyinAPIClient", _alive_client_class())
    calls = _record_display(monkeypatch)
    prompts = []
    monkeypatch.setattr("builtins.input", lambda prompt="": prompts.append(prompt) or "y")

    await main_module._probe_startup_cookie(
        _fake_config(cookies={"ttwid": "x"}), _RecordingCookieManager()
    )

    assert any("小明" in msg for msg in calls["success"])
    assert calls["error"] == []
    assert prompts == []


@pytest.mark.asyncio
async def test_startup_probe_invalid_interactive_confirmed_updates_cookies(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=LoginRequiredError(2483, "请先登录", "/x")),
    )
    calls = _record_display(monkeypatch)
    monkeypatch.setattr(main_module, "can_interactive_login", lambda serve=False: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "y")

    async def _fake_relogin(cookies_path=None):
        return dict(_NEW_COOKIES)

    monkeypatch.setattr(main_module, "interactive_relogin", _fake_relogin)
    cookie_manager = _RecordingCookieManager()

    await main_module._probe_startup_cookie(_fake_config(cookies={"ttwid": "x"}), cookie_manager)

    assert cookie_manager.set_calls == [_NEW_COOKIES]
    assert any("失效" in msg for msg in calls["error"])


@pytest.mark.asyncio
async def test_startup_probe_invalid_interactive_declined_keeps_old_cookies(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=LoginRequiredError(2483, "请先登录", "/x")),
    )
    _record_display(monkeypatch)
    monkeypatch.setattr(main_module, "can_interactive_login", lambda serve=False: True)
    monkeypatch.setattr("builtins.input", lambda prompt="": "n")

    relogin_called = []

    async def _fake_relogin(cookies_path=None):
        relogin_called.append(True)
        return None

    monkeypatch.setattr(main_module, "interactive_relogin", _fake_relogin)
    cookie_manager = _RecordingCookieManager()

    await main_module._probe_startup_cookie(_fake_config(cookies={"ttwid": "x"}), cookie_manager)

    assert relogin_called == []
    assert cookie_manager.set_calls == []


@pytest.mark.asyncio
async def test_startup_probe_invalid_non_interactive_only_logs_error(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=LoginRequiredError(2483, "请先登录", "/x")),
    )
    calls = _record_display(monkeypatch)
    monkeypatch.setattr(main_module, "can_interactive_login", lambda serve=False: False)
    prompts = []
    monkeypatch.setattr("builtins.input", lambda prompt="": prompts.append(prompt) or "y")

    await main_module._probe_startup_cookie(
        _fake_config(cookies={"ttwid": "x"}), _RecordingCookieManager()
    )

    assert any("cookie_fetcher" in msg for msg in calls["error"])
    assert prompts == []


@pytest.mark.asyncio
async def test_startup_probe_unreachable_prints_info_and_continues(monkeypatch):
    monkeypatch.setattr(
        main_module,
        "DouyinAPIClient",
        _fake_client_class(exc=aiohttp.ClientError("connection reset")),
    )
    calls = _record_display(monkeypatch)

    await main_module._probe_startup_cookie(
        _fake_config(cookies={"ttwid": "x"}), _RecordingCookieManager()
    )

    assert calls["error"] == []
    assert len(calls["info"]) == 1


@pytest.mark.asyncio
async def test_startup_probe_skips_when_no_cookies(monkeypatch):
    probed = []

    class _NeverClient:
        def __init__(self, cookies, proxy=None):
            probed.append(cookies)

    monkeypatch.setattr(main_module, "DouyinAPIClient", _NeverClient)
    calls = _record_display(monkeypatch)

    await main_module._probe_startup_cookie(_fake_config(), _RecordingCookieManager())

    assert probed == []
    assert calls["success"] == [] and calls["error"] == []


@pytest.mark.asyncio
async def test_startup_probe_skips_when_all_cookie_values_empty(monkeypatch):
    probed = []

    class _NeverClient:
        def __init__(self, cookies, proxy=None):
            probed.append(cookies)

    monkeypatch.setattr(main_module, "DouyinAPIClient", _NeverClient)

    await main_module._probe_startup_cookie(
        _fake_config(cookies={"msToken": "", "ttwid": ""}), _RecordingCookieManager()
    )

    assert probed == []
