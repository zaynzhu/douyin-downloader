<!-- Generated: 2026-03-27 | Updated: 2026-09-12 -->

# douyin-downloader

## Purpose
A Python-based Douyin (TikTok China) batch downloader that fetches videos, galleries, music, and user content without watermarks. Supports multiple download modes (user posts, likes, mixes, music), concurrent downloads with rate limiting, cookie-based authentication, and optional Whisper transcription. CLI-driven with YAML configuration.

## Key Files

| File | Description |
|------|-------------|
| `run.py` | Entry point — bootstraps `sys.path` and delegates to `cli.main:main()` |
| `__init__.py` | Package version (`2.0.0`) |
| `pyproject.toml` | Build config, dependencies, CLI entry point (`douyin-dl`), tool settings |
| `config.example.yml` | Example YAML config for users to copy and customize |
| `requirements.txt` | Pinned dependency list (mirrors pyproject.toml) |
| `Dockerfile` | Container build for the downloader |
| `PROJECT_SUMMARY.md` | Architecture overview document |

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `auth/` | Cookie and MS token management (see `auth/AGENTS.md`) |
| `cli/` | CLI argument parsing, main async loop, progress display (see `cli/AGENTS.md`) |
| `config/` | YAML config loading, env var overrides, defaults (see `config/AGENTS.md`) |
| `control/` | Concurrency control — rate limiter, retry handler, queue manager (see `control/AGENTS.md`) |
| `core/` | Business logic — API client, URL parser, downloaders, strategy pattern (see `core/AGENTS.md`) |
| `storage/` | SQLite database, file management, metadata handling (see `storage/AGENTS.md`) |
| `tests/` | Pytest test suite with 65 test modules (see `tests/AGENTS.md`) |
| `tools/` | Standalone utilities like browser-based cookie fetching (see `tools/AGENTS.md`) |
| `utils/` | Shared helpers — logging, validation, anti-bot signatures (see `utils/AGENTS.md`) |

## For AI Agents

### Working In This Directory
- Python 3.9+ is the declared floor (`pyproject.toml`); local dev and CI run 3.12. Keep conservative 3.8-era syntax in shared modules (no walrus, no `match`, no `type` aliases) to minimize upstream merge conflicts — do not modernize untouched code
- All I/O is async (`aiohttp`, `aiofiles`, `aiosqlite`) — never use blocking I/O in core paths
- Entry point is `cli.main:main()` which calls `asyncio.run(main_async(args))`
- Config is YAML-based with env var overrides (`DOUYIN_*` prefix)
- The `mix`/`allmix` config alias system requires special handling (see `config/config_loader.py`)

### Shared Logic With Desktop
- This fork is maintained **independently**; the upstream sibling repo (`douyin-downloader-desktop`) is not present in this environment. Do not treat it as a sync target and do not run the historical `sync-to-cli.sh` workflow.
- Fixes to shared modules (`auth/`, `cli/`, `config/`, `control/`, `core/`, `storage/`, `tools/`, `utils/`, shared tests) stay in this repo. Significant general fixes may still be offered back upstream manually (PR / cherry-pick); nothing requires it.
- The divergence list below is retained as historical context for why these files differ from the upstream desktop variant.
- **Intentional divergences** (historical context, these files differ by design):
  - `cli/main.py` — CLI omits desktop-only `_verify_self_checksum()` and `_enforce_license_at_startup()`.
  - `run.py` — CLI is a simple bootstrap; desktop has sidecar startup + data-dir migration.
  - `server/app.py`, `server/jobs.py` — CLI server is a simplified subset; desktop adds license, SSE, overrides, cancel.
  - `control/__init__.py` — CLI doesn't export `ProgressReporter` classes (desktop UI only).
  - `core/retry_executor.py` — CLI retains an unwired legacy copy; the active desktop implementation depends on desktop-only platform routing and is not auto-synced.
  - `utils/proxy.py` — desktop-only policy for following the OS proxy when the app proxy setting is blank; CLI keeps explicit-only proxy semantics.
  - `storage/database.py` — desktop adds TikTok, Following, and My Content schema/helpers; only dependency-neutral database tests remain byte-identical.
  - `tests/test_database_platform.py`, `tests/test_database_desktop_schema.py`, `tests/test_retry_executor.py` — desktop-only tests and not present here.

### Testing Requirements
- Run: `python -m pytest tests/`
- Async tests use `pytest-asyncio` with `asyncio_mode = "auto"`
- Linting: `ruff check .` (target Python 3.8, line-length 100)

### Common Patterns
- Factory pattern for downloaders (`DownloaderFactory.create()`)
- Strategy pattern for user download modes (`core/user_modes/`)
- Registry pattern for mode discovery (`UserModeRegistry`)
- All downloaders inherit from `BaseDownloader` with shared `_download_mode_items()`
- Logging via `utils.logger.setup_logger(name)` — one logger per module

## Dependencies

### External
- `aiohttp` — async HTTP client for API calls and downloads
- `aiofiles` — async file I/O
- `aiosqlite` — async SQLite for download history
- `rich` — terminal UI (progress bars, tables, styled output)
- `pyyaml` — YAML config parsing
- `python-dateutil` — date/time parsing for time-range filters
- `gmssl` — Chinese SM3/SM4 crypto for anti-bot signatures

### Optional
- `playwright` — browser automation for cookie fetching
- `openai-whisper` — audio transcription

<!-- MANUAL: -->
