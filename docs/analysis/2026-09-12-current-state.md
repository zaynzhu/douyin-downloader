# 现状分析（2026-09-12）

> 本文是 zaynzhu fork 的接手分析快照，供后续任何模型/开发者接续工作时免重复探索。
>
> **分析方法**：4 个只读静态分析（覆盖 CLI/API/存储/认证/测试全部子系统）+ 手工 git 安全审计 + 4 个外部项目 README 调研。未运行测试、未读取任何 Cookie/数据库内容、未做任何写入性改动。文中 `file:line` 引用对应 commit `1f54031` 时刻的代码。

## 1. 项目身份

- 仓库：`github.com/zaynzhu/douyin-downloader`（public），是上游 `jiji262/douyin-downloader` 的 fork。
- 截至本快照：**全部 91 条提交的作者均为上游作者 jiji262**（最新 2026-09-06），本地尚未产生二次开发提交；工作区仅有 `.gitignore` 一处未提交改动（补 `.runtime/`）和未跟踪的 `run.sh`。
- README（中英双份）**未声明 fork 关系**，徽章与桌面版链接仍全部指向上游 jiji262——身份披露是短期必须处理项（见 roadmap）。
- 根目录 `CLAUDE.md` / `AGENTS.md` 要求与 `/Users/crimson/codes/douyin/douyin-downloader-desktop` 双向同步共享逻辑——**该路径在本机不存在**，此条款来自上游作者的开发环境，本 fork 是否继承此约束属待用户决策项（见 roadmap §6）。

## 2. 规模与目录

131 个 Python 文件，约 31500 行（含测试）；核心代码约 1.9 万行。

```text
run.py            # 仅 sys.path 引导 + chdir + cli.main.main()
cli/              # main.py(464行 编排) / progress_display.py(rich进度) / login_flow.py(交互重登) / whisper_transcribe.py(独立转写工具)
config/           # config_loader.py(四层合并) / default_config.py(默认值)
core/             # api_client.py(1863行 最大文件) / downloader_base.py(1643行) / 各下载器 / user_modes/(6策略) / url_parser / downloader_factory
server/           # app.py(FastAPI) / jobs.py(内存任务队列)
storage/          # database.py(808行 SQLite) / file_manager.py(563行 落盘)
auth/             # cookie_manager / ms_token_manager / ms_token_conf(内置快照)
control/          # RateLimiter / RetryHandler / QueueManager（三个小而独立的并发原语）
tools/            # cookie_fetcher.py(Playwright 手动登录抓 cookie)
utils/            # abogus.py(865行 A-Bogus) / xbogus.py / validators / naming / notifier / logger
tests/            # 65 个 test_*.py，约 593 个测试函数
docs/superpowers/ # 历次 spec/plan（文档驱动开发产物）
img/desktop/      # 上游 Douzy 桌面端截图 6 张（Web UI 交互参考素材，fork 时带入）
```

## 3. 核心调用链

### 3.1 CLI 模式

```text
run.py → cli/main.py:main() → asyncio.run(main_async)
  1. 配置加载：ConfigLoader 四层合并（默认 default_config.py → YAML 递归 merge → DOUYIN_COOKIE/PATH/THREAD/PROXY 环境变量 → CLI 参数），mix/allmix 别名归一化（config/config_loader.py:23-131）
  2. 校验：link/path 必填、thread/retry_times 非法回退默认、start/end_time 须 %Y-%m-%d（config_loader.py:340-381）
  3. Cookie 装入 CookieManager + validate_cookies（仅静态查 key 存在性，auth/cookie_manager.py:61-70）
  4. 逐 URL 执行 download_url（cli/main.py:75-193），外层包 _run_with_relogin（:40-73，LoginRequiredError 时交互式重登一次）
     a. 短链：utils/validators.is_short_url → api_client.resolve_short_url 跟 302、10s 超时（core/api_client.py:1348-1384）
     b. 类型识别：validators.parse_url_type（video/note/gallery/user/collection/mix/music/live/lvdetail）→ URLParser.parse 抽 ID（core/url_parser.py:13-66）
     c. 能力门禁：UNSUPPORTED_URL_TYPE_DETAIL 拦截 DRM 影视（core/downloader_factory.py:22-24）
     d. DownloaderFactory.create 分发 → downloader.download(parsed)
     e. 写 download_history（剔除 cookies/transcript 敏感键，cli/main.py:168-182）→ 汇总通知（Bark/Telegram/Webhook）
```

### 3.2 用户主页批量（UserDownloader 链）

`_configured_modes` → `/user/self` 别名解析（core/user_downloader.py:85-118）→ 逐 mode 走 `UserModeRegistry` 六种策略（core/user_modes/*_strategy.py）→ 每种策略：`collect_items`（分页 + cursor 停滞检测 + rate_limiter + 限量提前截断）→ `apply_filters`（置顶→时间→媒体类型→limit）→ `_download_mode_items`（core/user_downloader.py:372-458）。post 模式翻页受限时浏览器回补 `_recover_user_post_with_browser`（:467-619）。

### 3.3 REST 模式（注意：这是第三条编排链）

`--serve` 启动 FastAPI（server/app.py），与 CLI 互斥同进程。`_execute_download`（server/app.py:78-126）**手工复制了与 CLI download_url 相同的编排步骤**，注释自认"有意不复用 cli.main.download_url——后者绑定了 rich 进度状态"。差异：server 传 `database=None`（不写任何表）、不传 `job_id`、无自动重登录包裹。

### 3.4 结构性结论

| 问题 | 位置 | 后果 |
|---|---|---|
| 编排逻辑三处手工同步 | `cli/main.py:75-193`、`server/app.py:78-126`、`core/retry_executor.py:87-141` | 新增链接类型/门禁需改三处；已实际漂移（server 不写库） |
| BaseDownloader 巨类 1643 行 | `core/downloader_base.py` | 画质/图集候选/本地索引/评论/manifest 全塞一起；策略层 `getattr` 反调宿主保护方法，双向耦合（`user_modes/base_strategy.py:54-58`） |
| ConfigLoader 是全局可变接口 | 30+ 字符串键裸读；per-job 注入靠 config.update + 手工快照恢复（`core/retry_executor.py:124-128`） | 多 job 并发共享实例会互相污染 |
| 增量状态双源 | 磁盘文件名正则索引（`downloader_base.py:304-328`）+ DB `is_downloaded`（`storage/database.py:230-242`） | 判定优先级分散两处；每个 downloader 实例各自全库 rglob 扫盘一遍 |

## 4. 能力矩阵（实现位置与评估）

| 能力 | 位置 | 评估 |
|---|---|---|
| 单视频 | `core/video_downloader.py`；detail 双 aid 候选兼容 | 良好 |
| 图文 | 与视频共用分发；`_detect_media_type` 按 aweme_type 2/68/150 判型；多镜像逐图降级 + livephoto mp4 | 良好 |
| 短链解析 | `utils/validators.py:64-93` + `api_client.py:1348` | 良好 |
| 主页 post | `user_modes/post_strategy.py`：45s 页超时、cursor 死循环防护、**时间边界提前停页**、置顶过滤；`aweme_count` 风控下不可靠（常只回 20）→ 浏览器回补 | 良好，受限判定依赖不可靠字段，有兜底 |
| like/mix/music/collect/collectmix | 各 strategy + 通用分页（`base_strategy.py:84-131`）；浏览器兜底仅 post 完整验证 | 中等偏良 |
| 合集 | `core/mix_downloader.py`，独立目录 `<author>/mix/<合集名>/` | 良好 |
| 音乐 | `core/music_downloader.py` 直下 play_url，失败回退首条相关作品 | 中等 |
| 直播/回放 | `core/live_downloader.py` / `live_replay_downloader.py`（FLV 原生，HLS 仅存清单需 ffmpeg 后处理，实验性） | 实验性 |
| 评论采集 | `core/comments_collector.py`（分页去重、cursor 卡死保护），随下载隐式触发 | 良好 |
| 热榜/搜索 | `core/discovery.py`，仅落 JSONL，仅 CLI 暴露（`--hot-board`/`--search`） | 良好，API 未暴露 |
| 画质选择 | `downloader_base.py:1324-1392`：bit_rate 阶梯 highest/lowest/`<N>p`；original 档 Range 1 字节探测原片后才置顶 | 良好，细节充分（PCDN 死节点、DRM 检测） |
| 文件命名 | `utils/naming.py`：15 变量模板白名单、80 字符二分收缩；`storage/file_manager.py:159-296` 作者目录四风格 | 良好 |
| 增量下载 | 磁盘索引优先 + DB 兜底三层判定（`downloader_base.py:239-267`）；`increase[mode]=false` 强制重下 | 良好（双源问题见 §3.4） |
| 完整性校验 | Content-Length 校验 + 临时文件原子改名 + 0 字节忽略（`storage/file_manager.py`） | 良好 |
| 通知 | `utils/notifier.py`：Bark/Telegram/Webhook 并行、单失败不阻塞 | 良好 |
| 转写 | `core/transcript_manager.py`（OpenAI API）+ 独立 `cli/whisper_transcribe.py`（本地 Whisper） | 良好，仅视频 |

## 5. 认证链路（Cookie / msToken / Playwright）

**健壮性评分：中（偏强的中）**——自动重登闭环、msToken 三级兜底齐备，但均为被动响应式。

- Cookie 来源优先级：config.yml `cookies` dict / header 字符串 → `DOUYIN_COOKIE` env → `auto` 自动查找 `config/cookies.json` 或 `.cookies.json`（config_loader.py:257-315）。`CookieManager` 默认持久化为工作目录 `.cookies.json`（POSIX chmod 600）。
- 手动登录：`python -m tools.cookie_fetcher`（Playwright 打开浏览器→用户登录→Enter→`storage_state()` 导出，多源抢救 msToken，可回写 config.yml）。
- msToken 三级兜底（近三条提交主线）：cookie 自带 → mssdk 真实接口（conf 取自 F2 的 GitHub raw，不可达时回退内置快照 `auth/ms_token_conf.py`；类级单飞 + 60s scope 缓存 + 3s 探测超时 + 300s 失败冷却）→ 随机 182 字符（**实测触发风控，主页只能翻前几页**）。
- 失效判定：API 响应 `status_code==2483` 或 status_msg 含登录提示 → `LoginRequiredError`（api_client.py:125-148）；CLI 下交互式重登一次，serve/容器内直接失败。
- Playwright 浏览器兜底：post 翻页受限三种触发（页空 status_code=0 / 45s 页超时 / cursor 停滞）；默认非 headless 支持人工过验证码；不持久化用户数据目录（每次全新 context 注入 cookie，剔除 sessionid 等敏感项），结束后把浏览器 cookie 同步回 API 实例。

**最薄弱三点**：
1. `validate_cookies` 只查 3 个 key 存在性，**无活性探测**——Cookie 是否有效启动时完全未知
2. 失效恢复强依赖 TTY + Playwright，serve/容器场景无出路提示以外的任何手段
3. 签名（a_bogus/X-Bogus 纯 Python 静态复刻）与真 msToken 供给链（GitHub conf + mssdk 端点 + 内置快照）均为外部单点，抖音风控升级即整体失效——这是全行业共性风险（TikTokDownloader 甚至因此停更加密算法）

## 6. 存储层（SQLite）

`storage/database.py`（808 行），WAL + synchronous=NORMAL，aiosqlite 异步。

| 表 | 内容 | 状态 |
|---|---|---|
| `aweme` | 作品明细（+ 迁移列 author_sec_uid / cover_urls / job_id） | 生产使用中 |
| `download_history` | 每次任务 URL/类型/总数/成功数/脱敏配置快照 | 生产使用中（仅 CLI 写） |
| `transcript_job` | 转写任务状态 | 生产使用中 |
| `job` | 任务中心记录（含 retry_history/overrides） | **已建表+读写方法齐备，零生产调用**（从桌面仓同步的半成品） |

- 迁移机制：无版本表，`PRAGMA table_info` + 幂等 `ALTER TABLE`，重跑安全。
- **已实现但零生产调用的查询能力**：`get_aweme_history`、`get_top_authors`、`get_aweme_count_by_author`、`delete_aweme_by_ids`、`truncate_history`、`get_latest_aweme_time`、`upsert_job/load_terminal_jobs/delete_jobs`——历史查询/任务持久化只差端点接线。
- 状态机不一致：server 侧 `JobStatus` 无 CANCELLED（server/jobs.py:20-26），DB 查询却过滤 `'cancelled'`（database.py:752）。

## 7. REST API 现状与缺口

端点（server/app.py:161-182）：`GET /api/v1/health`、`POST /api/v1/download`（body `{"url"}`，返回 job_id 即异步执行）、`GET /api/v1/jobs/{id}`、`GET /api/v1/jobs`。内存任务队列：信号量并发 + TTL 24h + 容量 500 LRU 剪裁 + 优雅 shutdown；FastAPI 自带 `/docs`。tests/test_server.py 有 10 个用例。

对照"CLI / REST / 未来 UI 共用 Task Service"目标的缺口：

1. 无统一编排抽象（三处复制，见 §3.4）
2. 任务不持久化、重启即丢；job 表就绪未接线；无 cancel/retry 端点；无进度流
3. server 任务不写库、不传 job_id，aweme↔job 关联断裂；增量判定在 API 路径降级为纯扫盘
4. 端点缺口：热榜/搜索（discovery 未暴露）、历史查询、配置读写、transcript 状态
5. 无自动重登录包裹；并发参数双轨（`thread` 同时喂 QueueManager 与 JobManager）

## 8. 测试与工程化

- 测试：65 个文件、全量 650 项（2026-09-12 实测 649 passed / 1 skipped / 18.8s），pytest + pytest-asyncio(auto) + hypothesis(4 文件)；tests/AGENTS.md 明文要求 mock 一切外部 HTTP；基本零真实网络/Cookie 依赖。覆盖全部主要子系统。
- 本地环境事实：接手时 `.venv` **未装任何 dev 依赖**（pytest 缺失，文档命令 `PYTHONPATH=. pytest -q` 直接报 No module named pytest）；已补装 pytest 9.1.1 / pytest-asyncio 1.4.0 / ruff 0.16.7 / hypothesis 6.168.0 / fastapi 0.141.1，`ruff check .` 全绿。
- 已修复一处 flaky：`tests/test_live_replay_remux.py::test_remux_timeout_kills_reaps_and_removes_partial_output`——事件循环停顿 ≥1s 时内外两个定时器同批唤醒、双重 cancel 同一任务，`asyncio.timeouts` 的 uncancel 簿记失配使内层 TimeoutError 不再转换（纯 asyncio 探针可确定性复现）。生产代码在该路径仍正确杀进程并回收，属测试设计脆弱：外层安全网 1.0s→5.0s 修复。
- 测试缺口：`core/retry_executor.py` 无专属测试；浏览器兜底仅 mock 级；直播录制真实断流边界未覆盖。
- **README 曾宣称有 GitHub Actions CI 而仓库无 `.github/workflows/`——2026-09-12 已补最小 CI**（ruff + pytest，py3.12，与本地基线环境一致）。
- Dockerfile（26 行）：`python:3.12-slim` 单阶段构建，**root 运行**、无 HEALTHCHECK、无 compose、不含 playwright（容器内浏览器兜底不可用）、`.dockerignore` 漏 `.venv/`/`.runtime/`/`tests/`（`COPY . .` 会把本地环境打进镜像）。能跑但工程粗糙。
- Python 版本口径三处不一致：README 写 3.8+、AGENTS.md 要求 3.8 兼容（禁海象/match）、pyproject 声明 >=3.9、本地 venv 实为 3.12。
- 依赖：aiohttp/aiofiles/aiosqlite/httpx/rich/pyyaml/python-dateutil/gmssl(国密 SM3/SM4)/imageio-ffmpeg==0.6.0(pin)；可选组 browser(playwright)、transcribe(openai-whisper)、server(fastapi/uvicorn/pydantic)、dev(pytest/ruff/hypothesis)。

## 9. Git 安全审计（2026-09-12 实测）

- `git ls-files` 无任何敏感文件被跟踪（cookie 命名的均为正常源码）。`.cookies.json`、`config.yml`、`dy_downloader.db`、`.runtime/`、`.venv/`、`Downloaded/` 各有 `.gitignore` 精确命中规则。
- 待办漏洞：SQLite 边车 `*.db-wal`/`*.db-shm`/`*.db-journal` 未覆盖；`config*.yaml` 与 `*.env` 未覆盖；cookie 仅按两个精确路径匹配，泛化 `*cookies*.json` 不受保护；`.gitignore` 的 `.runtime/` 改动与 `run.sh` 未提交。（**2026-09-12 已全部核销**：规则已补齐并提交，run.sh 已入库）

## 10. 文档失实清单（需在短期修复）

| 位置 | 失实内容 | 实际 |
|---|---|---|
| README | "CI/CD: GitHub Actions" | 无 `.github/workflows/` |
| README/README.zh-CN | 未声明与上游 fork 关系 | 全 91 提交作者为 jiji262 |
| `PROJECT_SUMMARY.md`（2026-02-18） | "SQLite 不参与增量跳过判断" | 已被磁盘+DB 双重检查取代（downloader_base.py:248-257） |
| `tests/AGENTS.md` | "23 test modules" | 实际 65 |
| README vs pyproject vs AGENTS.md | Python 3.8+ / >=3.9 / 3.8 兼容 | 口径待统一 |

> **2026-09-12 当日核销**：上表 5 项已全部处理——README 中英双版声明 fork 关系、Python 统一为 3.9+、`PROJECT_SUMMARY.md` 加归档头注、`tests/AGENTS.md` 计数修正为 65、CI 已补齐；双仓同步条款同日按独立维护策略修订（CLAUDE.md / AGENTS.md，对应 roadmap D1 默认建议）。

## 11. 未验证项声明

1. ~~未运行测试套件~~（**已验证 2026-09-12**：649 passed / 1 skipped，修复 1 处 flaky 后稳定全绿；详见 §8 与文末更新记录）。
2. `aweme_count` 不可靠、随机 msToken 触发风控翻页受限等结论来自代码注释与提交信息，未做线上复现。
3. 外部项目调研仅基于各仓库 README 与公开文档，未阅读其源码（F2 的 ABogus 开源实现等结论以 README 宣称为准）。
4. 桌面姊妹仓（douyin-downloader-desktop）本机不存在，其 schema/功能差异仅来自 AGENTS.md 自述。（2026-09-12：双仓同步条款已按"独立维护"修订，该路径不再是任何工作流的前提。）

## 12. 更新记录

| 日期 | 变更 | 对应提交 |
|---|---|---|
| 2026-09-12 | 初版快照（纯静态分析） | 49ae5fb 落盘 |
| 2026-09-12 | 短期 #0 测试基线建立：补装 dev 依赖、全量 649 绿、修复 remux 用例双重取消竞态 flaky | 9f22854 |
| 2026-09-12 | 短期 #1 git 卫生（.gitignore 边车/泛化敏感规则 + run.sh 入库） | 2b6f422、7b368e9 |
| 2026-09-12 | 短期 #3 文档口径统一 + roadmap D1 双仓条款按默认建议修订 | d65d6b2、95b8462 |
| 2026-09-12 | 短期 #4 最小 CI 补齐 | 249746e |
