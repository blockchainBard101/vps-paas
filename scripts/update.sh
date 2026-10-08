#!/usr/bin/env bash
# ==============================================================================
# Railway + Neon PaaS: One-Command Self Updater
# Pulls latest code, rebuilds, and performs a zero-downtime PM2 reload
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "\033[36m🔄 Updating Railway + Neon PaaS...\033[0m"

# 1. Detect current Git branch
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
echo "Current branch: $BRANCH"

# 2. Pull latest changes from remote
echo -e "\033[33m⬇️  Pulling latest changes from Git...\033[0m"
git fetch origin "$BRANCH"
git pull --ff-only origin "$BRANCH"

CURRENT_COMMIT="$(git rev-parse --short HEAD)"
echo -e "\033[32m✔ Updated to commit: $CURRENT_COMMIT\033[0m"

# 3. Install any new dependencies
echo -e "\033[33m📦 Updating npm workspace dependencies...\033[0m"
npm install

# 4. Rebuild production binaries
echo -e "\033[33m🔨 Compiling production builds...\033[0m"
npm run build

# 5. Reload services with PM2 (zero-downtime reload)
echo -e "\033[33m⚡ Reloading PM2 processes...\033[0m"
PM2_CMD="pm2"
if ! command -v pm2 &> /dev/null; then
  PM2_CMD="npx pm2"
fi

$PM2_CMD reload ecosystem.config.cjs || $PM2_CMD restart ecosystem.config.cjs
$PM2_CMD save

echo -e "\033[32m"
echo "=============================================================================="
echo "✔ PaaS successfully updated to commit ${CURRENT_COMMIT} and reloaded!"
echo "=============================================================================="
echo -e "\033[0m"

$PM2_CMD status
