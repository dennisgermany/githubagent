#!/usr/bin/env bash
set -euo pipefail

BOT_BRANCH="${BOT_BRANCH:-bot/giro-d-italia-2026}"
DATA_DIR="data"
PR_TITLE="Giro d'Italia 2026 — data update"

if git diff --quiet -- "${DATA_DIR}" && git diff --cached --quiet -- "${DATA_DIR}"; then
  echo "No changes under ${DATA_DIR}; skipping PR publish."
  exit 0
fi

git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"

STAGE_NOTE=""
if [[ -f data/2026/giro-d-italia/giro-d-italia-2026-stages.js ]]; then
  LAST=$(grep -c "status: 'finished'" data/2026/giro-d-italia/giro-d-italia-2026-stages.js || true)
  if [[ -n "${LAST}" && "${LAST}" != "0" ]]; then
    STAGE_NOTE=" through stage ${LAST}"
  fi
fi

COMMIT_MSG="chore(data): giro 2026 results${STAGE_NOTE}"

git checkout -B "${BOT_BRANCH}"
git add -- "${DATA_DIR}"
git commit -m "${COMMIT_MSG}"

git push -u origin "${BOT_BRANCH}"
echo "Pushed ${BOT_BRANCH} to origin."

pr_url() {
  if [[ -n "${GITHUB_SERVER_URL:-}" && -n "${GITHUB_REPOSITORY:-}" ]]; then
    echo "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/compare/${BOT_BRANCH}?expand=1"
    return
  fi
  local remote
  remote="$(git remote get-url origin 2>/dev/null || true)"
  if [[ "${remote}" =~ github\.com[:/]([^/]+)/([^/.]+) ]]; then
    echo "https://github.com/${BASH_REMATCH[1]}/${BASH_REMATCH[2]}/compare/${BOT_BRANCH}?expand=1"
  fi
}

open_pr_count() {
  gh pr list --head "${BOT_BRANCH}" --state open --json number --jq 'length'
}

create_pr() {
  gh pr create \
    --head "${BOT_BRANCH}" \
    --title "${PR_TITLE}" \
    --body "$(cat <<'EOF'
## Summary

Automated update of Giro d'Italia 2026 data under `data/2026/giro-d-italia/` (stages, stage results, provisional GC, GC-by-stage snapshots).

## Test plan

- [ ] Review diff for newly finished stages only
- [ ] Confirm team names match `giro-d-italia-2026-teams.js`
- [ ] Spot-check stage results and GC against [BikeRaceInfo](https://bikeraceinfo.com) or official Giro results

EOF
)"
}

ensure_pr() {
  if [[ "$(open_pr_count)" != "0" ]]; then
    echo "Open pull request already exists for ${BOT_BRANCH}; push updated it."
    return 0
  fi

  set +e
  create_pr
  local create_err=$?
  set -e

  if [[ "${create_err}" -eq 0 ]]; then
    echo "Created new pull request for branch ${BOT_BRANCH}."
    return 0
  fi

  compare_link="$(pr_url || true)"
  echo "::warning::Could not create pull request automatically (exit ${create_err})." >&2
  echo "" >&2
  echo "GitHub often blocks PR creation from the default GITHUB_TOKEN unless the repo allows it." >&2
  echo "" >&2
  echo "Fix (pick one):" >&2
  echo "  1. Repo Settings → Actions → General → Workflow permissions" >&2
  echo "     → enable \"Allow GitHub Actions to create and approve pull requests\"" >&2
  echo "  2. Add secret GH_PR_TOKEN (repo + pull_requests) and re-run." >&2
  echo "" >&2
  if [[ -n "${compare_link}" ]]; then
    echo "Open a PR manually: ${compare_link}" >&2
  fi
  return 1
}

merge_pr() {
  local pr_number
  pr_number="$(gh pr view "${BOT_BRANCH}" --json number --jq .number 2>/dev/null)" || {
    echo "::warning::No open PR found for ${BOT_BRANCH}; skipping merge." >&2
    return 1
  }

  echo "Merging pull request #${pr_number}…"

  set +e
  gh pr review "${pr_number}" --approve 2>/dev/null
  set -e

  set +e
  gh pr merge "${pr_number}" --merge --admin --delete-branch
  local merge_err=$?
  set -e

  if [[ "${merge_err}" -eq 0 ]]; then
    echo "Merged PR #${pr_number} (branch ${BOT_BRANCH} deleted)."
    return 0
  fi

  set +e
  gh pr merge "${pr_number}" --merge --delete-branch
  merge_err=$?
  set -e

  if [[ "${merge_err}" -eq 0 ]]; then
    echo "Merged PR #${pr_number} (branch ${BOT_BRANCH} deleted)."
    return 0
  fi

  echo "::warning::Could not merge PR #${pr_number} (exit ${merge_err})." >&2
  echo "Common causes: branch protection, required reviews, or failing checks." >&2
  echo "Merge manually: $(gh pr view "${pr_number}" --json url --jq .url 2>/dev/null || echo "(see PR on GitHub)")" >&2
  return 1
}

if ! ensure_pr; then
  exit 0
fi

if ! merge_pr; then
  exit 0
fi
