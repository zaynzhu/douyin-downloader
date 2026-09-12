<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-03-27 | Updated: 2026-09-12 -->

# auth

## Purpose
Manages Douyin authentication credentials — cookie storage/validation, liveness probing, and MS token generation for API request signing.

## Key Files

| File | Description |
|------|-------------|
| `__init__.py` | Exports `CookieManager`, `MsTokenManager` |
| `cookie_manager.py` | Stores, validates, and serves cookies as dict or header string |
| `liveness.py` | One-request login liveness probe (`check_cookie_liveness`): ALIVE / INVALID / UNREACHABLE, never raises |
| `ms_token_manager.py` | Generates/refreshes the `msToken` required by Douyin API endpoints |

## For AI Agents

### Working In This Directory
- `CookieManager` is instantiated in `cli/main.py` and passed to all downloaders
- Cookies come from YAML config, env vars, or auto-loaded JSON files (see `config/config_loader.py`)
- `MsTokenManager` is used by `core/api_client.py` for request signing

### Testing Requirements
- Tests: `tests/test_cookie_manager.py`, `tests/test_ms_token_manager.py`, `tests/test_cookie_liveness.py`, `tests/test_check_auth.py` (CLI wiring)

### Common Patterns
- Cookie validation checks for required Douyin cookie keys
- All cookie values are sanitized via `utils.cookie_utils.sanitize_cookies()`

## Dependencies

### Internal
- `utils/cookie_utils.py` — cookie parsing and sanitization helpers

### External
- `aiohttp` — for token refresh HTTP calls

<!-- MANUAL: -->
