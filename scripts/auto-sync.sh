#!/bin/bash
# Auto-sync all commits to GitHub every 60 seconds.
# Replit auto-commits working tree changes via checkpoints, so this script
# detects local commits not yet pushed to GitHub and pushes them.
# Runs as a persistent Replit workflow — do not kill manually.

if [ -z "${GITHUB_PERSONAL_ACCESS_TOKEN:-}" ]; then
  echo "❌  GITHUB_PERSONAL_ACCESS_TOKEN is not set. Exiting."
  exit 1
fi

REPO_URL="https://${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/developercharloh/Deriv-Analysis-Tool.git"
INTERVAL=60

git config user.email "auto-sync@replit.com"
git config user.name  "Replit Auto-Sync"

# Ensure the 'github' remote exists
git remote remove github 2>/dev/null || true
git remote add github "$REPO_URL"

echo "✅  Auto-sync started — checking every ${INTERVAL}s"
echo "    Repo : https://github.com/developercharloh/Deriv-Analysis-Tool"
echo "    Branch: main"
echo ""

while true; do
  TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

  # Stage + commit any uncommitted working-tree changes first
  git add -A 2>/dev/null || true
  if ! git diff --cached --quiet 2>/dev/null; then
    git commit -m "auto: sync at ${TIMESTAMP}" 2>/dev/null || true
    echo "📦  [${TIMESTAMP}] Committed local changes"
  fi

  # Compare local HEAD with GitHub HEAD
  LOCAL_SHA=$(git rev-parse HEAD 2>/dev/null || echo "")
  REMOTE_SHA=$(git ls-remote github refs/heads/main 2>/dev/null | awk '{print $1}')

  if [ -z "$LOCAL_SHA" ]; then
    echo "⚠️   [${TIMESTAMP}] Could not read local HEAD — skipping"
  elif [ "$LOCAL_SHA" = "$REMOTE_SHA" ]; then
    echo "⏸   [${TIMESTAMP}] GitHub already up to date"
  else
    echo "📤  [${TIMESTAMP}] Pushing new commits to GitHub…"
    if git push --force github HEAD:main 2>&1; then
      echo "✅  [${TIMESTAMP}] Push successful → ${LOCAL_SHA:0:7}"
    else
      echo "⚠️   [${TIMESTAMP}] Push failed — will retry next cycle"
    fi
  fi

  sleep "$INTERVAL"
done
