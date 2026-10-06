# Phase 5: Production VPS Deployment & Server Hardening

This guide covers deploying the entire PaaS platform onto a clean Ubuntu 22.04 / 24.04 LTS VPS (Hetzner, DigitalOcean, Linode, or AWS EC2) and hardening it for production use.

---

## 1. VPS Provisioning & System Packages

### 1.1 Update Host & Install Prerequisites
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw jq unzip htop build-essential
```

### 1.2 Install Docker Engine & Compose Plugin
```bash
# Add Docker GPG key
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch="$(dpkg --print-architecture)" signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  "$(. /etc/os-release && echo "$VERSION_CODENAME")" stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 1.3 Install Caddy v2 & Nixpacks CLI
```bash
# Caddy
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

# Nixpacks
curl -sSL https://nixpacks.com/install.sh | bash
```

---

## 2. Firewall Configuration (UFW Hardening)

Only ports 22 (SSH), 80 (HTTP), and 443 (HTTPS) must be reachable from the internet. All database ports (`5432`, `6379`) remain completely locked within Docker's bridge network:

```bash
# Default policies
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow required ports
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP (Let's Encrypt verification)
sudo ufw allow 443/tcp   # HTTPS traffic

# Enable firewall
sudo ufw --force enable
sudo ufw status
```

---

## 3. Production PaaS Docker Compose Stack

Deploy the platform's control plane using Docker Compose:

```yaml
# /opt/paas/docker-compose.yml
services:
  # 1. Internal Control Plane Database
  control-db:
    image: postgres:16-alpine
    container_name: paas-control-db
    restart: always
    environment:
      POSTGRES_DB: paas_control
      POSTGRES_USER: paas_admin
      POSTGRES_PASSWORD: ${CONTROL_DB_PASSWORD}
    volumes:
      - control_db_data:/var/lib/postgresql/data
    networks:
      - paas-system-net

  # 2. Redis for Asynchronous Build Jobs & Metrics
  control-redis:
    image: redis:7-alpine
    container_name: paas-control-redis
    restart: always
    volumes:
      - control_redis_data:/data
    networks:
      - paas-system-net

  # 3. Next.js 15 Dashboard & Control Plane API
  paas-dashboard:
    image: my-paas-dashboard:latest
    container_name: paas-dashboard
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://paas_admin:${CONTROL_DB_PASSWORD}@control-db:5432/paas_control
      REDIS_URL: redis://control-redis:6379
      ENCRYPTION_MASTER_KEY: ${ENCRYPTION_MASTER_KEY}
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - /tmp/paas-builds:/tmp/paas-builds
    ports:
      - "127.0.0.1:3000:3000"
    networks:
      - paas-system-net
      - paas-internal-network

networks:
  paas-system-net:
    driver: bridge
  paas-internal-network:
    external: true

volumes:
  control_db_data:
  control_redis_data:
```

---

## 4. Host Maintenance & Automated Disk Cleanup

Build images and stopped containers will accumulate over time. Install a nightly maintenance cron job:

```bash
# Add to /etc/cron.daily/docker-cleanup
sudo tee /etc/cron.daily/docker-cleanup << 'EOF'
#!/bin/bash
# Remove dangling build images and stopped containers older than 48 hours
docker system prune -af --filter "until=48h" --volumes=false
EOF

sudo chmod +x /etc/cron.daily/docker-cleanup
```
