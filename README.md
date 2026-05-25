# Giro cycling data agent

Daily [Cursor SDK](https://cursor.com/docs/sdk/typescript) agent (local runtime on GitHub Actions) that updates **Giro d'Italia 2026** results under [`data/2026/giro-d-italia/`](data/2026/giro-d-italia/) when stages finish. Changes land on `main` via an automated pull request that the workflow merges when GitHub allows it.

## Schedule

- **Automatic:** once daily at **18:00 UTC** (= 20:00 CEST in summer; 19:00 CET in winter)
- **Manual:** Actions → *Update cycling data* → *Run workflow* (optional prompt override)

## Setup

1. Add repository secret **`CURSOR_API_KEY`** ([Cursor dashboard](https://cursor.com/dashboard)).
2. Allow the workflow to **create, approve, and merge pull requests**:
   - **Recommended:** GitHub repo → **Settings** → **Actions** → **General** → **Workflow permissions** → enable **Allow GitHub Actions to create and approve pull requests**, then save.
   - **Alternative:** Add secret **`GH_PR_TOKEN`** — a PAT with `contents` and `pull_requests` on this repo (used for `gh` instead of `GITHUB_TOKEN`).

   If branch protection requires reviews or checks, allow the `github-actions[bot]` to bypass or merge when checks pass; otherwise the workflow pushes the branch and logs a manual merge link.

## What gets updated

| File | Content |
|------|---------|
| `giro-d-italia-2026-stages.js` | Stage `status` |
| `giro-d-italia-2026-results.js` | Per-stage top 25, provisional GC |
| `giro-d-italia-2026-gc-by-stage.js` | GC snapshot after each stage |

Static assets (GPX, teams, climbs, route features) are not updated by the bot. See [`AGENTS.md`](AGENTS.md) and [`prompts/update-giro-2026.md`](prompts/update-giro-2026.md).

## Pull requests

Each run commits to `bot/giro-d-italia-2026`, opens a PR if needed, then **merges** it into the default branch and deletes the bot branch (`gh pr merge --merge --admin --delete-branch`). The next run creates a fresh branch from `main`.

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
