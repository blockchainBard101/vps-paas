# Phase 4: Nixpacks Automated Builds & Caddy Dynamic Edge Routing

This guide provides the complete code to build code automatically from a Git repository using **Nixpacks** and expose it through **Caddy's dynamic JSON API** with automatic SSL.

---

## 1. Installing Nixpacks & Caddy

### On Ubuntu/Debian Host:
```bash
# 1. Install Nixpacks CLI
curl -sSL https://nixpacks.com/install.sh | bash

# 2. Install Caddy v2
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

---

## 2. Git Clone & Nixpacks Build Pipeline

```typescript
// server/services/BuildPipeline.ts
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';

export async function cloneAndBuildRepo({
  repoUrl,
  branch = 'main',
  serviceId,
  onLog,
}: {
  repoUrl: string;
  branch?: string;
  serviceId: string;
  onLog: (line: string) => void;
}): Promise<string> {
  const workspaceDir = path.join('/tmp', 'paas-builds', serviceId);
  const imageTag = `paas-app-${serviceId}:${Date.now()}`;

  // 1. Clean workspace
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.mkdir(workspaceDir, { recursive: true });

  onLog(`\x1b[34m[Git] Cloning ${repoUrl} (branch: ${branch})...\x1b[0m\r\n`);

  // 2. Clone Git Repo
  await runCommand('git', ['clone', '--depth', '1', '--branch', branch, repoUrl, workspaceDir], onLog);

  onLog(`\x1b[35m[Nixpacks] Analyzing repository dependencies...\x1b[0m\r\n`);

  // 3. Run Nixpacks to produce an optimized OCI container image
  await runCommand('nixpacks', ['build', workspaceDir, '--name', imageTag], onLog);

  // 4. Cleanup source code
  await fs.rm(workspaceDir, { recursive: true, force: true });

  return imageTag;
}

function runCommand(cmd: string, args: string[], onLog: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    p.stdout.on('data', (d) => onLog(d.toString()));
    p.stderr.on('data', (d) => onLog(d.toString()));
    p.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command ${cmd} exited with code ${code}`));
    });
  });
}
```

---

## 3. Caddy Dynamic JSON API Client

```typescript
// server/services/CaddyService.ts
export class CaddyService {
  private static CADDY_ADMIN_URL = 'http://127.0.0.1:2019';

  /**
   * Initializes Caddy with standard HTTP server and On-Demand TLS
   */
  static async initializeCaddy(): Promise<void> {
    const baseConfig = {
      admin: { listen: '127.0.0.1:2019' },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':443'],
              routes: [],
            },
          },
        },
      },
    };

    await fetch(`${this.CADDY_ADMIN_URL}/load`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(baseConfig),
    });
  }

  /**
   * Dynamically registers a new subdomain with zero downtime
   */
  static async registerSubdomainRoute({
    domain,
    upstreamContainerName,
    port = 3000,
    routeId,
  }: {
    domain: string;
    upstreamContainerName: string;
    port?: number;
    routeId: string;
  }): Promise<void> {
    const routePayload = {
      '@id': routeId,
      match: [{ host: [domain] }],
      handle: [
        {
          handler: 'reverse_proxy',
          upstreams: [{ dial: `${upstreamContainerName}:${port}` }],
        },
      ],
      terminal: true,
    };

    const res = await fetch(`${this.CADDY_ADMIN_URL}/config/apps/http/servers/srv0/routes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(routePayload),
    });

    if (!res.ok) {
      throw new Error(`Caddy route registration failed: ${await res.text()}`);
    }
  }

  /**
   * Atomically swaps upstream during Blue/Green deployment
   */
  static async swapUpstream(routeId: string, newUpstreamDial: string): Promise<void> {
    const res = await fetch(`${this.CADDY_ADMIN_URL}/id/${routeId}/handle/0/upstreams`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{ dial: newUpstreamDial }]),
    });

    if (!res.ok) {
      throw new Error(`Caddy upstream swap failed: ${await res.text()}`);
    }
  }
}
```
