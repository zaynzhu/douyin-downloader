<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-09-12 -->

# server

## Purpose
FastAPI REST 服务——异步任务队列（含持久化与取消/重试）、下载历史查询，以及自托管静态 Web UI。

## Key Files

| File | Description |
|------|-------------|
| `__init__.py` | 端点文档字符串 |
| `app.py` | FastAPI 入口：/api/v1 端点、`_ServerDeps` 共享依赖、静态 UI 挂载（Phase 2 后） |
| `jobs.py` | JobManager：内存队列 + `job` 表持久化（upsert_job / load_terminal_jobs）、五态（含 CANCELLED）、cancel / load_persisted |
| `static/` | 自托管 Web UI（index.html / app.js / style.css，源自 webui3 合并原型）——app.js 接线**进行中**，规格见 `docs/analysis/2026-09-12-webui-phase2-handoff.md` T2 |

## For AI Agents

### Working In This Directory
- executor 协议：`executor(url, job_id=...)`；JobManager 在任务终态自动 `upsert_job` 落库，持久化故障只记日志
- **静态 mount 必须在全部 API 路由注册之后**（Starlette 按注册顺序匹配），否则会遮蔽 /api/v1
- server 与 CLI 各持独立 Database 连接（WAL 支持多连接）；lifespan 负责 initialize / load_persisted / close
- server 路径**不含** license/邀请码/自动重登录（与上游桌面端的有意分歧，见根 AGENTS.md）
- 静态 `app.js` 接线规格与已定决策见 `docs/analysis/2026-09-12-webui-phase2-handoff.md`

### Testing Requirements
- `tests/test_server.py`（30+ 项，含静态托管与 API 优先级测试）
- `tests/test_download_proxy_passthrough.py`（代理透传回归）

<!-- MANUAL: -->