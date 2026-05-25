# Giro cycling data agent

Daily [Cursor SDK](https://cursor.com/docs/sdk/typescript) agent (local runtime on GitHub Actions) that updates **Giro d'Italia 2026** results under [`data/2026/giro-d-italia/`](data/2026/giro-d-italia/) when stages finish. Changes are published via pull request for review—not pushed directly to `main`.

## Schedule

- **Automatic:** daily at 07:00 UTC (`.github/workflows/update-cycling-data.yml`)
- **Manual:** Actions → *Update cycling data* → *Run workflow* (optional prompt override)

## Setup

1. Add repository secret **`CURSOR_API_KEY`** ([Cursor dashboard](https://cursor.com/dashboard)).
2. Allow the workflow to **open pull requests** (required for automatic PRs):
   - **Recommended:** GitHub repo → **Settings** → **Actions** → **General** → **Workflow permissions** → enable **Allow GitHub Actions to create and approve pull requests**, then save.
   - **Alternative:** Add secret **`GH_PR_TOKEN`** — a fine-grained or classic PAT with `contents` and `pull_requests` on this repo. The workflow uses it instead of `GITHUB_TOKEN` for `gh pr create`.

   If PR creation is blocked, the workflow still **pushes** `bot/giro-d-italia-2026` and prints a compare link in the log; open the PR manually once.

## What gets updated

| File | Content |
|------|---------|
| `giro-d-italia-2026-stages.js` | Stage `status` |
| `giro-d-italia-2026-results.js` | Per-stage top 25, provisional GC |
| `giro-d-italia-2026-gc-by-stage.js` | GC snapshot after each stage |

Static assets (GPX, teams, climbs, route features) are not updated by the bot. See [`AGENTS.md`](AGENTS.md) and [`prompts/update-giro-2026.md`](prompts/update-giro-2026.md).

## Pull requests

The workflow commits to branch `bot/giro-d-italia-2026` and opens a PR if none is open; later runs push additional commits to the same branch. Merge when the diff looks correct. Rebase the bot branch on `main` if GitHub reports conflicts.

## Local run

```bash
export CURSOR_API_KEY=...
npm ci
npm run agent
```

Optional environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `AGENT_PROMPT` | (file) | Override `prompts/update-giro-2026.md` |
| `AGENT_LOG_LEVEL` | `info` | `error` · `warn` · `info` · `debug` |
| `AGENT_LOG_FORMAT` | text | Set to `json` for JSON lines on stderr |

Logs (thinking, tools, status, steps) go to **stderr**. Streaming text is **buffered** and printed as whole paragraphs (not one line per token). Token-level detail is available with `AGENT_LOG_LEVEL=debug`. The final agent summary is printed to **stdout** after the run completes.

## Future races

Data lives under `data/{year}/{race-slug}/`. Extend prompts and `AGENTS.md` when adding more events.
