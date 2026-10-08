#!/usr/bin/env bash
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo -e "\033[36m🚀 Starting Railway + Neon PaaS via PM2...\033[0m"

# 1. Ensure PM2 is installed globally
PM2_CMD="pm2"
if ! command -v pm2 &> /dev/null; then
  echo -e "\033[33m⚡ PM2 not found globally. Installing PM2...\033[0m"
  if command -v sudo &> /dev/null; then
    sudo npm install -g pm2 || npm install -g pm2 || PM2_CMD="npx pm2"
  else
    npm install -g pm2 || PM2_CMD="npx pm2"
  fi
fi

# 2. Build if dist or .next is missing
if [ ! -d "apps/server/dist" ] || [ ! -d "apps/web/.next" ]; then
  echo -e "\033[33m⚡ Production build not found. Running npm run build...\033[0m"
  npm run build
fi

# 3. Start or reload all services using ecosystem configuration
$PM2_CMD start ecosystem.config.cjs

# 4. Save PM2 process list to persist across reboots
$PM2_CMD save

# 5. Enable PM2 system startup if supported
if command -v pm2 &> /dev/null; then
  if [ "$EUID" -eq 0 ]; then
    pm2 startup systemd -u root --hp /root &>/dev/null || true
  else
    STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo env" || true)
    if [ -n "$STARTUP_CMD" ]; then
      echo -e "\033[33m💡 Tip: To enable auto-start on reboot, run:\033[0m"
      echo -e "   $STARTUP_CMD"
    fi
  fi
fi

HOST_IP=$(curl -s -4 ifconfig.me 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || echo "localhost")

echo -e "\033[32m"
echo "=============================================================================="
echo "✔ Railway + Neon PaaS is RUNNING!"
echo "  • Dashboard Web UI:  http://${HOST_IP}:3000"
echo "  • Control Plane API: http://${HOST_IP}:4000"
echo "=============================================================================="
echo -e "\033[0m"

$PM2_CMD status
