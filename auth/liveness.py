"""Cookie 活性探测：一次真实 API 请求判断登录态是否仍然有效。

设计契约：探测永远不抛异常、只发一个请求；结果三分类，
由调用方决定呈现级别（CLI 据此区分 error / warning / info）。
"""

from enum import Enum
from typing import Any, Tuple

from core.api_client import LoginRequiredError
from utils.logger import setup_logger

logger = setup_logger("CookieLiveness")

_FIX_GUIDANCE = "python -m tools.cookie_fetcher --config config.yml"


class LivenessStatus(Enum):
    """探测结果三分类。"""

    ALIVE = "alive"
    INVALID = "invalid"
    UNREACHABLE = "unreachable"


async def check_cookie_liveness(api_client: Any) -> Tuple[LivenessStatus, str]:
    """用 ``get_self_info`` 探测当前 Cookie 的登录活性。

    - 接口返回账号信息 -> ALIVE（附昵称）
    - 抖音明确要求登录（LoginRequiredError）-> INVALID（附修复指引）
    - 接口可达但拿不到账号 -> INVALID（措辞保留不确定性）
    - 网络/未知异常 -> UNREACHABLE（绝不误报 Cookie 失效）
    """
    try:
        user = await api_client.get_self_info()
    except LoginRequiredError:
        return (
            LivenessStatus.INVALID,
            f"Cookie 已失效（抖音要求重新登录）。请运行 {_FIX_GUIDANCE} 重新获取 Cookie。",
        )
    except Exception as exc:  # noqa: BLE001 — 探测的任何异常都不应阻塞调用方主流程
        logger.debug("Cookie liveness probe failed: %s", exc)
        return LivenessStatus.UNREACHABLE, f"网络不可达，跳过 Cookie 活性检查：{exc}"

    if user and str(user.get("sec_uid") or "").strip():
        nickname = str(user.get("nickname") or "").strip() or "未知昵称"
        return LivenessStatus.ALIVE, f"Cookie 有效，当前登录账号：{nickname}"
    return (
        LivenessStatus.INVALID,
        f"Cookie 可能已失效：接口可达但未返回账号信息。可运行 {_FIX_GUIDANCE} 重新获取。",
    )
