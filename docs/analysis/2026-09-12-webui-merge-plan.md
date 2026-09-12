# Web UI 合并实施计划（2026-09-12）

> 依据：两版设计原型评审（见会话记录与 `docs/design/webui`（浅色工作台）/`docs/design/webui2`（深色控制台）的 README）。本文自包含，可交给任何模型执行。
> 决策：**采用合并方案**——骨架用 webui2，并入 webui1 的正确性要素，修复 webui2 的实测缺陷。

> 执行状态（2026-09-12）：Phase 1 合并产物已落地 `docs/design/webui3/`，验证记录见 [webui3 README](../design/webui3/README.md)。等待用户视觉验收；Phase 2 尚未开始。桌面复用方向见 [后续交付计划](2026-09-12-desktop-delivery-plan.md)。下方总清单包含真实接线项，不以离线原型测试代替。

## 1. 合并原则

```text
骨架（布局/导航/组件/交互逻辑）：webui2（工程底子最好：DOM 构造防 XSS、信息层级最佳、设置页最完整）
正确性要素（并入）：webui1 独有且正确的契约理解
缺陷修复：webui2 实测抓出的两处真问题
各自正确的部分拼接：页面级无数据状态用 webui1 方案；有数据但更新中断用 webui2 横幅方案
```

原版 `webui/`、`webui2/` **保留不动**（评审追溯记录），合并产物为新目录 `webui3/`。

## 2. 合并清单（逐项：现状 → 改法 → 验收）

### B1 · 历史搜索改显式字段选择（来自 webui1）

- **现状（webui2）**：`#fSearch` 单框对 author_name/title 做客户端 OR 过滤（app.js `histFiltered`）。
- **问题**：真实 API `GET /api/v1/downloads` 只有 `author` 与 `title` 两个独立参数、按 AND 叠加，OR 语义无法表达；合并框接入后会出错误结果或被迫砍功能。
- **改法**（抄 webui1 方案）：
  - HTML：`.field` 内加 `<select id="fSearchField">`（作者/标题），搜索输入 placeholder 随字段切换（"搜索作者…" / "搜索标题…"）。
  - `app.js`：`histFiltered` 按所选字段过滤；接入点注释改为"只传 author 或 title 二选一"。
- **验收**：切字段后 placeholder 同步；作者搜索不匹配标题。

### B2 · 窄屏溢出修复 + 识别规则锚定（webui2 实测缺陷）

- **现状**：390px 下任务页横向溢出 64px（`.job-main`/`.job-url` 等被长 URL 撑到 405-426px，25 个元素越界）；`.job-url` 自带的 `text-overflow: ellipsis` 因父级链未约束宽度而失效。`detectType` 用 `/collection/.test(p)`、`/live/.test(p)` 子串匹配，误判面宽。
- **改法**：
  - `style.css`：给 `.job-card`、`.job-head`、`.job-main`（及 `.chip`、`.chip-url`）补 `min-width: 0`，使 ellipsis 生效。
  - `app.js`：识别规则换成 webui1 的锚定匹配——`/^\/(collection|mix)\//`、直播按域名（`live.douyin.com`）、短链按 `v.douyin.com` 域名。
- **验收**：390×844 四页 `scrollWidth === clientWidth`；`/user/MS4w...live...` 这类路径不再误判为直播。

### B3 · 页面级 error/offline 全局态（来自 webui1）

- **现状**：webui2 的 error/offline 只在任务中心有横幅；历史/下载/设置页无"首次加载失败/服务不可达"的整页态。
- **改法（拼接语义，非照抄）**：
  - 移植 webui1 的 `#global-state` 机制：`devState ∈ {error, offline}` 且**当前页尚无内容**时，隐藏页面渲染整页状态卡（含"重新加载/重新连接"按钮）。
  - **已有数据时**保留 webui2 的横幅方案（"网络请求失败，展示最后一份数据 + 最后成功时间 + 重试"）——两版各自正确的分支并存：无数据→页级卡；有数据→横幅不打断阅读。
- **验收**：空历史 + error 态出整页卡；有任务数据 + error 态出横幅且列表可读。

### C · 小清理（评审发现，原型阶段顺手做）

- `app.js:273` `netTime` 恒真三元（`fmtClock()` 恒返回非空串）改为直赋值。
- `app.js` `seedHistory` 中 `(isGallery ? 'post' : 'post')` 恒等三元删除。

## 3. 实施步骤

### Phase 1 · 合并原型（`docs/design/webui3/`，仍是离线演示）

1. `cp -R docs/design/webui2 docs/design/webui3`。
2. 依次落 B1、B2、B3、C（改动集中：`index.html` 搜索字段区、`app.js` 的 `histFiltered`/`detectType`/渲染分支、`style.css` 的 min-width 补丁）。
3. 重写 `webui3/README.md`：底座来源、并入清单、与两版差异、本版验证记录。
4. **Playwright 复测矩阵**：识别/去重/提交 → 五态 → Tab 计数 → 历史分页/字段搜索/路径弹窗 → Cookie 失效链 → 390px 四页零溢出 → 控制台零 error。
5. **用户视觉验收**：本地起 `python3 -m http.server --directory docs/design`，对比 webui2 与 webui3（合并版视觉基调 = webui2 深色，可切浅色）。

> 备选（已论证不采纳为默认）：跳过 Phase 1，直接在 `server/static/` 实现合并并接线。省一轮，但视觉未验收就做接线，返工风险归实现方。

### Phase 2 · 正式实现（`server/static/` + 真实接线）

1. **FastAPI 静态托管**（先写失败测试再实现，TDD）：
   - `server/static/` 放合并版四页文件；`server/app.py` 在**全部 API 路由注册之后** `app.mount("/", StaticFiles(directory=..., html=True))`——Starlette 按注册顺序匹配，API 路由优先，`GET /` 出 UI。
   - 测试：`tests/test_server.py` 增加 `GET /` 返回 200 且含四页 section 标记；`/api/v1/health` 不被 mount 遮蔽。
2. **移除演示层**：devbar 状态控制条、"设计原型"标签、示例按钮、`seedJobs`/`seedHistory`/模拟 tick、虚构封面 SVG。
3. **接线**（按原型中已留的接入点注释，两版 README 的交接约定为准）：
   - 提交：`POST /api/v1/download` 逐条串行、间隔 ≥2s、提交期禁用；部分失败保留失败行；响应丢失先查询任务再决定重提。
   - 任务：`GET /api/v1/jobs` 首次加载 + 存在 pending/running 时 2s 串行轮询（前次未返回不发下一次；`document.hidden` 暂停、回前台刷一次；全终态停）。轮询只改数字/进度/徽章，不重建卡片、不打断焦点。
   - 取消：先"正在取消…"，`POST /jobs/{id}/cancel` 响应后改终态；409 重拉、404 引导历史入口。
   - 重试：`POST /jobs/{id}/retry` 用返回的新 job_id 新建条目，原任务保留。
   - 历史：`GET /api/v1/downloads`（page/size/author**或**title/aweme_type/job_id/date_from/date_to/sort）；日期按 Asia/Shanghai 日初日末转 Unix 秒；输入防抖、条件变化回第 1 页、废弃过期响应。
   - Top 作者：`GET /api/v1/downloads/authors?days=30&limit=20` 独立调用。
   - 健康：`GET /api/v1/health` 驱动顶栏服务胶囊与设置页状态（健康 ≠ Cookie 有效，文案保持两者的诚实表述）。
4. **README 双语**补 Web UI 章节：`python run.py --serve` 后打开 `http://127.0.0.1:8000`。
5. **验证**：全量 pytest + ruff；Playwright 对真实 server 走 UI 骨架与 API 集成（提交用真实 URL 交由用户实际使用验证下载链路；失败/离线分支用不可达地址与断服验证）。

## 4. 风险与回滚

| 风险 | 缓解 |
|---|---|
| mount("/") 遮蔽 API 路由 | 注册顺序保证 + 新增测试锁定 |
| 视觉验收不过 | Phase 1 独立存在，返工只动 webui3，不动实现 |
| 真实数据出现原型未覆盖的形状（超长标题/空字段） | DOM 构造天然免疫 XSS；空值兜底在各渲染函数已有 |
| 回滚 | 两 Phase 各自独立提交，可按提交逐个 revert；原版 webui/webui2 永远在 |

## 5. 验收总清单

- [ ] B1 字段搜索语义正确（原型 + 真实 API 双验证）
- [ ] B2 390px 四页零溢出、识别锚定无误判
- [ ] B3 无数据页级态 / 有数据横幅态双分支
- [ ] 控制台零 error；静态资源零外部请求
- [ ] Phase 2：`GET /` 出 UI 且 `/api/v1/*` 全部原样可用（现有 28 项 server 测试全绿 + 新增托管测试）
- [ ] 全量 pytest / ruff 绿；提交按红线纪律逐个原子化
