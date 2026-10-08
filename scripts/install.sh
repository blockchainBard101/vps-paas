#!/usr/bin/env bash
# ==============================================================================
# Railway + Neon PaaS Automated Host Installer
# Inspired by modern 1-command installer architectures (e.g. Aeroplane)
# Supported OS: Ubuntu 22.04 / 24.04 LTS, Debian 12 (x86_64 / aarch64)
# ==============================================================================

set -euo pipefail

INSTALL_DIR="${PAAS_HOME:-/opt/paas}"
APP_DIR="$INSTALL_DIR/source"
REPO_URL="${PAAS_REPO_URL:-https://github.com/blockchainBard101/vps-paas.git}"
REPO_BRANCH="${PAAS_REPO_BRANCH:-main}"
WEB_PORT="${PAAS_WEB_PORT:-3000}"
API_PORT="${PAAS_API_PORT:-4000}"

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "Error: sudo is required when installing as a non-root user."
    exit 1
  fi
  SUDO="sudo"
fi

say() {
  printf "\033[36m➜ %s\033[0m\n" "$*"
}

success() {
  printf "\033[32m✔ %s\033[0m\n" "$*"
}

fail() {
  printf "\033[31m✘ Error: %s\033[0m\n" "$*"
  exit 1
}

require_linux() {
  [ "$(uname -s)" = "Linux" ] || [ "$(uname -s)" = "Darwin" ] || fail "This installer currently supports Linux hosts (Ubuntu / Debian)."
}

require_apt() {
  if [ "$(uname -s)" = "Linux" ]; then
    command -v apt-get >/dev/null 2>&1 || fail "apt-get not found. This installer supports Ubuntu/Debian hosts."
  fi
}

install_base_packages() {
  if [ "$(uname -s)" = "Linux" ]; then
    require_apt
    say "Installing base system dependencies..."
    $SUDO apt-get update -y
    $SUDO apt-get install -y ca-certificates curl git openssl build-essential jq unzip ufw htop
    success "Base packages installed."
  fi
}

install_docker() {
  if command -v docker >/dev/null 2>&1; then
    success "Docker is already installed ($(docker --version))."
  else
    say "Installing Docker Engine..."
    $SUDO install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | $SUDO gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
    $SUDO chmod a+r /etc/apt/keyrings/docker.gpg

    echo \
      "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
      $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
      $SUDO tee /etc/apt/sources.list.d/docker.list > /dev/null

    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    $SUDO systemctl enable --now docker >/dev/null 2>&1 || true
    success "Docker installed successfully."
  fi
}

install_nixpacks() {
  if command -v nixpacks >/dev/null 2>&1; then
    success "Nixpacks is already installed."
  else
    say "Installing Nixpacks (Build Engine)..."
    curl -sSL https://nixpacks.com/install.sh | bash
    success "Nixpacks installed."
  fi
}

install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    success "Caddy is already installed."
  else
    say "Installing Caddy v2 Reverse Proxy..."
    $SUDO apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | $SUDO gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | $SUDO tee /etc/apt/sources.list.d/caddy-stable.list
    $SUDO apt-get update -y
    $SUDO apt-get install -y caddy
    $SUDO systemctl enable --now caddy >/dev/null 2>&1 || true
    success "Caddy installed."
  fi
}

install_node_and_pm2() {
  if ! command -v node >/dev/null 2>&1 || [ "$(node -v | cut -d'.' -f1 | tr -d 'v')" -lt 20 ]; then
    say "Installing Node.js 20 LTS via NodeSource..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
    $SUDO apt-get install -y nodejs
    success "Node.js $(node -v) installed."
  else
    success "Node.js $(node -v) is already installed."
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    say "Installing PM2 process manager globally..."
    $SUDO npm install -g pm2
    success "PM2 installed globally."
  else
    success "PM2 is already installed."
  fi
}

setup_storage_and_network() {
  say "Configuring storage volumes and Docker networks..."
  $SUDO mkdir -p /var/lib/paas/builds /var/lib/paas/backups /var/lib/paas/logs "$INSTALL_DIR"
  $SUDO chmod -R 755 /var/lib/paas

  if command -v docker >/dev/null 2>&1; then
    if ! $SUDO docker network ls | grep -q "paas-internal-network"; then
      $SUDO docker network create --driver bridge paas-internal-network >/dev/null
      success "Docker network 'paas-internal-network' created."
    else
      success "Docker network 'paas-internal-network' ready."
    fi
  fi
}

check_port_conflicts() {
  for port in 80 443 "${WEB_PORT}" "${API_PORT}"; do
    if command -v ss >/dev/null 2>&1; then
      if ss -tuln 2>/dev/null | grep -q ":${port} "; then
        printf "\033[33m⚠ Notice: Port %s is already in use by another process.\033[0m\n" "$port"
      fi
    fi
  done
}

configure_firewall() {
  if command -v ufw >/dev/null 2>&1; then
    if $SUDO ufw status 2>/dev/null | grep -qi "Status: active"; then
      say "UFW firewall is active. Allowing PaaS ports..."
      $SUDO ufw allow 22/tcp comment 'SSH' >/dev/null 2>&1 || true
      $SUDO ufw allow 80/tcp comment 'HTTP (Let'\''s Encrypt)' >/dev/null 2>&1 || true
      $SUDO ufw allow 443/tcp comment 'HTTPS' >/dev/null 2>&1 || true
      $SUDO ufw allow "${WEB_PORT}/tcp" comment 'PaaS Dashboard' >/dev/null 2>&1 || true
      $SUDO ufw allow "${API_PORT}/tcp" comment 'PaaS Control Plane API' >/dev/null 2>&1 || true
      success "Firewall rules updated for ports 22, 80, 443, ${WEB_PORT}, ${API_PORT}."
    else
      say "UFW is inactive. Existing firewall configuration left untouched."
    fi
  fi
}

detect_public_ip() {
  local public_ip=""
  if command -v curl >/dev/null 2>&1; then
    public_ip="$(curl -fsSL --max-time 4 https://api.ipify.org 2>/dev/null || curl -fsSL --max-time 4 https://ifconfig.me 2>/dev/null || true)"
  fi
  if [ -z "$public_ip" ] && command -v hostname >/dev/null 2>&1; then
    public_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
  fi
  if [ -z "$public_ip" ]; then
    public_ip="localhost"
  fi
  printf '%s' "$public_ip"
}

setup_and_start_app() {
  # If currently running within the git repository directory:
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  TARGET_DIR="$SCRIPT_DIR"

  if [ ! -f "$TARGET_DIR/ecosystem.config.cjs" ]; then
    # Running via standalone curl pipe - clone into $APP_DIR
    say "Cloning repository into $APP_DIR..."
    $SUDO mkdir -p "$INSTALL_DIR"
    if [ -n "$SUDO" ]; then
      $SUDO chown -R "$(id -u):$(id -g)" "$INSTALL_DIR"
    fi
    if [ -d "$APP_DIR/.git" ]; then
      cd "$APP_DIR" && git fetch origin && git checkout "$REPO_BRANCH" && git pull --ff-only origin "$REPO_BRANCH"
    else
      git clone --branch "$REPO_BRANCH" --single-branch "$REPO_URL" "$APP_DIR"
    fi
    TARGET_DIR="$APP_DIR"
  fi

  cd "$TARGET_DIR"

  say "Installing npm workspace dependencies..."
  npm install

  say "Building production application..."
  npm run build

  say "Starting PaaS with PM2..."
  pm2 start ecosystem.config.cjs
  pm2 save

  say "Registering PM2 system startup..."
  if [ "$(id -u)" -eq 0 ]; then
    pm2 startup systemd -u root --hp /root &>/dev/null || true
  else
    STARTUP_CMD=$(pm2 startup 2>&1 | grep "sudo env" || true)
    if [ -n "$STARTUP_CMD" ]; then
      eval "$STARTUP_CMD" &>/dev/null || true
    fi
  fi
}

banner() {
  echo -e "\033[36m"
  cat << "EOF"
  _____       _ _                       _   _                     _____             _____ 
 |  __ \     (_) |                     | \ | |                   |  __ \           / ____|
 | |__) |__ _ _| |_      ____ _ _   _  |  \| | ___  ___  _ __    | |__) |_ _  __ _| (___  
 |  _  // _` | | \ \ /\ / / _` | | | | | . ` |/ _ \/ _ \| '_ \   |  ___/ _` |/ _` |\___ \ 
 | | \ \ (_| | | |\ V  V / (_| | |_| | | |\  |  __/ (_) | | | |  | |  | (_| | (_| |____) |
 |_|  \_\__,_|_|_| \_/\_/ \__,_|\__, | |_| \_|\___|\___/|_| |_|  |_|   \__,_|\__,_|_____/ 
                                  __/ |                                                    
                                 |___/                                                     
EOF
  echo -e "\033[0m"
}

main() {
  banner
  require_linux
  check_port_conflicts
  install_base_packages
  install_docker
  install_nixpacks
  install_caddy
  install_node_and_pm2
  setup_storage_and_network
  configure_firewall
  setup_and_start_app

  HOST_IP="$(detect_public_ip)"

  echo -e "\n\033[32m"
  echo "=============================================================================="
  echo "✔ Railway + Neon PaaS is successfully installed and RUNNING!"
  echo ""
  echo "  🚀 Dashboard Web UI:      http://${HOST_IP}:${WEB_PORT}"
  echo "  ⚙️ Control Plane API:     http://${HOST_IP}:${API_PORT}"
  echo "  🔄 Auto-start on reboot:  ENABLED (PM2 + systemd)"
  echo "=============================================================================="
  echo -e "\033[0m"
  echo -e "\033[36mHelpful commands:\033[0m"
  echo "  • View status:      pm2 status"
  echo "  • Stream logs:      pm2 logs"
  echo "  • Restart stack:    pm2 restart ecosystem.config.cjs"
  echo "  • Stop stack:       pm2 stop ecosystem.config.cjs"
  echo ""
}

main "$@"
