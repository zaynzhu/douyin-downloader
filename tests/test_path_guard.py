"""utils.path_guard：路径边界守卫原语。

当前 REST API 不接受任何路径入参；本模块是给未来路径类参数（如 per-job
输出目录覆盖）预备的安全地基。行为先由测试锁定：``..`` 相对逃逸、
绝对路径逃逸、symlink 逃逸都必须被拒绝——写错这条的代价是任意文件
覆写，属于红线级安全问题。
"""

import os

import pytest

from utils.path_guard import resolve_within


def test_relative_candidate_resolves_inside_base(tmp_path):
    resolved = resolve_within(tmp_path, "author/video.mp4")

    assert resolved == (tmp_path / "author" / "video.mp4").resolve()
    assert tmp_path.resolve() in resolved.parents


def test_absolute_candidate_inside_base_ok(tmp_path):
    target = tmp_path / "downloads" / "a.mp4"

    assert resolve_within(tmp_path, target) == target.resolve()


def test_absolute_candidate_outside_base_rejected(tmp_path, tmp_path_factory):
    elsewhere = tmp_path_factory.mktemp("elsewhere")

    with pytest.raises(ValueError, match="escapes"):
        resolve_within(tmp_path, elsewhere / "x.mp4")


def test_dotdot_escape_rejected(tmp_path):
    with pytest.raises(ValueError, match="escapes"):
        resolve_within(tmp_path, "../evil.mp4")


def test_base_itself_allowed(tmp_path):
    assert resolve_within(tmp_path, ".") == tmp_path.resolve()


def test_symlink_escape_rejected(tmp_path, tmp_path_factory):
    outside_dir = tmp_path_factory.mktemp("outside")
    outside_dir.joinpath("evil.mp4").write_bytes(b"x")
    link = tmp_path / "shortcut"
    os.symlink(outside_dir, link, target_is_directory=True)

    with pytest.raises(ValueError, match="escapes"):
        resolve_within(tmp_path, "shortcut/evil.mp4")


def test_symlink_inside_base_still_allowed(tmp_path):
    real_dir = tmp_path / "real"
    real_dir.mkdir()
    (real_dir / "ok.mp4").write_bytes(b"x")
    link = tmp_path / "alias"
    os.symlink(real_dir, link, target_is_directory=True)

    resolved = resolve_within(tmp_path, "alias/ok.mp4")
    assert resolved == (real_dir / "ok.mp4").resolve()
    assert tmp_path.resolve() in resolved.parents
