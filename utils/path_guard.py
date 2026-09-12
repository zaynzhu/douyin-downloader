"""路径边界守卫：把"结果必须落在 base 内"收敛为一个可测试原语。

当前 REST API 不接受任何路径入参，本模块是给未来路径类参数（如 per-job
输出目录覆盖、上传目录）预备的安全地基——在参数真正出现之前，拒绝
``..`` 相对逃逸、绝对路径逃逸、symlink 逃逸的行为已由测试锁定。
错误使用这条原语的代价是任意文件覆写，属红线级安全问题。
"""

from pathlib import Path
from typing import Union


def resolve_within(base: Union[str, Path], candidate: Union[str, Path]) -> Path:
    """解析 ``candidate`` 并要求结果落在 ``base`` 内，否则抛 ValueError。

    - 相对 ``candidate`` 相对 ``base`` 解析；绝对路径按字面解析；
    - 双方都先 resolve() 再比较：``..`` 与 symlink 都逃不出边界；
    - ``base`` 不要求已存在（resolve 对不存在路径也做纯词法归一）；
    - ``candidate`` 解析后等于 ``base`` 本身视为合法。
    """
    base_abs = Path(base).expanduser().resolve()
    cand = Path(candidate).expanduser()
    resolved = (cand if cand.is_absolute() else base_abs / cand).resolve()
    if resolved != base_abs and base_abs not in resolved.parents:
        raise ValueError(f"path escapes base {base_abs}: {candidate}")
    return resolved
