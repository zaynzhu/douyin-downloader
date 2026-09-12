<div align="center">

<img src="img/logo.png" alt="douyin-downloader Logo" width="180">

# douyin-downloader

**一个本地、自用、免费开源的抖音批量下载工具。**

[English](README_EN.md) · [配置示例](config.example.yml) · [开发路线图](docs/analysis/2026-09-12-roadmap.md)

</div>

<div align="center">

![License](https://img.shields.io/github/license/zaynzhu/douyin-downloader?style=for-the-badge)
![Stars](https://img.shields.io/github/stars/zaynzhu/douyin-downloader?style=for-the-badge)
![Forks](https://img.shields.io/github/forks/zaynzhu/douyin-downloader?style=for-the-badge)
![Last Commit](https://img.shields.io/github/last-commit/zaynzhu/douyin-downloader?style=for-the-badge)
![Issues](https://img.shields.io/github/issues/zaynzhu/douyin-downloader?style=for-the-badge)
![Build](https://img.shields.io/github/actions/workflow/status/zaynzhu/douyin-downloader/ci.yml?style=for-the-badge&branch=main)

</div>

> [!TIP]
> 支持单视频、图文、合集、音乐、直播回放，以及作者主页批量下载（发布 / 喜欢 / 合集 / 音乐）和登录账号收藏夹。
> 无水印优先、最高画质选择、磁盘增量下载、失败重试、SQLite 下载记录，翻页受限时自动浏览器兜底。
> CLI 与 REST API 共用同一套核心，所有数据只落在本机。

---

## 🌟 关于本 Fork

本仓库 fork 自 [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader)，独立维护，感谢上游的持续开发。

- **定位**：本地、自用、开源、免费的个人工具，不追求企业级与高并发
- **方向**：先完善核心下载体验，再收敛为统一的 Task Service，然后逐步补全 REST API 与自托管 Web UI
- **永远不做**：邀请码、会员、内测资格、License 校验、在线账号强制登录、任何形式的收费
- 上游另有一个闭源内测的桌面端产品 Douzy，属于上游项目，本仓库不发布、不维护桌面端

---

## ✨ 功能特性

- **单链接下载** -- 视频、图文、合集、音乐、短链接自动识别，直播回放可录制
- **主页批量下载** -- 发布 / 喜欢 / 合集 / 音乐四种模式，登录后支持收藏夹与收藏合集
- **无水印 + 最高画质** -- 自动优先无水印源，按 `bit_rate` 阶梯选择最高画质，支持 original 档原片探测
- **增量下载** -- 磁盘文件存在即跳过，删掉文件下次自动补下；支持 `start_time` / `end_time` 时间过滤
- **浏览器兜底** -- 翻页被风控拦截时自动拉起浏览器滚动采集，支持人工过验证码
- **REST API** -- `--serve` 一键启动 FastAPI 服务，提交任务、查询状态
- **下载完整可靠** -- 并发下载、指数退避重试、Content-Length 完整性校验、临时文件原子落盘
- **丰富的附加产物** -- 封面、音乐、头像、原始 JSON、评论采集、Bark / Telegram / Webhook 完成通知、视频转写

<details>
<summary>完整能力清单</summary>

| 能力 | 说明 |
|------|------|
| 单视频下载 | `/video/{aweme_id}` |
| 单图文下载 | `/note/{note_id}`、`/gallery/{note_id}` |
| 单合集下载 | `/collection/{mix_id}`、`/mix/{mix_id}` |
| 单音乐下载 | `/music/{music_id}`（优先直下音频，失败回退首条相关作品） |
| 短链接解析 | `https://v.douyin.com/...`、`v.iesdouyin.com`、裸域名 |
| 主页批量下载 | `/user/{sec_uid}` + `mode: [post, like, mix, music]` |
| 登录收藏夹 | `/user/self?showTab=favorite_collection` + `mode: [collect, collectmix]` |
| 直播录制 | `live.douyin.com/{room_id}`，FLV/HLS，断流保留已录数据（实验性） |
| 评论采集 | 逐作品评论（含二级回复可选），存为 `*_comments.json` |
| 热榜与搜索 | `--hot-board [N]` / `--search "关键词"`，输出 JSONL |
| 完成通知 | Bark / Telegram / Webhook（企业微信、飞书、钉钉机器人均可） |
| 视频转写 | 可选，OpenAI Transcriptions API，输出 txt/json |
| 下载记录 | SQLite 历史表 + `download_manifest.jsonl` 清单 |
| 速率限制 | 默认 2 req/s，API 层全局生效 |
| 代理支持 | HTTP/HTTPS 代理，覆盖 API、媒体下载与浏览器兜底 |

</details>

<details>
<summary>已知限制</summary>

- 浏览器兜底仅对 `post` 模式完整验证；`like` / `mix` / `music` 依赖 API 分页
- `collect` / `collectmix` 仅支持当前登录 Cookie 对应的账号，且不能与其他模式混用
- 增量下载适用于 `post` / `like` / `mix` / `music`；收藏夹模式不支持增量停止
- 直播录制原生保存 FLV；HLS 源仅保存清单，需 ffmpeg 后处理
- 直播间接口未覆盖全部直播场景，视为实验性能力

</details>

---

## 🚀 快速开始

### 1) 环境要求

- Python 3.9+
- macOS / Linux / Windows

### 2) 安装依赖

```bash
pip install -r requirements.txt
```

需要浏览器兜底与自动 Cookie 获取时，额外安装：

```bash
pip install playwright
python -m playwright install chromium
```

### 3) 复制配置文件

```bash
cp config.example.yml config.yml
```

### 4) 获取 Cookie（推荐自动方式）

```bash
python -m tools.cookie_fetcher --config config.yml
```

在弹出的浏览器里登录抖音，回到终端按回车，Cookie 会自动写入配置。

### 5) 运行

```bash
python run.py -c config.yml
```

本地开发推荐直接用仓库自带的启动脚本（自动激活 `.venv` 并隔离运行时目录）：

```bash
./run.sh
```

<details>
<summary>Docker 部署（可选）</summary>

```bash
docker build -t douyin-downloader .
docker run -v $(pwd)/config.yml:/app/config.yml -v $(pwd)/Downloaded:/app/Downloaded douyin-downloader
```

</details>

---

## ⚙️ 最小可用配置

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx

path: ./Downloaded/
mode:
  - post

number:
  post: 0

thread: 5
retry_times: 3
proxy: ""
database: true
database_path: dy_downloader.db

progress:
  quiet_logs: true

cookies:
  msToken: ""
  ttwid: YOUR_TTWID
  odin_tt: YOUR_ODIN_TT
  passport_csrf_token: YOUR_CSRF_TOKEN
  sid_guard: ""

browser_fallback:
  enabled: true
  headless: false
  max_scrolls: 240
  idle_rounds: 8
  wait_timeout_seconds: 600
```

---

## 💡 典型场景

### 下载单个视频

```yaml
link:
  - https://www.douyin.com/video/7604129988555574538
```

### 下载图文

```yaml
link:
  - https://www.douyin.com/note/7341234567890123456
```

### 下载合集

```yaml
link:
  - https://www.douyin.com/collection/7341234567890123456
```

### 下载音乐

```yaml
link:
  - https://www.douyin.com/music/7341234567890123456
```

### 批量下载作者发布的作品

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
number:
  post: 50
```

### 批量下载作者喜欢的作品

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - like
number:
  like: 0    # 0 表示全部下载
```

### 多模式同时下载

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
  - like
  - mix
  - music
```

跨模式去重：同一个 `aweme_id` 不会在不同模式间重复下载。

### 下载登录账号的收藏夹

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collect
number:
  collect: 0
```

### 下载登录账号的收藏合集

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collectmix
number:
  collectmix: 0
```

### 录制直播（实验性）

```yaml
link:
  - https://live.douyin.com/123456789   # 或 /follow/live/{room_id}
live:
  max_duration_seconds: 3600   # 0 表示一直录到主播下播
  chunk_size: 65536
  idle_timeout_seconds: 30
```

录制产物保存在 `Downloaded/{author}/live/` 下的 FLV 文件加 `*_room.json` 元数据快照。主播下播、网络空闲或 Ctrl+C 时，已录制的字节全部保留（`.tmp` 临时文件提升为正式文件）。

### 采集评论

```yaml
comments:
  enabled: true
  include_replies: false   # true 会额外请求每条评论的二级回复
  max_comments: 500        # 0 表示不设上限
  page_size: 20
```

在媒体文件旁生成 `{date}_{title}_{aweme_id}_comments.json`。

### 导出热榜

```bash
python run.py --hot-board 30 -p ./Downloaded
# 输出: ./Downloaded/hot_board/20260424_221530.jsonl
```

### 关键词搜索

```bash
python run.py --search "猫咪" --search-max 100 -p ./Downloaded
# 输出: ./Downloaded/search/猫咪_20260424_221530.jsonl
```

### 完成通知

```yaml
notifications:
  enabled: true
  on_success: true
  on_failure: true
  providers:
    - type: bark
      url: https://api.day.app/YOUR_DEVICE_KEY
      sound: bell
    - type: telegram
      bot_token: "123456:ABC..."
      chat_id: "987654321"
    - type: webhook                 # 企业微信/飞书/钉钉机器人地址同样适用
      url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
      extra_body:
        msgtype: text
```

所有启用的通知渠道并行发送，单个渠道失败不会阻塞下载流程。

### 命令行参数

```bash
python run.py -c config.yml \
  -u "https://www.douyin.com/video/7604129988555574538" \
  -t 8 \
  -p ./Downloaded
```

| 参数 | 说明 |
|------|------|
| `-u, --url` | 追加下载链接，可重复 |
| `-c, --config` | 指定配置文件（默认 `config.yml`） |
| `-p, --path` | 指定下载目录 |
| `-t, --thread` | 指定并发数 |
| `--show-warnings` | 显示 warning/error 日志 |
| `-v, --verbose` | 显示 info/warning/error 日志 |
| `--hot-board [N]` | 导出抖音热搜榜 JSONL，可选 top-N |
| `--search KEYWORD` | 关键词搜索视频，输出 JSONL |
| `--search-max N` | `--search` 的最大条数（默认 50） |
| `--check-auth` | 探测当前 Cookie 是否有效后退出（退出码 0=有效），不执行下载 |
| `--serve` | 以 REST API 服务运行（需安装 fastapi、uvicorn） |
| `--serve-host HOST` | REST 服务监听地址（默认 127.0.0.1） |
| `--serve-port PORT` | REST 服务监听端口（默认 8000） |
| `--version` | 显示版本号 |

---

## 📡 REST API 模式

```bash
pip install fastapi uvicorn       # 一次性可选依赖
python run.py --serve --serve-port 8000
```

### Web UI

服务启动后打开 `http://127.0.0.1:8000` 即得自托管网页界面（纯静态前端，由 FastAPI 托管，无 Node 构建链）：

- **下载** — 粘贴分享链接或整段分享文案，自动识别链接、去重，逐条提交下载
- **任务** — 实时任务中心：五态（排队/进行中/完成/失败/已取消）、取消与重试、进度计数
- **历史** — 下载历史查询：按作者/标题搜索、类型/日期/任务过滤、分页、查看文件位置
- **设置** — 服务状态与健康检查；Cookie 状态提示与修复命令指引（本版本无页内配置写入）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/download` | 提交 `{"url": "..."}`，返回 `{job_id, status}` |
| GET | `/api/v1/jobs/{job_id}` | 查询单个任务状态与计数 |
| GET | `/api/v1/jobs` | 列出近期任务（受 TTL 与容量上限约束） |
| POST | `/api/v1/jobs/{job_id}/cancel` | 取消未完成任务（终态任务返回 409） |
| POST | `/api/v1/jobs/{job_id}/retry` | 用原 URL 提交新任务重试（磁盘增量保证幂等），返回 201 |
| GET | `/api/v1/downloads` | 分页查询下载历史（支持 `page`/`size`/`author`/`title`/`aweme_type`/`job_id`/`date_from`/`date_to` 过滤） |
| GET | `/api/v1/downloads/authors` | 近 N 天下载量 Top 作者（`days`/`limit` 参数） |
| GET | `/api/v1/health` | 健康检查 |

`database: true` 时，终态任务（success / failed / cancelled）持久化到 SQLite 的 `job` 表，服务重启后仍可查询；API 任务同时写入 `aweme` / `download_history` 并与 job 关联。内存中的任务列表仍按 TTL（默认 24h）与最大任务数（默认 500）清理，进行中任务永不清理，通过 `server.max_jobs` / `server.job_ttl_seconds` 调整。

---

## 🔧 关键配置项

| 字段 | 说明 |
|------|------|
| `data_root` | 可选数据根目录：设置后未显式配置的 `path` / `database_path` 落位于 `<data_root>/downloads` 与 `<data_root>/database`（支持环境变量 `DOUYIN_DATA_ROOT`） |
| `mode` | `post` / `like` / `mix` / `music`；登录收藏模式额外支持独立的 `collect` / `collectmix` |
| `number.post/like/mix/music/...` | 各模式下载数量上限，0 表示不限 |
| `increase.post/like/mix/music` | `true`：磁盘已有主媒体则跳过；`false`：在当前范围内强制重下 |
| `start_time` / `end_time` | 时间过滤，格式 `YYYY-MM-DD` |
| `folderstyle` | 按作品建立独立子目录 |
| `browser_fallback.*` | `post` 模式翻页受限时的浏览器兜底配置 |
| `progress.quiet_logs` | 进度阶段静默日志 |
| `comments.*` | 逐作品评论采集（按需开启） |
| `live.*` | 直播录制选项（max_duration_seconds / chunk_size / idle_timeout_seconds） |
| `transcript.*` | 视频转写（OpenAI Transcriptions API） |
| `notifications.*` | Bark / Telegram / Webhook 完成通知 |
| `server.*` | REST API 服务调优（max_jobs、job_ttl_seconds） |
| `proxy` | HTTP/HTTPS 代理 |
| `database` | 启用 SQLite 下载历史 |
| `database_path` | SQLite 路径，默认工作目录下的 `dy_downloader.db` |
| `thread` | 并发下载数 |
| `retry_times` | 失败重试次数 |

---

## 📁 输出目录结构

`folderstyle: true` 时的默认结构：

```text
Downloaded/
├── download_manifest.jsonl
├── hot_board/                # 使用 --hot-board 时
│   └── 20260424_221530.jsonl
├── search/                   # 使用 --search 时
│   └── 猫咪_20260424_221530.jsonl
└── 作者名/
    ├── post/
    │   └── 2024-02-07_作品标题_aweme_id/
    │       ├── ...mp4
    │       ├── ..._cover.jpg
    │       ├── ..._music.mp3
    │       ├── ..._data.json
    │       ├── ..._avatar.jpg
    │       ├── ..._comments.json    # 开启 comments 时
    │       ├── ...transcript.txt    # 开启 transcript 时
    │       └── ...transcript.json
    ├── like/
    ├── mix/
    ├── music/
    ├── collect/
    ├── collectmix/
    └── live/                 # 录制直播时
        └── 2026-04-24_2215_直播标题_房间号/
            ├── ...flv
            └── ..._room.json
```

---

## 🔁 增量下载与强制重下

```yaml
increase:
  post: true
```

`true` 时只有当前下载目录下已存在**非空主媒体文件**才会跳过；删掉媒体文件，下次运行会重新下载。设为 `false` 则在当前数量/时间/媒体类型过滤范围内强制重下并原子替换。

> [!NOTE]
> 只删数据库记录、保留本地文件**不会**触发重下——程序按文件名中的 `aweme_id` 扫描本地判断；只删文件、保留数据库记录**会**触发重下（"库里有但本地缺失"视为待补下）。

强制重下操作示例：

```bash
# 重下单个作品（目录名含 aweme_id）
rm -rf Downloaded/作者名/post/*_<aweme_id>/

# 重下某作者全部作品
rm -rf Downloaded/作者名/

# 完全重置
rm -rf Downloaded/
rm dy_downloader.db
```

---

## 🧪 测试与开发

全量测试为纯离线 mock，不访问真实抖音接口：

```bash
pip install "pytest>=7.0" "pytest-asyncio>=0.21" "ruff>=0.4.0" "hypothesis>=6.0"
python -m pytest -q
ruff check .
```

开发文档位于 [docs/](docs/000-index.md)：项目现状分析、参考项目调研（含 License 约束）、三阶段路线图与决策记录。

---

## 🗺️ Roadmap

| 方向 | 内容 | 状态 |
|------|------|:----:|
| 核心 CLI | 单视频 / 图文 / 合集 / 音乐 / 主页批量 / 直播 / 评论 / 搜索 / 转写 | ✅ |
| 工程化 | 650 项测试基线、CI、文档治理、安全审计 | ✅ |
| Task Service | 统一 CLI / REST / 重试三处编排，任务持久化与取消重试 | 🔄 |
| REST API | 历史查询、任务取消、任务重试、配置端点 | 📋 |
| Web UI | 粘贴下载、任务中心、下载历史、设置，纯调用 Task Service | 📋 |
| Docker 正式化 | 非 root、多架构、数据集中 `/data` | 📋 |

完整规划与每一步的取舍论证见[开发路线图](docs/analysis/2026-09-12-roadmap.md)。

---

## ❓ FAQ

<details>
<summary>为什么主页只下载到 20 条左右？</summary>

这是常见的翻页风控行为。确认：

- `browser_fallback.enabled: true`
- `browser_fallback.headless: false`
- 在弹出的浏览器中手动完成验证，不要过早关闭窗口

</details>

<details>
<summary>进度输出太吵 / 反复刷屏？</summary>

默认 `progress.quiet_logs: true` 会在进度阶段抑制日志。调试时临时加 `--show-warnings` 或 `-v`。

</details>

<details>
<summary>Cookie 过期了怎么办？</summary>

重新执行：

```bash
python -m tools.cookie_fetcher --config config.yml
```

</details>

<details>
<summary>为什么没有生成转写文件？</summary>

按顺序检查：

- `transcript.enabled` 是否为 `true`
- 下载项是否为视频（图文不生成转写）
- `OPENAI_API_KEY`（或 `transcript.api_key`）是否有效
- `response_formats` 是否包含 `txt` 或 `json`

</details>

<details>
<summary>怎么查看下载历史？</summary>

```bash
sqlite3 dy_downloader.db "SELECT aweme_id, title, author_name, datetime(download_time, 'unixepoch', 'localtime') FROM aweme ORDER BY download_time DESC LIMIT 20;"
```

</details>

---

## 🙏 致谢与参考

- [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) -- 上游项目，本仓库的主体能力继承于此
- [Johnserf-Seed/f2](https://github.com/Johnserf-Seed/f2) -- msToken 配置来源与抖音接口设计参考（Apache-2.0）
- 更多参考（TikTokDownloader 的功能规划思路、res-downloader 的产品体验）：见[参考项目调研](docs/analysis/2026-09-12-reference-projects.md)

---

## ⚠️ 免责声明

本项目仅供技术研究、学习与个人数据管理使用，请合法、负责任地使用：

- 不得用于侵犯他人隐私、著作权或其他合法权益
- 不得用于任何违法用途
- 使用者自行承担因使用产生的一切风险与责任
- 平台策略或接口变化导致功能失效，属正常技术风险

继续使用本项目即视为已知悉并接受以上声明。

---

## 📄 License

本项目基于 [MIT License](LICENSE) 开源。
