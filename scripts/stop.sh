#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PM2_CMD="pm2"
if ! command -v pm2 &> /dev/null; then
  PM2_CMD="npx pm2"
fi

echo -e "\033[33m🛑 Stopping Railway + Neon PaaS...\033[0m"
$PM2_CMD stop ecosystem.config.cjs
$PM2_CMD status
