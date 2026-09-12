# douyin-downloader Claude Guidance

Read `AGENTS.md` for the full project rules.

## Shared Logic With Desktop

- This fork is maintained **independently**; the upstream sibling repo (`douyin-downloader-desktop`) is not present in this environment. Do not treat it as a sync target and do not run the historical `sync-to-cli.sh` workflow.
- Fixes to shared modules (`auth/`, `cli/`, `config/`, `control/`, `core/`, `storage/`, `tools/`, `utils/`, shared tests) stay in this repo. Significant general fixes may still be offered back upstream manually (PR / cherry-pick); nothing requires it.
