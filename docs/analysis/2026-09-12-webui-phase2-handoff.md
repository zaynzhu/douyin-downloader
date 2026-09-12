# Web UI Phase 2 交接文档（2026-09-12）

> **给执行 agent 的开工说明**：本文自包含——读完即可继续，无需本会话任何上下文。配套必读：`2026-09-12-webui-merge-plan.md`（合并计划全文）、`2026-09-12-webui-design-brief.md` §4（API 契约）。
> 任务书全链路：任务书 → 两版原型（webui/webui2）→ 合并原型 webui3（已实测验收）→ **本文：Phase 2 正式接线（进行中，从本文继续）**。

## 0. 当前工作区状态（先核对再动手，不要重复或覆盖）

| 文件 | 状态 | 说明 |
|---|---|---|
| `tests/test_server.py` | 已修改（未提交） | 追加了 2 个静态托管测试，**当前 RED**：`test_static_ui_served_at_root` 断言 404≠200——这是你的第一个 GREEN 目标；`test_api_routes_take_precedence_over_static_mount` 当前已绿（无 mount 可遮蔽） |
| `server/static/index.html` | 新文件（未提交） | **生产版页面骨架已完成**：四页、无 devbar、netBanner 置于 main 顶部（四页可见）、`#global-state` 区、`#histError` 块、诚实版设置页。引用 `app.js`（尚不存在） |
| `server/static/style.css` | 新文件（未提交） | **已完成**：webui3 成品样式，devbar/dev-data 样式已剥除，头部注释已改正式版。**不要重写，直接用** |
| `server/static/app.js` | **不存在** | 主要交付物（见 T2） |
| `server/app.py` | 未改动 | 需要 mount（见 T1） |

参考素材：`docs/design/webui3/`（离线原型最终版，渲染函数与交互逻辑的移植来源）、`docs/design/webui/`（字段搜索等正确性要素来源）。

## 1. 目标

`python run.py --serve` 后打开 `http://127.0.0.1:8000` 即得可用的四页 Web UI：粘贴链接提交下载、任务中心（五态/取消/重试）、下载历史（过滤/分页/路径）、设置（诚实只读 + Cookie 指引）。纯静态前端由 FastAPI 托管，不引 Node 构建链、不引前端框架、不加 Python 依赖。

## 2. 剩余任务（按序执行，TDD）

### T1 · 静态托管挂载（先做，让 RED 变 GREEN）

`server/app.py` 的 `build_app()` 末尾（**全部 API 路由注册之后**）：

```python
from pathlib import Path

_STATIC_DIR = Path(__file__).resolve().parent / "static"

# build_app 内、所有 @app 路由注册之后：
if _STATIC_DIR.is_dir():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_STATIC_DIR), html=True), name="ui")
```

要点（已定决策，不要重新发明）：

- Starlette 按注册顺序匹配：API 路由在前 → 优先；mount("/") 在最后兜底。`test_api_routes_take_precedence_over_static_mount` 锁定（含"未知 API 路径仍 404，不兜底回 index.html"）。
- `_STATIC_DIR.is_dir()` 守卫：目录缺失时服务照常可用（纯 API 模式）。
- `html=True` 使 `GET /` 返回 index.html。

验收：两个新测试转绿；现有全部 server 测试不回归。

### T2 · `server/static/app.js` 真实接线（主要工作量）

**做法**：以 `docs/design/webui3/app.js` 为底子——**渲染函数全部保留**（jobCard/renderJobs/renderRecent/renderHistory/statusBadge/fmtCounts/renderDl chips/路径弹窗/Toast/主题持久化/路由），**数据层整体替换**为真实 fetch。webui3 里所有 `/* 真实接入：... */` 注释锚点即接线位置。

**状态模型**（替换原型内存假数据）：

```js
var state = {
  jobs: null,            // null = 从未成功加载；[] = 成功但为空（区分二者，见错误模型）
  history: null,         // 同上
  histTotal: 0,
  authors: null,
  authorsLoaded: false,
  route: 'download',
  jobsFilter: 'all',
  health: 'unknown',     // unknown | ok | down（仅由健康检查与请求成功/失败驱动）
  lastNetOk: null,
  pageLastOk: {},        // 每页最后成功时间（横幅显示用）
  hist: { page: 1, size: 50, searchField: 'author', search: '', type: 'all',
          from: '', to: '', sort: 'download_time', job: '' },
  histSeq: 0,            // 废弃过期响应：请求前 ++，响应回来比对
  jobsSeq: 0,
  submitting: false,
  pollTimer: null,
  pollInFlight: false
}
```

**端点行为**（全部已实现并有测试；完整请求/响应示例见任务书 §4）：

```text
POST /api/v1/download        body {"url": "..."} → 200 {"job_id","status","url"}；空 url 400
GET  /api/v1/jobs            → {"jobs": [{job_id,url,status,created_at,started_at,finished_at,total,success,failed,skipped,error}]}
GET  /api/v1/jobs/{id}       → 单任务；未知 404
POST /api/v1/jobs/{id}/cancel → 200 任务 dict；已终态 409；未知 404
POST /api/v1/jobs/{id}/retry  → 201 {"job_id"(新),"status","url"}；进行中 409
GET  /api/v1/downloads?page&size&author&title&aweme_type&job_id&date_from&date_to&sort
                             → {"total","page","size","items":[...含 file_path/cover_urls/job_id]}
GET  /api/v1/downloads/authors?days=30&limit=20 → {"authors":[{sec_uid,author_name,download_count}]}
GET  /api/v1/health          → {"status":"ok"}
```

**逐条接线规则**（每条都有验收）：

1. **提交**：逐条串行 `POST /download`，每条间隔 ≥2000ms；提交期间 `#dlSubmit` 禁用（`state.submitting`）；每条成功用响应构造 pending job `unshift` 进 `state.jobs` 并渲染；失败条目**保留在输入框**并 toast 原因，不整批清空。批量完成后跳 `#jobs` 并立即 `loadJobs()` 对齐服务端真相。
2. **任务加载与轮询**：启动时 `loadJobs()` 一次；存在 pending/running 时每 2s 轮询（**串行**：`pollInFlight` 期间不发下一次；`document.hidden` 跳过；visibilitychange 回前台立即刷一次；全部终态后停）。轮询只更新数字/进度/徽章/时间，不重建整卡 DOM、不打断焦点（渲染函数已满足）。"刷新"按钮 = `loadJobs()`。
3. **取消**：点击先置 `job._cancelling=true` 显示"正在取消…"，`POST cancel` 后无论结果都 `loadJobs()` 对齐服务端；409 视为"已终态，重拉"；404 toast"任务已不在近期列表"并引导历史。
4. **重试**：`POST retry` 的 201 响应含新 job_id，`loadJobs()` 后新任务出现；UI 不本地伪造新任务。
5. **历史**：`loadHistory()` 按筛选构建查询串；**搜索只传 `author` 或 `title` 二选一**（由 `#fSearchField` 决定，绝不同时传）；日期 `#fFrom/#fTo` 按 Asia/Shanghai 日初（`T00:00:00+08:00`）/日末（`T23:59:59+08:00`）转 Unix 秒；搜索输入 300ms 防抖；筛选条件变化回第 1 页；`histSeq` 比对废弃过期响应；服务端分页（total 驱动页码禁用态）。
6. **Top 作者**：首次进入历史页时调 `/downloads/authors`，缓存 `authorsLoaded`；点击作者 = 设 `searchField='author'` + 填入名字 + 回第 1 页。注意真实 API 按**发布时间（create_time）**聚合——原型按 download_time 过滤是演示口径，接线后以 API 为准，界面文案写"近 30 天"即可。
7. **健康**：启动时 `GET /health` → 胶囊"服务正常/不可达" + `lastNetOk`；任何成功请求更新 `lastNetOk`；设置页"重新检查"按钮手动触发。**健康 ≠ Cookie 有效**——Cookie 相关文案保持诚实（Cookie 面板恒"未检测"+修复命令）。
8. **错误三态模型**（webui1+webui2 拼接语义，保持不变）：
   - 主资源（jobs）**从未加载成功**且请求失败 → 显示 `#global-state` 整页卡（error|offline 文案区分）；输入内容保留。
   - 已有数据后失败 → `#netBanner`（main 顶部、四页可见）："网络请求失败，展示最后一份数据 · 最后成功 <time>"，数据保留可读。
   - 历史页失败但从未加载 → `#histError` 块 + `#histRetry`（已在 index.html）。
   - **禁止**把网络失败渲染成下载失败（语义污染）。
9. **识别与提交校验**（沿用 webui3）：域名白名单（含 iesdouyin）、短链标"提交后解析"、锚定路径匹配、重复标注+逐条移除；非抖音域禁提交。前端提示仅供引导，真实解析以服务端为准。

**移除清单**（原型有、正式版不要）：devbar 及其全部处理器、`seedJobs/seedHistory`、模拟 `tick`、`_simPlan`、虚构封面 assets/（真实封面来自 API 的 cover_urls，加载失败走既有"无封面"占位）、"设计原型"标签。

**保留清单**：示例按钮（真实可试的示例 URL，属 UX 非 demo）、"已下载自动跳过"提示、深浅主题（localStorage 键建议 `dyui-theme`）、全部可达性属性。

**安全铁律**：服务端返回的一切标题/作者/URL/错误文本**只经 DOM textContent 输出**（webui3 的 `el()` 构造模式），禁止 innerHTML 拼接动态数据。

### T3 · 端到端验证（Playwright，对真实 server）

1. 准备隔离环境（**绝不用用户真实 config.yml/数据库**）：
   - `.runtime/` 已被 gitignore，测试产物放这里；
   - 种子数据：`.venv/bin/python` + `asyncio` 调 `storage.Database(db_path='.runtime/ui-e2e/e2e.db')` → `initialize()` → `add_aweme({...含 file_path...})` → `close()`；
   - 写 `.runtime/ui-e2e/config.yml`：`path`/`database: true`/`database_path` 指向上述路径；`link` 按校验要求给一条占位链接。
2. 启动：`.venv/bin/python run.py --serve --serve-port 8123 -c .runtime/ui-e2e/config.yml`（后台）。
3. Playwright 检查矩阵：
   - `GET /` 渲染四页、主题切换、控制台零 error
   - 健康胶囊变"服务正常"（真实 /health）
   - 历史页显示种子数据；字段搜索/分页控件可用
   - **提交回路**：用格式合法但必然失败的视频 URL（如 `https://www.douyin.com/video/0000000000000000000`）走"粘贴→识别→提交→任务出现→轮询→转 failed→错误与 Cookie 指引可见"。代价是 1-2 次注定失败的抖音请求（用户日常使用即此路径）；若不愿触发，只验 POST 已发出（Playwright network log），真实提交留给用户首次使用。
   - 取消/重试按钮出现在正确状态的卡片上
4. 收尾：杀 server；删 `.runtime/ui-e2e/`；`.playwright-mcp/` 加入 `.gitignore` 或删除。

### T4 · 文档

- README.md / README_EN.md："运行"章节加 Web UI 小节（`python run.py --serve` → 打开 `http://127.0.0.1:8000`；四页一句话说明）；REST 端点表不动。
- `docs/000-index.md`：webui3 行后补 Phase 2 完成状态。
- `docs/analysis/2026-09-12-roadmap.md` 变更记录追加：长期 #1 完成。

### T5 · 提交纪律

- 原子提交建议：①`feat(server): 静态托管 Web UI 并接线任务与历史`（T1+T2+静态文件）②`docs: README 补 Web UI 使用说明`（T4）。红线自检（`git diff --cached` 无凭证/绝对路径模式）每次提交前执行。
- 交接时本地 main 有 **5 个未推送提交**（3 个设计原型 + 合并计划 + webui3 交付，均无敏感内容）——**推送需用户确认**，不要自动 push。

## 3. 已定决策（不要重新推导）

1. 骨架 = webui2/webui3 系（深色控制台），webui1 只贡献 B1 字段搜索等正确性要素——两版对比评审已完成，勿重开。
2. Cookie 无检测端点 → UI 恒"未检测"，只给修复命令；不做页内登录。
3. 配置写入不存在 → 设置页只读 + "示例快照"标签，不放假保存。
4. 无推送通道 → 2s 轮询（规则见 T2-2），不做 WebSocket/SSE。
5. 浏览器打不开服务端 Finder → 文件"位置"= 弹窗展示 + 复制。
6. 不做自动打开浏览器；不加自动刷新 Cookie 体系。
7. 示例按钮（视频示例/混合多条）保留——是空态引导功能，不是演示数据。
8. 封面走 API 的 cover_urls + 失败占位；不内置任何虚构封面资源。
9. 桌面方向已由用户改判为"macOS DMG 优先"（见 roadmap 长期 #4 与 `2026-09-12-desktop-delivery-plan.md`）——与 Phase 2 正交，勿在接线中为壳层做任何预处理。

## 4. 验收总清单

- [ ] 两个静态托管测试绿 + 全量 pytest/ruff 绿（当前基线 712 passed + 1 skipped）
- [ ] Playwright：四页渲染、健康胶囊、历史真数据、提交回路（含失败路径）、取消/重试按钮随状态出现
- [ ] 390px 四页零溢出、控制台零 error、零外部资源请求
- [ ] 红线：提交内容无 Cookie/Token/绝对路径；`.runtime` 与测试产物不入库
- [ ] README 双语 + 000-index + roadmap 变更记录更新