#!/usr/bin/env bash
# ==============================================================================
# Railway + Neon PaaS: VPS Host Automated Installer
# Supported OS: Ubuntu 22.04 LTS / Ubuntu 24.04 LTS (x86_64 / aarch64)
# ==============================================================================

set -euo pipefail

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
echo -e "\033[32m[1/6] Updating system packages & installing prerequisites...\033[0m"
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw jq unzip htop build-essential ca-certificates gnupg lsb-release

echo -e "\033[32m[2/6] Installing Docker Engine & Compose plugin...\033[0m"
if ! command -v docker &> /dev/null; then
  sudo install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
  sudo chmod a+r /etc/apt/keyrings/docker.gpg

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
    sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

  sudo apt update
  sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo systemctl enable --now docker
else
  echo "Docker is already installed."
fi

echo -e "\033[32m[3/6] Installing Nixpacks CLI (Build Engine)...\033[0m"
if ! command -v nixpacks &> /dev/null; then
  curl -sSL https://nixpacks.com/install.sh | bash
else
  echo "Nixpacks is already installed."
fi

echo -e "\033[32m[4/6] Installing Caddy v2 Edge Proxy...\033[0m"
if ! command -v caddy &> /dev/null; then
  sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
  sudo apt update
  sudo apt install -y caddy
  sudo systemctl enable --now caddy
else
  echo "Caddy is already installed."
fi

echo -e "\033[32m[5/6] Creating Docker internal network & directories...\033[0m"
if ! sudo docker network ls | grep -q "paas-internal-network"; then
  sudo docker network create --driver bridge paas-internal-network
  echo "Created network: paas-internal-network"
fi

sudo mkdir -p /opt/paas /var/lib/paas/builds /var/lib/paas/backups /var/lib/paas/logs
sudo chmod 755 /var/lib/paas

echo -e "\033[32m[6/6] Hardening Firewall (UFW)...\033[0m"
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp comment 'SSH'
sudo ufw allow 80/tcp comment 'HTTP (Let'\''s Encrypt)'
sudo ufw allow 443/tcp comment 'HTTPS'
sudo ufw --force enable

echo -e "\033[36m"
echo "=============================================================================="
echo "✔ VPS Setup Complete! Server is ready for Railway + Neon PaaS deployment."
echo "=============================================================================="
echo -e "\033[0m"
