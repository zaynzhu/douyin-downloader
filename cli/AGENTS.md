<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-27 | Updated: 2026-09-12 -->

# cli

## Purpose
Command-line interface — argument parsing, main async download loop, progress display with Rich, and optional Whisper transcription integration.

## Key Files

| File | Description |
|------|-------------|
| `__init__.py` | Package marker |
| `main.py` | CLI entry point: `main()` → `main_async()`; per-URL `download_url()` thin shell over `core.download_service`, startup cookie liveness probe, `--check-auth` subcommand |
| `login_flow.py` | Interactive TTY re-login flow — opens browser via cookie fetcher, reloads fresh cookies (invoked on `LoginRequiredError`) |
| `progress_display.py` | Rich-based terminal UI — banners, progress bars, step tracking, result summaries |
| `whisper_transcribe.py` | Optional audio transcription via OpenAI Whisper |

## For AI Agents

### Working In This Directory
- `main.py` is the orchestration hub — it wires together config, auth, storage, control, and core
- `download_url()` is a **thin shell**: the pipeline (resolve short URL → parse → capability gate → factory → download → record history) lives in `core/download_service.py`; CLI keeps per-URL control objects, error display, and `_run_with_relogin` wrapping. `LoginRequiredError` must propagate out of `download_url` — the relogin flow depends on it
- Progress display quiets console logs during download to avoid Rich redraws; restores after
- The `douyin-dl` CLI entry point (from pyproject.toml) maps to `cli.main:main`

### Testing Requirements
- Tests: `tests/test_progress_display.py`, `tests/test_cli_main.py`, `tests/test_check_auth.py`, `tests/test_login_flow.py`
- `main.py` is tested indirectly through integration; mock `asyncio.run` for unit tests

### Common Patterns
- `argparse` for CLI args: `-u/-c/-p/-t` plus subcommand-style flags `--hot-board`, `--search`, `--serve`, `--check-auth`
- Chinese-language step labels in progress display (初始化, 解析链接, etc.)
- `DownloadResult` aggregation for multi-URL summary

## Dependencies

### Internal
- `config/` — `ConfigLoader` for YAML config
- `auth/` — `CookieManager` for authentication
- `storage/` — `Database`, `FileManager`
- `control/` — `QueueManager`, `RateLimiter`, `RetryHandler`
- `core/` — `DouyinAPIClient`, `URLParser`, `DownloaderFactory`
- `utils/logger` — `setup_logger`, `set_console_log_level`

### External
- `rich` — terminal UI rendering
- `openai-whisper` — optional transcription (behind `[transcribe]` extra)

<!-- MANUAL: -->
