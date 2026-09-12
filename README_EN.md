<div align="center">

<img src="img/logo.png" alt="douyin-downloader Logo" width="180">

# douyin-downloader

**A local, personal, free and open-source Douyin batch downloader.**

[中文](README.md) · [Config example](config.example.yml) · [Roadmap](docs/analysis/2026-09-12-roadmap.md)

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
> Download single videos, image-notes, collections, music, and live replays, plus profile batch downloads
> (posts / likes / mixes / music) and logged-in favorites. No-watermark preferred, highest-quality selection,
> disk-based incremental downloads, retries, SQLite history, and automatic browser fallback when pagination is blocked.
> CLI and REST API share the same core; all data stays on your machine.

---

## 🌟 About This Fork

This repository is a fork of [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader), maintained independently with thanks to the upstream project.

- **Positioning**: a local, personal, free, open-source tool — not aiming for enterprise scale or high concurrency
- **Direction**: polish the core download experience first, converge on a unified Task Service, then progressively complete the REST API and a self-hostable Web UI
- **Never doing**: invite codes, membership, beta qualifications, license checks, forced online accounts, or any form of paid gating
- The upstream project also ships a closed-beta desktop app (Douzy); it belongs to upstream and is not published or maintained by this repository

---

## ✨ Features

- **Single-link downloads** -- videos, image-notes, collections, music, short-link auto-resolve, live replay recording
- **Profile batch downloads** -- post / like / mix / music modes, plus logged-in favorites and collected mixes
- **No watermark + best quality** -- prefers watermark-free sources, picks from the `bit_rate` ladder, with original-quality probing
- **Incremental downloads** -- skips items whose primary media already exist on disk; time-range filtering via `start_time` / `end_time`
- **Browser fallback** -- launches a browser to scroll and collect when pagination is risk-controlled; manual CAPTCHA supported
- **REST API** -- `--serve` starts a FastAPI server to submit jobs and query status
- **Reliable downloads** -- concurrency, exponential-backoff retries, Content-Length integrity checks, atomic file writes via temp files
- **Rich extras** -- cover, music, avatar, raw JSON, comment collection, Bark / Telegram / Webhook notifications, video transcription

<details>
<summary>Full capability list</summary>

| Capability | Details |
|------------|---------|
| Single video | `/video/{aweme_id}` |
| Single image-note | `/note/{note_id}`, `/gallery/{note_id}` |
| Single collection | `/collection/{mix_id}`, `/mix/{mix_id}` |
| Single music | `/music/{music_id}` (prefers direct audio, falls back to the first related aweme) |
| Short links | `https://v.douyin.com/...`, `v.iesdouyin.com`, bare hosts |
| Profile batch | `/user/{sec_uid}` + `mode: [post, like, mix, music]` |
| Logged-in favorites | `/user/self?showTab=favorite_collection` + `mode: [collect, collectmix]` |
| Live recording | `live.douyin.com/{room_id}`, FLV/HLS, partial data preserved on stream end (experimental) |
| Comments | Per-aweme comments (optional replies), saved as `*_comments.json` |
| Hot board & search | `--hot-board [N]` / `--search "keyword"`, dumps JSONL |
| Notifications | Bark / Telegram / Webhook (WeCom / Feishu / DingTalk bot URLs work too) |
| Transcription | Optional, OpenAI Transcriptions API, outputs txt/json |
| Download history | SQLite tables + `download_manifest.jsonl` manifest |
| Rate limiting | Default 2 req/s on the API layer |
| Proxy | HTTP/HTTPS proxy covering API calls, media downloads, and browser fallback |

</details>

<details>
<summary>Known limitations</summary>

- Browser fallback is fully validated for `post` only; `like` / `mix` / `music` rely on API pagination
- `collect` / `collectmix` work only for the account of the logged-in cookies and cannot be combined with other modes
- Incremental downloads apply to `post` / `like` / `mix` / `music`; favorites modes do not support incremental stop
- Live recording saves FLV natively; HLS sources only save the playlist (use ffmpeg for playable output)
- The webcast endpoint is not verified against every live scenario — treat as experimental

</details>

---

## 🚀 Quick Start

### 1) Requirements

- Python 3.9+
- macOS / Linux / Windows

### 2) Install dependencies

```bash
pip install -r requirements.txt
```

For browser fallback and automatic cookie capture:

```bash
pip install playwright
python -m playwright install chromium
```

### 3) Copy the config file

```bash
cp config.example.yml config.yml
```

### 4) Get cookies (recommended: automatic)

```bash
python -m tools.cookie_fetcher --config config.yml
```

Log in to Douyin in the opened browser, then return to the terminal and press Enter. Cookies are written to your config automatically.

### 5) Run

```bash
python run.py -c config.yml
```

For local development, use the bundled launch script (activates `.venv` and isolates runtime directories):

```bash
./run.sh
```

<details>
<summary>Docker deployment (optional)</summary>

```bash
docker build -t douyin-downloader .
docker run -v $(pwd)/config.yml:/app/config.yml -v $(pwd)/Downloaded:/app/Downloaded douyin-downloader
```

</details>

---

## ⚙️ Minimal Working Config

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

## 💡 Typical Scenarios

### Download one video

```yaml
link:
  - https://www.douyin.com/video/7604129988555574538
```

### Download one image-note

```yaml
link:
  - https://www.douyin.com/note/7341234567890123456
```

### Download a collection

```yaml
link:
  - https://www.douyin.com/collection/7341234567890123456
```

### Download a music track

```yaml
link:
  - https://www.douyin.com/music/7341234567890123456
```

### Batch download a creator's posts

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
number:
  post: 50
```

### Batch download a creator's liked posts

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - like
number:
  like: 0    # 0 means download all
```

### Download multiple modes at once

```yaml
link:
  - https://www.douyin.com/user/MS4wLjABAAAAxxxx
mode:
  - post
  - like
  - mix
  - music
```

Cross-mode deduplication: the same `aweme_id` is never downloaded twice across modes.

### Download logged-in favorites collection items

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collect
number:
  collect: 0
```

### Download logged-in collected mixes

```yaml
link:
  - https://www.douyin.com/user/self?showTab=favorite_collection
mode:
  - collectmix
number:
  collectmix: 0
```

### Record a live stream (experimental)

```yaml
link:
  - https://live.douyin.com/123456789   # or /follow/live/{room_id}
live:
  max_duration_seconds: 3600   # 0 = record until the broadcaster ends
  chunk_size: 65536
  idle_timeout_seconds: 30
```

The recorder saves an FLV file under `Downloaded/{author}/live/` plus a `*_room.json` metadata snapshot. If the broadcaster ends the stream, the network goes idle, or you Ctrl+C, all recorded bytes are preserved (the `.tmp` file is promoted to the final file).

### Collect comments per aweme

```yaml
comments:
  enabled: true
  include_replies: false   # true fetches each comment's second-level replies (extra API calls)
  max_comments: 500        # 0 = no cap
  page_size: 20
```

Generates a `{date}_{title}_{aweme_id}_comments.json` next to the media file.

### Dump the hot search board

```bash
python run.py --hot-board 30 -p ./Downloaded
# Output: ./Downloaded/hot_board/20260424_221530.jsonl
```

### Search by keyword

```bash
python run.py --search "猫咪" --search-max 100 -p ./Downloaded
# Output: ./Downloaded/search/猫咪_20260424_221530.jsonl
```

### Notifications on completion

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
    - type: webhook                 # WeCom / Feishu / DingTalk bot URLs work too
      url: https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx
      extra_body:
        msgtype: text
```

All enabled providers are notified in parallel; a failing provider never blocks the download flow.

### CLI arguments

```bash
python run.py -c config.yml \
  -u "https://www.douyin.com/video/7604129988555574538" \
  -t 8 \
  -p ./Downloaded
```

| Argument | Description |
|----------|-------------|
| `-u, --url` | Append download link(s), repeatable |
| `-c, --config` | Config file (default `config.yml`) |
| `-p, --path` | Download directory |
| `-t, --thread` | Concurrency |
| `--show-warnings` | Show warning/error logs |
| `-v, --verbose` | Show info/warning/error logs |
| `--hot-board [N]` | Dump the hot search board as JSONL, optional top-N |
| `--search KEYWORD` | Search videos by keyword, output JSONL |
| `--search-max N` | Max items for `--search` (default 50) |
| `--check-auth` | Probe whether the current cookie is still logged in, then exit (exit code 0 = alive); no download runs |
| `--serve` | Run as REST API server (requires fastapi, uvicorn) |
| `--serve-host HOST` | REST server listen host (default 127.0.0.1) |
| `--serve-port PORT` | REST server listen port (default 8000) |
| `--version` | Show version |

---

## 📡 REST API Mode

```bash
pip install fastapi uvicorn       # one-time optional dep
python run.py --serve --serve-port 8000
```

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/v1/download` | Submit `{"url": "..."}`, returns `{job_id, status}` |
| GET | `/api/v1/jobs/{job_id}` | Get a job's status/counts |
| GET | `/api/v1/jobs` | List recent jobs (TTL + capacity capped) |
| POST | `/api/v1/jobs/{job_id}/cancel` | Cancel an in-flight job (terminal jobs return 409) |
| POST | `/api/v1/jobs/{job_id}/retry` | Resubmit the original URL as a new job (disk-based incremental makes it idempotent); returns 201 |
| GET | `/api/v1/health` | Health probe |

With `database: true`, terminal jobs (success / failed / cancelled) are persisted to the SQLite `job` table and survive server restarts; API jobs also write `aweme` / `download_history` rows linked to the job. The in-memory job list is still pruned by TTL (default 24h) and max-jobs (default 500) — in-flight jobs are never pruned. Configure via `server.max_jobs` / `server.job_ttl_seconds`.

---

## 🔧 Key Config Fields

| Field | Description |
|-------|-------------|
| `mode` | `post` / `like` / `mix` / `music`; favorites modes additionally support standalone `collect` / `collectmix` |
| `number.post/like/mix/music/...` | Per-mode download limit, 0 = unlimited |
| `increase.post/like/mix/music` | `true`: skip existing primary media on disk; `false`: force redownload within current scope |
| `start_time` / `end_time` | Time filter (`YYYY-MM-DD`) |
| `folderstyle` | Per-item subdirectories |
| `browser_fallback.*` | Browser fallback for `post` when pagination is restricted |
| `progress.quiet_logs` | Quiet logs during the progress stage |
| `comments.*` | Per-aweme comment collection (opt-in) |
| `live.*` | Live recording options (max_duration_seconds / chunk_size / idle_timeout_seconds) |
| `transcript.*` | Video transcription (OpenAI Transcriptions API) |
| `notifications.*` | Bark / Telegram / Webhook push on completion |
| `server.*` | REST API tuning (max_jobs, job_ttl_seconds) |
| `proxy` | Optional HTTP/HTTPS proxy |
| `database` | Enable SQLite history |
| `database_path` | SQLite path, default `dy_downloader.db` in the working directory |
| `thread` | Concurrent download count |
| `retry_times` | Retry count on failure |

---

## 📁 Output Structure

With `folderstyle: true`:

```text
Downloaded/
├── download_manifest.jsonl
├── hot_board/                # when --hot-board is used
│   └── 20260424_221530.jsonl
├── search/                   # when --search is used
│   └── 猫咪_20260424_221530.jsonl
└── AuthorName/
    ├── post/
    │   └── 2024-02-07_Title_aweme_id/
    │       ├── ...mp4
    │       ├── ..._cover.jpg
    │       ├── ..._music.mp3
    │       ├── ..._data.json
    │       ├── ..._avatar.jpg
    │       ├── ..._comments.json    # when comments.enabled
    │       ├── ...transcript.txt    # when transcript.enabled
    │       └── ...transcript.json
    ├── like/
    ├── mix/
    ├── music/
    ├── collect/
    ├── collectmix/
    └── live/                 # when recording live streams
        └── 2026-04-24_2215_LiveTitle_RoomId/
            ├── ...flv
            └── ..._room.json
```

---

## 🔁 Incremental Downloads & Re-downloading

```yaml
increase:
  post: true
```

With `true`, an item is skipped only when its non-empty primary media already exists under the current download directory; deleting the media file makes the next run download it again. Set a mode to `false` to force redownload and atomically replace files within the current filters.

> [!NOTE]
> Deleting only the database record but keeping local files will NOT trigger a redownload — the program scans local filenames for `aweme_id`. Deleting only files but keeping the database WILL trigger a redownload ("in DB but missing locally" counts as pending).

Force-redownload examples:

```bash
# Redownload a specific item (folder name contains the aweme_id)
rm -rf Downloaded/AuthorName/post/*_<aweme_id>/

# Redownload everything from a specific author
rm -rf Downloaded/AuthorName/

# Full reset
rm -rf Downloaded/
rm dy_downloader.db
```

---

## 🧪 Testing & Development

The full test suite is offline and fully mocked — it never hits the real Douyin API:

```bash
pip install "pytest>=7.0" "pytest-asyncio>=0.21" "ruff>=0.4.0" "hypothesis>=6.0"
python -m pytest -q
ruff check .
```

Development documents live in [docs/](docs/000-index.md): current-state analysis, reference-project research (with license constraints), and the three-phase roadmap with decision records.

---

## 🗺️ Roadmap

| Area | Scope | Status |
|------|-------|:------:|
| Core CLI | single video / image-note / collection / music / profile batch / live / comments / search / transcription | ✅ |
| Engineering | 650-test baseline, CI, docs governance, security audit | ✅ |
| Task Service | unify the three orchestration copies (CLI / REST / retry), job persistence with cancel & retry | 🔄 |
| REST API | history queries, job cancel, job retry, config endpoints | 📋 |
| Web UI | paste-to-download, task center, download history, settings — pure Task Service client | 📋 |
| Docker hardening | non-root, multi-arch, data under `/data` | 📋 |

See the [development roadmap](docs/analysis/2026-09-12-roadmap.md) for the full plan and the reasoning behind each decision.

---

## ❓ FAQ

<details>
<summary>Why do I only get around 20 posts?</summary>

This is a common pagination risk-control behavior. Make sure:

- `browser_fallback.enabled: true`
- `browser_fallback.headless: false`
- complete verification manually in the browser popup, and do not close it too early

</details>

<details>
<summary>Why is the progress output noisy or repeated?</summary>

By default, `progress.quiet_logs: true` suppresses logs during the progress stage. Use `--show-warnings` or `-v` temporarily when debugging.

</details>

<details>
<summary>What if cookies are expired?</summary>

Run:

```bash
python -m tools.cookie_fetcher --config config.yml
```

</details>

<details>
<summary>Why are transcript files not generated?</summary>

Check in order:

- whether `transcript.enabled` is `true`
- whether downloaded items are videos (image-notes are not transcribed)
- whether `OPENAI_API_KEY` (or `transcript.api_key`) is valid
- whether `response_formats` includes `txt` or `json`

</details>

<details>
<summary>How do I view download history?</summary>

```bash
sqlite3 dy_downloader.db "SELECT aweme_id, title, author_name, datetime(download_time, 'unixepoch', 'localtime') FROM aweme ORDER BY download_time DESC LIMIT 20;"
```

</details>

---

## 🙏 Acknowledgements

- [jiji262/douyin-downloader](https://github.com/jiji262/douyin-downloader) -- the upstream project this fork inherits its core capabilities from
- [Johnserf-Seed/f2](https://github.com/Johnserf-Seed/f2) -- msToken config source and Douyin API design reference (Apache-2.0)
- Further references (TikTokDownloader's feature planning ideas, res-downloader's product UX): see the [reference-project research](docs/analysis/2026-09-12-reference-projects.md)

---

## ⚠️ Disclaimer

This project is for technical research, learning, and personal data management only. Please use it legally and responsibly:

- Do not use it to infringe others' privacy, copyright, or other legal rights
- Do not use it for any illegal purpose
- Users are solely responsible for all risks and liabilities arising from usage
- If platform policies or interfaces change and features break, this is a normal technical risk

By continuing to use this project, you acknowledge and accept the statements above.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
