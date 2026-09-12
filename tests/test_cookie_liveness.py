"""auth.liveness：一次真实 API 探测对 Cookie 登录态的三分类行为。

探测本身永不抛异常——调用方（CLI 启动流程）依赖这个契约，
否则探测反而会让原本能跑的下载流程崩掉。
"""

import aiohttp
import pytest

from auth.liveness import LivenessStatus, check_cookie_liveness
from core.api_client import LoginRequiredError


class _StubAPIClient:
    """最小 DouyinAPIClient 替身：只实现探测用到的 get_self_info。"""

    def __init__(self, *, exc=None, user=None):
        self._exc = exc
        self._user = user

    async def get_self_info(self):
        if self._exc is not None:
            raise self._exc
        return self._user


@pytest.mark.asyncio
async def test_alive_returns_status_with_nickname():
    client = _StubAPIClient(user={"sec_uid": "MS4wLjABAAAAtest", "nickname": "小明"})

    status, message = await check_cookie_liveness(client)

    assert status is LivenessStatus.ALIVE
    assert "小明" in message


@pytest.mark.asyncio
async def test_login_required_maps_to_invalid_with_fix_guidance():
    client = _StubAPIClient(
        exc=LoginRequiredError(2483, "请先登录", "/aweme/v1/web/user/profile/self/")
    )

    status, message = await check_cookie_liveness(client)

    assert status is LivenessStatus.INVALID
    assert "cookie_fetcher" in message


@pytest.mark.asyncio
async def test_reachable_but_empty_user_maps_to_invalid():
    client = _StubAPIClient(user=None)

    status, message = await check_cookie_liveness(client)

    assert status is LivenessStatus.INVALID


@pytest.mark.asyncio
async def test_network_error_maps_to_unreachable_and_never_claims_expired():
    client = _StubAPIClient(exc=aiohttp.ClientError("connection reset"))

    status, message = await check_cookie_liveness(client)

    assert status is LivenessStatus.UNREACHABLE
    assert "失效" not in message


@pytest.mark.asyncio
async def test_unexpected_error_maps_to_unreachable_with_detail():
    client = _StubAPIClient(exc=RuntimeError("signer boom"))

    status, message = await check_cookie_liveness(client)

    assert status is LivenessStatus.UNREACHABLE
    assert "signer boom" in message
