# 接手分析报告（终端交付版快照，2026-09-12）

> 本文件是 2026-09-12 接手分析时直接交付给用户的终端报告的落盘快照，保留当时的原始结构与措辞（仅去除对话性语句）。
> 其内容已被扩展整理为同目录三份维护性文档（`2026-09-12-current-state.md` / `2026-09-12-reference-projects.md` / `2026-09-12-roadmap.md`），**后续维护以那三份为准**；本快照的价值是保留当时的原始判断与思考路径，供对照与追溯。

## 0. 总览判断

这个仓库的成熟度**显著高于**任务简报中的描述。它不是"一个需要完善的 CLI 小工具"，而是：131 个 Python 文件、约 3.15 万行（不含测试约 1.9 万行）、**69 个测试文件 / 593 个测试函数 / 全 mock 零真实网络依赖**的中型项目，采用 spec→plan→implement 文档驱动开发（`docs/superpowers/`），且一直与一个不存在的本地桌面仓做双向同步。

当前最大的问题不是某个功能缺失，而是：**编排层三处重复、REST API 是刻意裁剪的子集、数据库一半能力未接线**。这正好与简报第九节"Task Service"方向吻合——现有代码已经为此备好了半成品。

## 1-2. 目录结构与核心调用链

```text
run.py（仅 sys.path 引导）→ cli/main.py main() → asyncio.run(main_async)
  → ConfigLoader 四层合并（默认值 → YAML → DOUYIN_* 环境变量 → CLI 参数；config/config_loader.py:23-131）
  → 逐链接 download_url（外层包 _run_with_relogin 自动重登一次；cli/main.py:40-193）
    → 短链识别（utils/validators.py:71-85）→ resolve_short_url 跟 302（core/api_client.py:1348）
    → parse_url_type + URLParser.parse（video/note/gallery/user/collection/mix/music/live/lvdetail）
    → 能力门禁 UNSUPPORTED_URL_TYPE_DETAIL（core/downloader_factory.py:22-24，放映厅 DRM 版权影视直接拒绝）
    → DownloaderFactory.create → downloader.download(parsed)
    → 写 download_history（剔除 cookies 等敏感键）→ Bark/Telegram/Webhook 通知
```

用户主页走 `UserDownloader` → `UserModeRegistry` 六种策略（post/like/mix/music/collect/collectmix），每种策略 `collect_items`（分页 + cursor 停滞检测 + 时间边界提前停页）→ `apply_filters`（置顶→时间→媒体类型→限量）→ 批量下载。目录设计（工厂 + 策略注册表 + `control/` 三个并发原语小类）是清晰的。

## 3. CLI → Core 关系

优点：配置四层合并带白名单回写（`save()` 只持久化 `_UI_PERSISTED_KEYS`，防敏感键落盘）；下载容错有多级防线（候选 CDN 轮换、整轮退避、单作品 900s 兜底、DRM 密文落盘检测后删除、慢节点 20KB/s 吞吐地板）。

结构性问题（真实存在、非过度设计指控）：

| 问题 | 位置 | 影响 |
|---|---|---|
| 编排逻辑三处手工同步复制 | `cli/main.py:75-193`、`server/app.py:78-126`、`core/retry_executor.py:87-141` | 新增链接类型/门禁要改三处，已实际漂移（server 版不接库、不传 job_id） |
| BaseDownloader 巨类 1643 行 | `core/downloader_base.py` | 画质、图集候选、本地索引、评论、manifest 全塞一起；策略层 `getattr` 反调宿主保护方法，双向耦合 |
| ConfigLoader 是全局可变接口 | 30+ 字符串键裸读，per-job 靠 `config.update`+手工快照恢复 | 多 job 并发会互相污染配置 |
| 增量状态双源 | 磁盘文件名正则索引 + DB `is_downloaded` | 判定规则分散两处；每个下载器实例各自全库 rglob 扫盘一次 |

## 4-5. REST API 与任务模型

REST API 是 FastAPI（可选依赖）同进程 `--serve` 模式，与 CLI 互斥。仅 4 个端点：`POST /api/v1/download`、`GET /api/v1/jobs/{id}`、`GET /api/v1/jobs`、`GET /api/v1/health`（自带 `/docs`）。任务模型：`DownloadJob`（PENDING→RUNNING→SUCCESS/FAILED）**纯内存存储**，TTL 24h + 容量 500 剪裁，重启即丢。

与"Task Service"目标的差距全部可查：

- **server 任务不写数据库**（`server/app.py:111` 显式 `database=None`，注释"避免单例冲突"）→ API 任务无历史记录、增量判定降级
- **`Database.job` 表 + `upsert_job/load_terminal_jobs` 已建好但零生产调用**——从桌面仓同步过来的半成品
- 状态机不一致：`JobStatus` 无 CANCELLED，但 DB 查询却过滤 `'cancelled'`（`storage/database.py:752`）
- 无 cancel/retry/进度流端点；无配置读写端点；server 路径无自动重登录包裹
- `get_aweme_history`/`get_top_authors`/`truncate_history` 等查询方法已实现无调用方——**历史查询功能只差一层端点包装**

## 6. 下载记录 / SQLite

WAL 模式，4 张表：`aweme`（作品明细，带 author_sec_uid/cover_urls/job_id 迁移列）、`download_history`、`transcript_job`、`job`（未接线）。迁移用 `PRAGMA table_info` + 幂等 `ALTER TABLE`，无版本表，重跑安全。增量判定是**磁盘索引优先、DB 兜底**的三层逻辑（`downloader_base.py:239-267`）。注意 `PROJECT_SUMMARY.md` 里"SQLite 不参与增量跳过"的说法已过时。

## 7. Cookie / Playwright

- **Cookie 来源**：config.yml dict/字符串 → `DOUYIN_COOKIE` env → `auto` 时找 `config/cookies.json` 或 `.cookies.json`；`tools.cookie_fetcher` 提供 Playwright 手动登录抓取（多源抢救 msToken + 只保留推荐子集 + 可回写 config.yml）。
- **msToken 三级兜底**（近三条提交的主线）：cookie 自带 → mssdk 真实接口（F2 的远端 conf，GitHub 不可达时回退 2026-09-06 捕获的内置快照，单飞 + 60s 缓存 + 3s 超时 + 300s 失败冷却）→ 随机 182 字符（**实测会触发风控，主页只能翻前几页**）。
- **失效检测**：`validate_cookies()` 只静态查 3 个 key 存在性，**无活性探测**；真实失效靠 API 返回 status_code 2483 抛 `LoginRequiredError`，CLI 下交互式重登一次，serve/容器内直接失败。

**最薄弱三点**：① 启动时 Cookie 是否有效完全未知；② 失效恢复强依赖 TTY+Playwright；③ 签名与 token 供给链是静态复刻 + 外部 conf 单点。

## 8. 图文与主页批量

- 图文与视频共用 `VideoDownloader`，按 `aweme_type`（2/68/150）与 `images` 字段判型，多镜像逐图降级 + livephoto mp4 处理，工程细节成熟。
- 主页批量：post 策略有 45s 页超时、cursor 死循环防护、**时间边界提前停页**（近 11 条提交的主线）、置顶过滤（`download_pinned`）、末页越界不触发浏览器回补；`aweme_count` 风控下不可靠（只回 20），靠浏览器兜底回补缺失 aweme_id。
- 直播间录制、直播回放、评论采集、热榜/搜索 JSONL、音频提取、Whisper 转写均为已有能力。

## 9-10. .gitignore 与敏感文件检查 ✅

**结论：当前无任何敏感文件被 Git 跟踪。** 逐条验证：`config.yml`、`.cookies.json`、`dy_downloader.db`、`.runtime/`、`.venv/`、`Downloaded/` 各有命中规则；`git ls-files` 里只有名字含 cookie 的正常源码。

**需要收尾的小项**：
- `.gitignore` 新增 `.runtime/` 的改动**尚未提交**
- 规则漏洞：`*.db-wal`/`*.db-shm`/`*.db-journal` 边车文件、`config*.yaml`、`*.env`、泛化的 `*cookies*.json` 未覆盖
- `run.sh` 内容完全可移植（`$PWD` 相对路径、无秘密），建议提交入库
- ⚠️ **双仓同步条款失效风险**：`CLAUDE.md`/`AGENTS.md` 要求与 `/Users/crimson/codes/douyin/douyin-downloader-desktop` 同步，但**该路径在本机不存在**。要么更新为真实路径，要么明确记录独立维护策略——这需要用户确认

## 11. 四个参考项目的可借鉴清单

| 项目 | 值得借鉴 | 备注 |
|---|---|---|
| **F2**（Apache-2.0，可合法参考/署名借用） | TokenManager 完整族（ttwid/webid/verify_fp/s_v_web_id 生成器——我们只有 msToken）；满血 A-Bogus 已开源；作者改名后**目录自动重命名**；json→lrc 歌词；直播弹幕 | 与我们的 msToken 模块已有渊源（conf 就是 F2 的） |
| **TikTokDownloader**（⚠️ **GPLv3，只能参考思路不能抄代码**） | 断点续传、监听剪贴板下载、作者改名自动重命名目录、智能延时请求、CSV/XLSX 导出、Web API 自带 `/docs`（我们已有）、文件完整性校验 | 它的 Web UI 模式已废弃，证明"先 API 后 UI"路线正确；它的加密算法也因合规停更——静态复刻签名是行业共性风险 |
| **res-downloader** | 仅产品体验："打开就会用"（启动代理→刷页面→列表点下载） | 技术路线不适用于我们 |
| **上游 Douzy** | `img/desktop/` 六张截图就在本仓库，是 Web UI 最直接的交互参考（链接工作台/任务中心/关注管理/收藏/归档） | 上游是闭源内测桌面端；我们只借交互，不引入邀请码等机制 |

## 12. 三阶段路线图建议

路线严格对齐"核心 → 结构 → API → Web UI → Desktop → Docker"优先级，每一项都对应已验证的真实问题，不凭空造功能。

### 短期（1-2 周）——卫生 + 核心体验

1. **安全卫生提交**（3 个原子 commit）：提交 `.gitignore` 的 `.runtime/` 改动；补 `*.db-wal` 等边车/`config*.yaml`/`*cookies*.json` 规则；提交 `run.sh`
2. **Cookie 活性自检**：启动时跑一次轻量 API 探测替代摆设式 `validate_cookies`，失效时给出明确指引
3. **文档口径统一**：README 声明 fork 关系、Python 版本三处打架（3.8/3.9/3.12）、`PROJECT_SUMMARY.md` 与 `tests/AGENTS.md` 过期内容更新
4. **补最小 CI**：README 已宣称有 GitHub Actions 但实际没有，补一个 pytest + ruff workflow
5. **确认双仓同步策略**（待决策）

### 中期（1-2 月）——结构收敛 + Task Service

1. **抽 `DownloadService` 统一三处编排**（cli/server/retry_executor）——最优先重构，因为重复已实际造成行为漂移
2. **接线 job 表**：任务持久化 + 状态机对齐 CANCELLED + cancel/retry 端点——半成品就地启用
3. **历史查询端点**：`GET /api/v1/downloads` 包装已有的 `get_aweme_history`/`get_top_authors`
4. **拆 BaseDownloader** 与**类型化 Settings**——只在触碰相关功能时顺手拆对应块，不做一次性大重构
5. **增量判定单一真相源**：磁盘索引为主、实例级缓存替代每次全库 rglob

### 长期（3 月+）——产品化

1. **Web UI**：以 `img/desktop/` 截图为交互蓝本，只做"粘贴链接→任务中心→历史→设置"四页，纯调用已稳定的 Task Service，**无邀请码/会员/License**
2. **DATA_ROOT 抽象 + API 路径校验**（防 path traversal），为部署做准备
3. **Docker 正式化**：非 root、补 `.dockerignore`、compose、healthcheck、多架构——届时一次做透
4. **Desktop 评估**：仅当 Web 不满足需求时再做，优先 Tauri 复用 Web UI
5. **按需借鉴**：断点续传、作者改名目录重命名、直播弹幕等——由真实使用痛点驱动，不批量搬运

---

**验证说明**：本报告基于 4 个只读分析 agent（共约 32 万 token 的代码阅读）+ 手工 git 安全检查与四个外部项目 README 调研；未运行测试（纯静态分析）；未读取任何 cookie/数据库内容；未修改任何文件。

**当时建议的第一个动作**：短期第 1 项（git 卫生三提交）+ 第 5 项（双仓同步策略确认）。