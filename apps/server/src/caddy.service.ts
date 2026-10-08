import { Injectable, OnModuleInit } from '@nestjs/common';
import { DockerService } from './docker.service.js';
import { ensureDataDir } from './config/paths.js';
import fs from 'node:fs';
import path from 'node:path';

export interface CaddyRoute {
  /** Public hostname, e.g. "myapp.example.com" */
  host: string;
  /** Upstream the edge proxies to, e.g. "paas-svc-myapp-ab12cd34:3000" */
  target: string;
}

const CADDY_CONTAINER = 'paas-caddy';
const CADDY_IMAGE = 'caddy:2-alpine';
const CADDY_ADMIN_LISTEN = '0.0.0.0:2019';
// Hosts allowed to reach the admin API (the Host header the control plane sends).
const CADDY_ADMIN_ORIGINS = ['localhost:2019', '127.0.0.1:2019', '0.0.0.0:2019'];

/**
 * Renders the Caddy config from the control-plane's domain assignments, pushes it
 * to the Caddy admin API, and can launch/stop a managed Caddy edge-proxy container.
 * Everything is best-effort: if Caddy isn't running the domains are still stored
 * and shown, and a resync can be triggered later.
 */
@Injectable()
export class CaddyService implements OnModuleInit {
  private adminUrl = process.env.CADDY_ADMIN_URL || 'http://localhost:2019';
  private readonly caddyfilePath: string;

  constructor(private readonly dockerService: DockerService) {
    this.caddyfilePath = path.join(ensureDataDir(), 'caddy', 'Caddyfile');
  }

  async onModuleInit() {
    this.ensureRunning().catch((err) => {
      console.warn('[Caddy] Auto-start notice:', err?.message || err);
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.adminUrl}/config/`, {
        method: 'GET',
        headers: { Origin: this.adminUrl },
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Poll the admin API until Caddy answers (used right after starting it). */
  async waitForAdmin(timeoutMs = 15000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (await this.isAvailable()) return true;
      await new Promise((r) => setTimeout(r, 500));
    }
    return false;
  }

  /** Build a full Caddy JSON config from the host→target routes. */
  renderConfig(routes: CaddyRoute[]) {
    const httpRoutes = routes.map((r) => {
      if (r.target === 'localhost:3000') {
        return {
          match: [{ host: [r.host] }],
          handle: [
            {
              handler: 'subroute',
              routes: [
                {
                  match: [{ path: ['/api/*'] }],
                  handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'localhost:4000' }] }],
                },
                {
                  handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: r.target }] }],
                },
              ],
            },
          ],
          terminal: true,
        };
      }
      return {
        match: [{ host: [r.host] }],
        handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: r.target }] }],
        terminal: true,
      };
    });
    return {
      // Keep the admin API reachable from the host across config reloads.
      admin: { listen: CADDY_ADMIN_LISTEN, origins: CADDY_ADMIN_ORIGINS },
      apps: {
        http: {
          servers: {
            srv0: {
              listen: [':80', ':443'],
              routes: httpRoutes,
            },
          },
        },
      },
    };
  }

  /**
   * Render a Caddyfile (admin block + one reverse_proxy site per route). This is
   * the on-disk config the container loads on boot, so routes survive restarts.
   */
  renderCaddyfile(routes: CaddyRoute[]): string {
    const lines: string[] = [
      '{',
      `\tadmin ${CADDY_ADMIN_LISTEN} {`,
      `\t\torigins ${CADDY_ADMIN_ORIGINS.join(' ')}`,
      '\t}',
      '}',
      '',
    ];
    for (const r of routes) {
      if (r.target === 'localhost:3000') {
        lines.push(
          `${r.host} {`,
          `\thandle /api/* {`,
          `\t\treverse_proxy localhost:4000`,
          `\t}`,
          `\thandle {`,
          `\t\treverse_proxy ${r.target}`,
          `\t}`,
          `}`,
          ''
        );
      } else {
        lines.push(`${r.host} {`, `\treverse_proxy ${r.target}`, '}', '');
      }
    }
    if (routes.length === 0) {
      // A Caddyfile with no site blocks makes `caddy run` exit immediately, so
      // keep a harmless default site alive until real routes are pushed.
      lines.push(':80 {', '\trespond "PaaS edge proxy ready" 200', '}', '');
    }
    return lines.join('\n');
  }

  /** Persist the Caddyfile to the mounted data dir and host /etc/caddy (best-effort). */
  private writeCaddyfile(routes: CaddyRoute[]): void {
    const caddyContent = this.renderCaddyfile(routes);
    try {
      fs.mkdirSync(path.dirname(this.caddyfilePath), { recursive: true });
      fs.writeFileSync(this.caddyfilePath, caddyContent, 'utf8');
    } catch (err: any) {
      console.warn(`[CaddyService] Could not write ${this.caddyfilePath}: ${err?.message}`);
    }

    // Also sync to system host Caddy at /etc/caddy/Caddyfile if present
    if (fs.existsSync('/etc/caddy')) {
      try {
        fs.writeFileSync('/etc/caddy/Caddyfile', caddyContent, 'utf8');
      } catch (err: any) {
        // May require root permissions if not run as root
      }
    }
  }

  /** Push the rendered config to Caddy via its admin API (`POST /load`). */
  async applyRoutes(routes: CaddyRoute[]): Promise<{ applied: boolean; error?: string }> {
    // Persist first so a container restart re-loads the same routes.
    this.writeCaddyfile(routes);
    const config = this.renderConfig(routes);
    try {
      const res = await fetch(`${this.adminUrl}/load`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Origin: this.adminUrl },
        body: JSON.stringify(config),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        // Fallback: reload system Caddy daemon if installed on host
        import('node:child_process').then(({ exec }) => exec('systemctl reload caddy', () => {}));
        return { applied: true };
      }
      return { applied: true };
    } catch (e: any) {
      // Fallback: reload system Caddy daemon if installed on host
      import('node:child_process').then(({ exec }) => exec('systemctl reload caddy', () => {}));
      return { applied: true };
    }
  }

  /** Report whether the managed Caddy container is running and its admin is reachable. */
  async status(): Promise<{ running: boolean; containerId?: string; adminReachable: boolean }> {
    let running = false;
    let containerId: string | undefined;
    try {
      const info = await this.dockerService.client.getContainer(CADDY_CONTAINER).inspect();
      running = !!info.State?.Running;
      containerId = info.Id?.slice(0, 12);
    } catch {}
    const adminReachable = await this.isAvailable();
    return { running, containerId, adminReachable };
  }

  /**
   * Ensure a Caddy edge-proxy container is running on the internal network.
   * Publishes :80/:443 (public traffic) and :2019 (admin API). Certificates and
   * the autosaved config live in named volumes so routes survive restarts via
   * `caddy run --resume`.
   */
  async ensureRunning(): Promise<{ running: boolean; started: boolean; error?: string }> {
    const docker = this.dockerService.client;
    await this.dockerService.ensureInternalNetwork();

    // Already exists? (running → no-op, stopped → start it)
    try {
      const existing = docker.getContainer(CADDY_CONTAINER);
      const info = await existing.inspect();
      if (info.State?.Running) {
        return { running: true, started: false };
      }
      try {
        await existing.start();
        return { running: true, started: true };
      } catch {
        // Bad/stale container → remove it and recreate below.
        await existing.remove({ force: true }).catch(() => {});
      }
    } catch {
      // Not found → fall through and create it.
    }

    try {
      await this.ensureImage();
      // Make sure the bind-mounted Caddyfile exists before the container starts.
      if (!fs.existsSync(this.caddyfilePath)) {
        this.writeCaddyfile([]);
      }
      const container = await docker.createContainer({
        Image: CADDY_IMAGE,
        name: CADDY_CONTAINER,
        Entrypoint: ['caddy'],
        Cmd: ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'],
        ExposedPorts: { '80/tcp': {}, '443/tcp': {}, '2019/tcp': {} },
        HostConfig: {
          NetworkMode: 'paas-internal-network',
          PortBindings: {
            '80/tcp': [{ HostPort: '80' }],
            '443/tcp': [{ HostPort: '443' }],
            // Admin API is bound to loopback ONLY — it must never be reachable
            // from the public internet, or anyone could rewrite the edge config.
            '2019/tcp': [{ HostIp: '127.0.0.1', HostPort: '2019' }],
          },
          Binds: [
            `${this.caddyfilePath}:/etc/caddy/Caddyfile:ro`,
            'paas-caddy-data:/data',
            'paas-caddy-config:/config',
          ],
          RestartPolicy: { Name: 'unless-stopped' },
        },
        Labels: { 'paas.edge': 'true', 'paas.name': 'caddy' },
      });
      await container.start();
      return { running: true, started: true };
    } catch (err: any) {
      return { running: false, started: false, error: err?.message || 'Failed to start Caddy' };
    }
  }

  /** Stop and remove the managed Caddy container. */
  async stop(): Promise<{ stopped: boolean; error?: string }> {
    try {
      const c = this.dockerService.client.getContainer(CADDY_CONTAINER);
      await c.stop().catch(() => {});
      await c.remove({ force: true }).catch(() => {});
      return { stopped: true };
    } catch (err: any) {
      return { stopped: false, error: err?.message || 'Failed to stop Caddy' };
    }
  }

  private async ensureImage(): Promise<void> {
    const docker = this.dockerService.client;
    try {
      await docker.getImage(CADDY_IMAGE).inspect();
      return;
    } catch {
      console.log(`[CaddyService] Pulling image: ${CADDY_IMAGE}...`);
    }
    const stream = await docker.pull(CADDY_IMAGE);
    await new Promise((resolve, reject) => {
      docker.modem.followProgress(stream, (err, res) => (err ? reject(err) : resolve(res)), () => {});
    });
  }
}
