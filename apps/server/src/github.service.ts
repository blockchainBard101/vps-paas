import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ServicesService, ServiceRecord } from './services.service.js';
import { SystemSettingsService } from './system-settings.service.js';
import { DockerService } from './docker.service.js';
import { ensureDataDir, getBuildsDir, getDeploymentsDir } from './config/paths.js';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface GitHubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  description: string | null;
  private: boolean;
  defaultBranch: string;
  language: string | null;
  stars: number;
  updatedAt: string;
  htmlUrl: string;
  cloneUrl: string;
}

export interface GitHubStatus {
  connected: boolean;
  method: 'oauth' | 'token' | 'none';
  oauthConfigured: boolean;
  appConfigured?: boolean;
  appName?: string;
  appSlug?: string;
  appInstallUrl?: string;
  appSettingsUrl?: string;
  appPublicSettingsUrl?: string;
  clientId?: string;
  user?: {
    login: string;
    avatarUrl: string;
    name: string | null;
    htmlUrl?: string;
  };
  organizations?: Array<{
    login: string;
    avatarUrl?: string;
    description?: string;
  }>;
  repoCount?: number;
  webhookUrl: string;
  webhookSecret: string;
}

interface StoredGitHubConfig {
  token: string | null;
  webhookSecret: string;
  clientId?: string;
  clientSecret?: string;
  appId?: number;
  appSlug?: string;
  privateKey?: string;
  method?: 'oauth' | 'token' | 'none';
}

/**
 * Granular lifecycle phase of a deployment run. Surfaced to the UI so the node
 * label can progress through importing → building → deploying → running.
 */
export type BuildPhase = 'queued' | 'importing' | 'building' | 'deploying' | 'running' | 'failed';

/**
 * A single persisted deployment record. One is written per build run so the
 * deployment timeline survives server restarts and is consistent across every
 * modal (canvas, service drawer, terminal, history tab).
 */
export interface DeployHistoryEntry {
  runId: string;
  status: 'building' | 'success' | 'failed';
  phase: BuildPhase;
  createdAt: string;
  branch: string;
  repoName: string;
  logFile: string;
  logsCount: number;
  imageTag?: string;
  errorMessage?: string;
}

/**
 * Tiny dependency-free static file server injected into the build when the app
 * is a static site (Next.js `output: 'export'`, Vite, CRA…). These emit a folder
 * of static files (out/ dist/ build/) instead of a server, so we serve it with Node.
 */
const PAAS_STATIC_SERVER = `const http = require('http');
const fs = require('fs');
const path = require('path');
// Pick the first candidate directory that actually contains index.html.
const candidates = [process.env.PAAS_STATIC_DIR, 'out', 'dist', 'build', 'public'].filter(Boolean);
let root = path.join(__dirname, process.env.PAAS_STATIC_DIR || 'out');
for (const c of candidates) {
  const d = path.join(__dirname, c);
  try { if (fs.existsSync(path.join(d, 'index.html'))) { root = d; break; } } catch (e) {}
}
const port = process.env.PORT || 3000;
const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.webp':'image/webp','.avif':'image/avif','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.txt':'text/plain','.xml':'application/xml','.webmanifest':'application/manifest+json','.map':'application/json','.pdf':'application/pdf' };
function send(res, file) {
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}
http.createServer((req, res) => {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  let file = path.join(root, urlPath);
  if (urlPath.endsWith('/')) file = path.join(file, 'index.html');
  fs.stat(file, (e, st) => {
    if (!e && st.isFile()) return send(res, file);
    fs.stat(file + '.html', (e2, st2) => {
      if (!e2 && st2.isFile()) return send(res, file + '.html');
      fs.stat(path.join(file, 'index.html'), (e3, st3) => {
        if (!e3 && st3.isFile()) return send(res, path.join(file, 'index.html'));
        if (!path.extname(urlPath)) return send(res, path.join(root, 'index.html'));
        send(res, file);
      });
    });
  });
}).listen(port, () => console.log('PaaS static server serving ' + root + ' on port ' + port));
`;

@Injectable()
export class GitHubService implements OnModuleInit {
  private activeToken: string | null = process.env.GITHUB_TOKEN || null;
  private webhookSecret: string = process.env.GITHUB_WEBHOOK_SECRET || '';
  private clientId: string = process.env.GITHUB_CLIENT_ID || '';
  private clientSecret: string = process.env.GITHUB_CLIENT_SECRET || '';
  public appId?: number;
  public appSlug?: string;
  private privateKey?: string;
  private connectionMethod: 'oauth' | 'token' | 'none' = 'none';
  private cachedUser: any = null;
  private storagePath: string;
  private buildSessions: {
    ids: Set<string>;
    repoName: string;
    branch: string;
    status: 'building' | 'success' | 'failed';
    logs: string[];
    listeners: Set<(chunk: string) => void>;
    createdAt: number;
    primaryId: string;
    runId: string;
    logFile: string;
    phase: BuildPhase;
  }[] = [];

  // In-memory cache of persisted deployment timelines, keyed by service/node id.
  private deployHistoryStore: Map<string, DeployHistoryEntry[]> = new Map();

  // ── Persistent deployment history helpers ─────────────────────────────────
  private historyFilePath(key: string) {
    return path.join(getDeploymentsDir(), `${key}.history.json`);
  }

  private loadHistory(key: string): DeployHistoryEntry[] {
    if (!key) return [];
    const cached = this.deployHistoryStore.get(key);
    if (cached) return cached;
    let entries: DeployHistoryEntry[] = [];
    try {
      const file = this.historyFilePath(key);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (Array.isArray(parsed)) entries = parsed;
      }
    } catch {}
    this.deployHistoryStore.set(key, entries);
    return entries;
  }

  private saveHistory(key: string, entries: DeployHistoryEntry[]) {
    if (!key) return;
    const trimmed = entries.slice(0, 50); // cap timeline length
    this.deployHistoryStore.set(key, trimmed);
    try {
      const dir = getDeploymentsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.historyFilePath(key), JSON.stringify(trimmed, null, 2), 'utf8');
    } catch (e: any) {
      console.warn('[GitHubService] Failed to persist deploy history:', e?.message);
    }
  }

  private recordDeployStart(key: string, entry: DeployHistoryEntry) {
    // Truncate this run's log file so each run starts clean.
    try {
      const dir = getDeploymentsDir();
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, entry.logFile), '', 'utf8');
    } catch {}
    const entries = this.loadHistory(key).filter((e) => e.runId !== entry.runId);
    this.saveHistory(key, [entry, ...entries]);
  }

  private updateDeployEntry(key: string, runId: string, patch: Partial<DeployHistoryEntry>) {
    const entries = this.loadHistory(key);
    const entry = entries.find((e) => e.runId === runId);
    if (entry) {
      Object.assign(entry, patch);
      this.saveHistory(key, entries);
    }
  }

  /** Advance the lifecycle phase of a run (importing → building → deploying → running). */
  private setBuildPhase(
    session: { phase: BuildPhase; primaryId: string; runId: string },
    phase: BuildPhase,
  ) {
    session.phase = phase;
    this.updateDeployEntry(session.primaryId, session.runId, { phase });
  }

  /** Re-key a timeline from a temporary node id to the resolved service id. */
  private moveDeployHistory(fromKey: string, toKey: string) {
    if (!fromKey || !toKey || fromKey === toKey) return;
    const source = this.loadHistory(fromKey);
    if (source.length === 0) return;
    const target = this.loadHistory(toKey);
    const merged = [...source, ...target.filter((t) => !source.some((s) => s.runId === t.runId))];
    merged.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    this.saveHistory(toKey, merged);
    // Remove the temporary key's index file/cache. Run log files are shared, so
    // the merged timeline still references the same logs.
    try {
      const f = this.historyFilePath(fromKey);
      if (fs.existsSync(f)) fs.rmSync(f, { force: true });
    } catch {}
    this.deployHistoryStore.delete(fromKey);
  }

  public createBuildSession(
    identifiers: string[],
    repoName: string,
    branch: string,
    primaryId: string,
    runId: string,
    logFile: string,
  ) {
    const now = Date.now();
    this.buildSessions = this.buildSessions.filter((s) => now - s.createdAt < 7200000);
    const session = {
      ids: new Set(identifiers.filter(Boolean)),
      repoName,
      branch,
      status: 'building' as 'building' | 'success' | 'failed',
      logs: [] as string[],
      listeners: new Set<(chunk: string) => void>(),
      createdAt: now,
      primaryId,
      runId,
      logFile,
      phase: 'queued' as BuildPhase,
    };
    this.buildSessions.unshift(session);
    return session;
  }

  public findBuildSession(id: string) {
    if (!id) return undefined;
    const lower = id.toLowerCase();
    return this.buildSessions.find(
      (s) =>
        s.ids.has(id) ||
        s.ids.has(lower) ||
        s.primaryId === id ||
        s.repoName.toLowerCase() === lower ||
        s.repoName.toLowerCase().includes(lower),
    );
  }

  public appendBuildLog(
    session: { logFile: string; logs: string[]; listeners: Set<(chunk: string) => void> },
    text: string,
  ) {
    const clean = text.replace(/x-access-token:[^@]+@/g, '');
    session.logs.push(clean);
    session.listeners.forEach((listener) => {
      try {
        listener(clean);
      } catch {}
    });

    // Append to this run's canonical log file (exactly one file per run), so the
    // deployment history stays consistent and readable by run/service id.
    try {
      if (session.logFile) {
        const logsDir = getDeploymentsDir();
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }
        fs.appendFileSync(path.join(logsDir, session.logFile), clean, 'utf8');
      }
    } catch {}
  }

  private readLatestLogFile(id: string): { content: string; status: string; phase?: BuildPhase } | null {
    const entries = this.loadHistory(id);
    if (entries.length === 0) return null;
    const latest = entries[0];
    try {
      const file = path.join(getDeploymentsDir(), latest.logFile);
      if (fs.existsSync(file)) {
        return { content: fs.readFileSync(file, 'utf8'), status: latest.status, phase: latest.phase };
      }
    } catch {}
    return null;
  }

  public streamBuildLogs(id: string, onData: (chunk: string) => void, onEnd: () => void): () => void {
    let cleanedUp = false;
    let currentSessionListener: ((chunk: string) => void) | null = null;
    let activeSession: any = null;
    let pollTimer: NodeJS.Timeout | null = null;

    const attachToSession = (session: any) => {
      activeSession = session;
      if (session.logs.length > 0) {
        onData(session.logs.join(''));
      }
      if (session.status !== 'building') {
        onEnd();
        return;
      }
      currentSessionListener = onData;
      session.listeners.add(onData);
    };

    const existing = this.findBuildSession(id);
    if (existing) {
      attachToSession(existing);
    } else {
      // Serve the latest persisted run for this service if we have one.
      const disk = this.readLatestLogFile(id);
      if (disk) {
        onData(disk.content);
        onEnd();
        return () => {};
      }

      let attempts = 0;
      const maxAttempts = 40; // 40 * 300ms = 12s grace period for build session registration

      pollTimer = setInterval(() => {
        if (cleanedUp) {
          if (pollTimer) clearInterval(pollTimer);
          return;
        }

        const found = this.findBuildSession(id);
        if (found) {
          if (pollTimer) clearInterval(pollTimer);
          attachToSession(found);
          return;
        }

        attempts++;
        if (attempts >= maxAttempts) {
          if (pollTimer) clearInterval(pollTimer);
          const late = this.readLatestLogFile(id);
          if (late) {
            onData(late.content);
          } else {
            onData(`[BuildEngine] No active build logs found for "${id}". If container is running, switch to Container Logs.\n`);
          }
          onEnd();
        }
      }, 300);
    }

    return () => {
      cleanedUp = true;
      if (pollTimer) clearInterval(pollTimer);
      if (activeSession && currentSessionListener) {
        activeSession.listeners.delete(currentSessionListener);
      }
    };
  }

  public getBuildLogs(id: string): { logs: string[]; status: string; phase?: BuildPhase } {
    const session = this.findBuildSession(id);
    if (session) {
      return { logs: session.logs, status: session.status, phase: session.phase };
    }
    const disk = this.readLatestLogFile(id);
    if (disk) {
      return { logs: [disk.content], status: disk.status, phase: disk.phase };
    }
    return { logs: [], status: 'not_found' };
  }

  /** Lightweight status/phase lookup (no log payload) for UI polling. */
  public getBuildStatus(id: string): { status: string; phase?: BuildPhase } {
    if (!id) return { status: 'not_found' };
    const session = this.findBuildSession(id);
    if (session) {
      return { status: session.status, phase: session.phase };
    }
    const entries = this.loadHistory(id);
    if (entries.length > 0) {
      return { status: entries[0].status, phase: entries[0].phase };
    }
    return { status: 'not_found' };
  }

  public async getDeployHistory(serviceId: string) {
    // 1. Persisted timeline for this service (survives server restarts), with the
    //    live in-memory status overlaid for any run that is still building.
    const entries = this.loadHistory(serviceId).map((e) => {
      const live = this.buildSessions.find((s) => s.runId === e.runId);
      return {
        id: serviceId,
        runId: e.runId,
        status: live ? live.status : e.status,
        phase: live ? live.phase : e.phase,
        createdAt: e.createdAt,
        branch: e.branch,
        repoName: e.repoName,
        logsCount: live ? live.logs.length : e.logsCount,
        errorMessage: e.errorMessage,
        imageTag: e.imageTag,
      };
    });

    if (entries.length > 0) {
      return entries.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }

    // 2. Fallback to the live service record metadata.
    try {
      const svc = await this.servicesService.getService(serviceId);
      if (svc) {
        const rawStatus = (svc.status as string) || '';
        const isFailed = rawStatus === 'failed' || rawStatus === 'error';
        const isBuilding = rawStatus === 'building';
        return [
          {
            id: svc.id,
            runId: svc.id,
            status: isFailed ? 'failed' : isBuilding ? 'building' : 'success',
            phase: isFailed ? 'failed' : isBuilding ? 'building' : 'running',
            createdAt: svc.startedAt || svc.createdAt || new Date().toISOString(),
            branch: svc.gitBranch || svc.env?.GIT_BRANCH || 'main',
            repoName: svc.gitRepo?.split('/').pop()?.replace(/\.git$/, '') || svc.name,
            logsCount: 1,
          },
        ];
      }
    } catch {}

    return [];
  }

  constructor(
    private readonly servicesService: ServicesService,
    private readonly systemSettingsService: SystemSettingsService,
    private readonly dockerService: DockerService,
  ) {
    const baseDir = ensureDataDir();
    this.storagePath = path.join(baseDir, 'github-config.json');
    this.loadConfig();
  }

  async onModuleInit() {
    // If token exists, verify and sync status
    if (this.activeToken) {
      await this.getStatus().catch(() => {});
    }

    // Reclaim disk on startup, then periodically, so builds/images/logs never
    // silently fill the host.
    this.cleanupDeploymentArtifacts();
    this.runDockerMaintenance().catch(() => {});
    if (!this.maintenanceTimer) {
      this.maintenanceTimer = setInterval(() => {
        this.cleanupDeploymentArtifacts();
        this.runDockerMaintenance().catch(() => {});
      }, 6 * 60 * 60 * 1000); // every 6 hours
      this.maintenanceTimer.unref?.();
    }
  }

  private maintenanceTimer: NodeJS.Timeout | null = null;

  /**
   * Remove build images for a service that are no longer the active build or the
   * reusable cache tag. Without this, every deploy would leave a ~900MB image
   * behind and steadily fill the host.
   */
  private async cleanupOldBuildImages(safeName: string, keepTags: Set<string>) {
    try {
      const prefix = `paas-app-${safeName}:`;
      const images = await this.dockerService.client.listImages();
      for (const img of images) {
        const tags = img.RepoTags || [];
        const relevant = tags.filter((t) => t.startsWith(prefix));
        if (relevant.length === 0) continue;
        if (relevant.some((t) => keepTags.has(t))) continue; // active or cache image
        try {
          await this.dockerService.client.getImage(img.Id).remove({ force: false });
          console.log(`[BuildEngine] Pruned old image layers for ${relevant.join(', ')}`);
        } catch {
          // In use elsewhere — leave it for the dangling-image sweep.
        }
      }
    } catch {}
  }

  /**
   * Enforce deployment history/log retention so the external data dir stays small.
   * Trims history entries older than the configured retention and deletes their
   * log files, plus any orphaned run logs.
   */
  private cleanupDeploymentArtifacts() {
    try {
      const dir = getDeploymentsDir();
      if (!fs.existsSync(dir)) return;
      const retentionDays = this.systemSettingsService.getRetentionDays();
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;

      // 1. Trim history entries older than the retention window (+ their logs).
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.history.json')) continue;
        const key = f.replace(/\.history\.json$/, '');
        const entries = this.loadHistory(key);
        const kept = entries.filter((e) => new Date(e.createdAt).getTime() >= cutoff);
        if (kept.length !== entries.length) {
          for (const removed of entries.filter((e) => new Date(e.createdAt).getTime() < cutoff)) {
            try {
              fs.rmSync(path.join(dir, removed.logFile), { force: true });
            } catch {}
          }
          this.saveHistory(key, kept);
        }
      }

      // 2. Remove orphaned log files that no retained history references.
      const referenced = new Set<string>();
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.history.json')) continue;
        for (const e of this.loadHistory(f.replace(/\.history\.json$/, ''))) referenced.add(e.logFile);
      }
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.log')) continue;
        if (!referenced.has(f)) {
          try {
            fs.rmSync(path.join(dir, f), { force: true });
          } catch {}
        }
      }
    } catch {}
  }

  /**
   * Reclaim Docker disk: prune dangling images and cap the BuildKit build cache
   * so it can't grow without bound. Never touches running containers or in-use
   * images, so live services are unaffected.
   */
  private async runDockerMaintenance() {
    try {
      await this.dockerService.client.pruneImages({ filters: { dangling: { true: true } } });
    } catch {}
    try {
      // Keep up to 10GB of build cache; prune the rest.
      // (--reserved-space is the current flag; --keep-storage was deprecated.)
      await this.runProcess('docker', ['builder', 'prune', '-f', '--reserved-space', '10gb'], { timeoutMs: 120000 });
      console.log('[Maintenance] Build cache trimmed (kept ≤10GB).');
    } catch {}
  }

  private loadConfig() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        const parsed: StoredGitHubConfig = JSON.parse(raw);
        if (!this.activeToken && parsed.token) {
          this.activeToken = parsed.token;
        }
        if (!this.webhookSecret && parsed.webhookSecret) {
          this.webhookSecret = parsed.webhookSecret;
        }
        if (!this.clientId && parsed.clientId) {
          this.clientId = parsed.clientId;
        }
        if (!this.clientSecret && parsed.clientSecret) {
          this.clientSecret = parsed.clientSecret;
        }
        if (parsed.appId) {
          this.appId = parsed.appId;
        }
        if (parsed.appSlug) {
          this.appSlug = parsed.appSlug;
        }
        if (parsed.privateKey) {
          this.privateKey = parsed.privateKey;
        }
        if (parsed.method) {
          this.connectionMethod = parsed.method;
        }
      }
    } catch (e: any) {
      console.warn('[GitHubService] Failed to load config:', e.message);
    }

    // Ensure a persistent webhook secret exists if none was configured
    if (!this.webhookSecret) {
      this.webhookSecret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
      this.saveConfig();
    }
  }

  private saveConfig() {
    try {
      const data: StoredGitHubConfig = {
        token: this.activeToken,
        webhookSecret: this.webhookSecret,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        appId: this.appId,
        appSlug: this.appSlug,
        privateKey: this.privateKey,
        method: this.connectionMethod,
      };
      fs.writeFileSync(this.storagePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e: any) {
      console.warn('[GitHubService] Failed to persist config:', e.message);
    }
  }

  private getWebhookUrl(): string {
    const settings = this.systemSettingsService;
    const domain = (settings as any)?.settings?.domains?.serverDomain;
    if (domain && domain.trim()) {
      return `https://${domain.trim()}/api/github/webhook`;
    }
    return `http://localhost:4000/api/github/webhook`;
  }

  private getOAuthCallbackUrl(): string {
    const settings = this.systemSettingsService;
    const domain = (settings as any)?.settings?.domains?.serverDomain;
    if (domain && domain.trim()) {
      return `https://${domain.trim()}/api/github/oauth/callback`;
    }
    return `http://localhost:4000/api/github/oauth/callback`;
  }

  getManifestData(hostDomain?: string) {
    const domain = hostDomain || (this.systemSettingsService as any)?.settings?.domains?.serverDomain;
    const webBase = domain && domain.trim() ? `https://${domain.trim()}` : 'http://localhost:3000';
    const apiBase = domain && domain.trim() ? `https://${domain.trim()}` : 'http://localhost:4000';

    const isLocalhost = webBase.includes('localhost') || webBase.includes('127.0.0.1');
    const randomSuffix = crypto.randomBytes(4).toString('hex');
    const appName = `PaaS-${randomSuffix}`;

    const manifest = {
      name: appName,
      url: webBase,
      hook_attributes: {
        url: isLocalhost ? 'https://example.com/webhook' : `${apiBase}/api/github/webhook`,
        active: !isLocalhost,
      },
      redirect_url: `${apiBase}/api/github/manifest/callback`,
      callback_urls: [
        `${apiBase}/api/github/oauth/callback`,
        'http://localhost:4000/api/github/oauth/callback',
      ],
      setup_url: `${apiBase}/api/github/setup/callback`,
      setup_on_update: true,
      public: true,
      default_permissions: {
        contents: 'read',
        metadata: 'read',
        emails: 'read',
        pull_requests: 'read',
        members: 'read',
      },
      default_events: [
        'push',
      ],
    };

    return {
      manifest,
      appName,
      postUrl: 'https://github.com/settings/apps/new',
    };
  }

  async handleManifestCallback(code: string) {
    const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Railway-Neon-PaaS',
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new BadRequestException(`Failed to create GitHub App from manifest: ${errText}`);
    }

    const data = await res.json();
    this.appId = data.id;
    this.appSlug = data.slug;
    this.clientId = data.client_id;
    this.clientSecret = data.client_secret;
    if (data.webhook_secret) {
      this.webhookSecret = data.webhook_secret;
    }
    if (data.pem) {
      this.privateKey = data.pem;
    }
    this.saveConfig();

    return {
      success: true,
      appId: data.id,
      slug: data.slug,
      clientId: data.client_id,
      authorizeUrl: `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
        data.client_id
      )}&scope=repo,read:user,user:email,read:org`,
    };
  }

  getOAuthUrl(redirectUri?: string): {
    configured: boolean;
    url: string;
    callbackUrl: string;
    manifestStartUrl: string;
    manifest?: any;
    postUrl?: string;
  } {
    const callbackUrl = redirectUri || this.getOAuthCallbackUrl();
    const manifestStartUrl = `http://localhost:4000/api/github/manifest/start`;
    const manifestData = this.getManifestData();

    if (!this.clientId) {
      return {
        configured: false,
        url: manifestStartUrl,
        callbackUrl,
        manifestStartUrl,
        manifest: manifestData.manifest,
        postUrl: manifestData.postUrl,
      };
    }

    const state = crypto.randomBytes(16).toString('hex');
    const redirectParam = redirectUri ? `&redirect_uri=${encodeURIComponent(redirectUri)}` : '';
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      this.clientId
    )}&scope=repo,read:user,user:email,read:org${redirectParam}&state=${state}`;

    return {
      configured: true,
      url,
      callbackUrl,
      manifestStartUrl,
      manifest: manifestData.manifest,
      postUrl: manifestData.postUrl,
    };
  }

  async setOAuthConfig(clientId: string, clientSecret: string): Promise<GitHubStatus> {
    this.clientId = clientId.trim();
    this.clientSecret = clientSecret.trim();
    this.saveConfig();
    return this.getStatus();
  }

  async resetAppConfig(): Promise<GitHubStatus> {
    this.clientId = '';
    this.clientSecret = '';
    this.appId = undefined;
    this.appSlug = undefined;
    this.privateKey = undefined;
    this.activeToken = null;
    this.cachedUser = null;
    this.connectionMethod = 'none';
    this.saveConfig();
    return this.getStatus();
  }

  async handleOAuthCallback(code: string): Promise<GitHubStatus> {
    if (!this.clientId || !this.clientSecret) {
      throw new BadRequestException('GitHub OAuth is not configured on this server');
    }

    const res = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    if (!res.ok) {
      throw new BadRequestException('Failed to exchange authorization code with GitHub');
    }

    const data = await res.json();
    if (data.error || !data.access_token) {
      throw new BadRequestException(data.error_description || 'Invalid OAuth code');
    }

    this.connectionMethod = 'oauth';
    return this.setToken(data.access_token);
  }

  async getStatus(): Promise<GitHubStatus> {
    const webhookUrl = this.getWebhookUrl();
    const oauthConfigured = !!(this.clientId && this.clientSecret);
    const appConfigured = !!this.appId;

    if (!this.activeToken) {
      await this.systemSettingsService.updateSettings({
        github: {
          connected: false,
          username: '',
          appInstalled: false,
          webhookUrl,
          webhookSecret: this.webhookSecret,
        },
      });

      return {
        connected: false,
        method: 'none',
        oauthConfigured,
        appConfigured,
        appName: this.appSlug,
        appSlug: this.appSlug,
        appInstallUrl: this.appSlug ? `https://github.com/apps/${this.appSlug}/installations/select_target` : undefined,
        appSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}` : undefined,
        appPublicSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}/advanced` : undefined,
        clientId: this.clientId ? `${this.clientId.slice(0, 6)}••••••••` : undefined,
        webhookUrl,
        webhookSecret: this.webhookSecret,
      };
    }

    try {
      if (!this.cachedUser) {
        const res = await fetch('https://api.github.com/user', {
          headers: {
            Authorization: `Bearer ${this.activeToken}`,
            'User-Agent': 'Railway-Neon-PaaS',
            Accept: 'application/vnd.github.v3+json',
          },
        });

        if (!res.ok) {
          // Token is invalid or expired
          this.activeToken = null;
          this.cachedUser = null;
          this.connectionMethod = 'none';
          this.saveConfig();
          return {
            connected: false,
            method: 'none',
            oauthConfigured,
            appConfigured,
            appName: this.appSlug,
            appSlug: this.appSlug,
            appInstallUrl: this.appSlug ? `https://github.com/apps/${this.appSlug}/installations/select_target` : undefined,
            appSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}` : undefined,
            appPublicSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}/advanced` : undefined,
            clientId: this.clientId ? `${this.clientId.slice(0, 6)}••••••••` : undefined,
            webhookUrl,
            webhookSecret: this.webhookSecret,
          };
        }

        this.cachedUser = await res.json();
      }

      await this.systemSettingsService.updateSettings({
        github: {
          connected: true,
          username: this.cachedUser.login || '',
          appInstalled: true,
          webhookUrl,
          webhookSecret: this.webhookSecret,
        },
      });

      let organizations: Array<{ login: string; avatarUrl?: string; description?: string }> = [];
      try {
        const instRes = await fetch('https://api.github.com/user/installations', {
          headers: {
            Authorization: `Bearer ${this.activeToken}`,
            'User-Agent': 'Railway-Neon-PaaS',
            Accept: 'application/vnd.github.v3+json',
          },
        });
        if (instRes.ok) {
          const instData = await instRes.json();
          if (Array.isArray(instData.installations)) {
            organizations = instData.installations
              .filter((i: any) => i.account?.type === 'Organization')
              .map((i: any) => ({
                login: i.account.login,
                avatarUrl: i.account.avatar_url,
                description: i.account.description,
              }));
          }
        }
      } catch {
        // Ignore organization fetch failure
      }

      return {
        connected: true,
        method: this.connectionMethod || 'token',
        oauthConfigured,
        appConfigured,
        appName: this.appSlug,
        appSlug: this.appSlug,
        appInstallUrl: this.appSlug ? `https://github.com/apps/${this.appSlug}/installations/select_target` : undefined,
        appSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}` : undefined,
        appPublicSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}/advanced` : undefined,
        clientId: this.clientId ? `${this.clientId.slice(0, 6)}••••••••` : undefined,
        user: {
          login: this.cachedUser.login,
          avatarUrl: this.cachedUser.avatar_url,
          name: this.cachedUser.name,
          htmlUrl: this.cachedUser.html_url,
        },
        organizations,
        repoCount: (this.cachedUser.public_repos || 0) + (this.cachedUser.total_private_repos || 0),
        webhookUrl,
        webhookSecret: this.webhookSecret,
      };
    } catch {
      return {
        connected: false,
        method: 'none',
        oauthConfigured,
        appConfigured,
        appName: this.appSlug,
        appSlug: this.appSlug,
        appInstallUrl: this.appSlug ? `https://github.com/apps/${this.appSlug}/installations/select_target` : undefined,
        appSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}` : undefined,
        appPublicSettingsUrl: this.appSlug ? `https://github.com/settings/apps/${this.appSlug}/advanced` : undefined,
        clientId: this.clientId ? `${this.clientId.slice(0, 6)}••••••••` : undefined,
        webhookUrl,
        webhookSecret: this.webhookSecret,
      };
    }
  }

  async setToken(token: string): Promise<GitHubStatus> {
    const trimmed = token.trim();
    if (!trimmed) {
      throw new BadRequestException('Token cannot be empty');
    }

    const res = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `Bearer ${trimmed}`,
        'User-Agent': 'Railway-Neon-PaaS',
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (!res.ok) {
      throw new BadRequestException('Invalid GitHub Personal Access Token or insufficient permissions');
    }

    this.activeToken = trimmed;
    if (!this.connectionMethod || this.connectionMethod === 'none') {
      this.connectionMethod = 'token';
    }
    this.cachedUser = await res.json();
    this.saveConfig();

    return this.getStatus();
  }

  async disconnect(): Promise<GitHubStatus> {
    this.activeToken = null;
    this.cachedUser = null;
    this.connectionMethod = 'none';
    this.saveConfig();
    return this.getStatus();
  }

  async listRepos(): Promise<GitHubRepo[]> {
    if (!this.activeToken) {
      return [];
    }

    const headers = {
      Authorization: `Bearer ${this.activeToken}`,
      'User-Agent': 'Railway-Neon-PaaS',
      Accept: 'application/vnd.github.v3+json',
    };

    try {
      // 1. First attempt: Fetch via GitHub App installations (Railway architecture)
      // This strictly returns ONLY the repositories and organizations the user explicitly selected.
      const instRes = await fetch('https://api.github.com/user/installations', { headers });
      if (instRes.ok) {
        const instData = await instRes.json();
        if (Array.isArray(instData.installations) && instData.installations.length > 0) {
          const reposMap = new Map<number, GitHubRepo>();

          for (const inst of instData.installations) {
            try {
              let page = 1;
              let hasMore = true;
              while (hasMore && page <= 5) {
                const rRes = await fetch(
                  `https://api.github.com/user/installations/${inst.id}/repositories?per_page=100&page=${page}`,
                  { headers }
                );
                if (!rRes.ok) break;
                const rData = await rRes.json();
                const items = rData.repositories || [];
                for (const r of items) {
                  reposMap.set(r.id, {
                    id: r.id,
                    name: r.name,
                    fullName: r.full_name,
                    owner: r.owner?.login || '',
                    description: r.description,
                    private: r.private,
                    defaultBranch: r.default_branch || 'main',
                    language: r.language,
                    stars: r.stargazers_count || 0,
                    updatedAt: r.updated_at,
                    htmlUrl: r.html_url,
                    cloneUrl: r.clone_url,
                  });
                }
                hasMore = items.length === 100 && (rData.total_count || 0) > page * 100;
                page++;
              }
            } catch {
              // Continue with remaining installations
            }
          }

          return Array.from(reposMap.values()).sort(
            (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          );
        }
      }

      // 2. Fallback for manual PAT:
      const res = await fetch('https://api.github.com/user/repos?affiliation=owner,collaborator&sort=updated&per_page=100', {
        headers,
      });
      if (!res.ok) {
        throw new Error(`GitHub API error: ${res.statusText}`);
      }
      const raw = await res.json();
      return raw.map((r: any) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner?.login || '',
        description: r.description,
        private: r.private,
        defaultBranch: r.default_branch || 'main',
        language: r.language,
        stars: r.stargazers_count || 0,
        updatedAt: r.updated_at,
        htmlUrl: r.html_url,
        cloneUrl: r.clone_url,
      }));
    } catch (err: any) {
      throw new BadRequestException(`Failed to fetch repositories from GitHub: ${err.message}`);
    }
  }

  async getPublicRepo(owner: string, repo: string): Promise<GitHubRepo> {
    const headers: Record<string, string> = {
      'User-Agent': 'Railway-Neon-PaaS',
      Accept: 'application/vnd.github.v3+json',
    };
    if (this.activeToken) {
      headers.Authorization = `Bearer ${this.activeToken}`;
    }

    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {
      headers,
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new NotFoundException(`Repository '${owner}/${repo}' not found or is private.`);
      }
      throw new BadRequestException(`Failed to fetch repository '${owner}/${repo}': ${res.statusText}`);
    }

    const r = await res.json();
    return {
      id: r.id,
      name: r.name,
      fullName: r.full_name,
      owner: r.owner?.login || '',
      description: r.description,
      private: r.private,
      defaultBranch: r.default_branch || 'main',
      language: r.language,
      stars: r.stargazers_count || 0,
      updatedAt: r.updated_at,
      htmlUrl: r.html_url,
      cloneUrl: r.clone_url,
    };
  }

  async listBranches(owner: string, repo: string): Promise<string[]> {
    const headers: Record<string, string> = {
      'User-Agent': 'Railway-Neon-PaaS',
      Accept: 'application/vnd.github.v3+json',
    };
    if (this.activeToken) {
      headers.Authorization = `Bearer ${this.activeToken}`;
    }

    try {
      const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=50`, {
        headers,
      });

      if (!res.ok) {
        return ['main'];
      }

      const branches = await res.json();
      if (!Array.isArray(branches) || branches.length === 0) {
        return ['main'];
      }
      return branches.map((b: any) => b.name);
    } catch {
      return ['main'];
    }
  }

  private async runProcess(
    cmd: string,
    args: string[],
    options: {
      cwd?: string;
      env?: Record<string, string>;
      timeoutMs?: number;
      onLog?: (chunk: string) => void;
    } = {},
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const extraPath = [
        '/home/blockchainbard/.local/bin',
        '/opt/homebrew/bin',
        '/Users/MAC/.docker/bin',
        '/Users/MAC/.nvm/versions/node/v24.21.0/bin',
        '/usr/local/bin',
        '/usr/bin',
        '/bin',
        '/usr/sbin',
        '/sbin',
      ].join(':');

      const fullPath = `${extraPath}:${process.env.PATH || ''}`;

      const child = spawn(cmd, args, {
        cwd: options.cwd || process.cwd(),
        env: {
          ...process.env,
          PATH: fullPath,
          ...(options.env || {}),
        },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (chunk) => {
        const text = chunk.toString();
        stdout += text;
        const clean = text.replace(/x-access-token:[^@]+@/g, '');
        console.log(`[${cmd}] ${clean.trimEnd()}`);
        options.onLog?.(clean);
      });

      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString();
        stderr += text;
        const clean = text.replace(/x-access-token:[^@]+@/g, '');
        console.error(`[${cmd}:err] ${clean.trimEnd()}`);
        options.onLog?.(clean);
      });

      let timer: NodeJS.Timeout | null = null;
      const timeoutMs = options.timeoutMs;
      if (timeoutMs) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          const mins = Math.round(timeoutMs / 60000);
          reject(
            new Error(
              `Build timed out after ${mins} minute(s). Increase "Build Timeout (Minutes)" in System Settings → Deployments if this project needs longer (cold Nixpacks builds can take a while on first run).`,
            ),
          );
        }, timeoutMs);
      }

      child.on('error', (err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });

      child.on('close', (code) => {
        if (timer) clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
        } else {
          const cleanErr = (stderr || stdout || `exited with code ${code}`).replace(/x-access-token:[^@]+@/g, '');
          reject(new Error(`Command "${cmd} ${args.join(' ')}" failed (code ${code}): ${cleanErr.slice(-1000)}`));
        }
      });
    });
  }

  async detectRepoBuild(
    owner: string,
    repo: string,
    branch?: string,
    subfolder?: string,
    dockerfilePath?: string
  ): Promise<{
    hasDockerfile: boolean;
    dockerfilePaths: string[];
    language: string | null;
    framework: string | null;
    suggestedPort: number;
    subfolders: Array<{
      path: string;
      name: string;
      framework?: string;
      hasDockerfile: boolean;
      dockerfilePaths?: string[];
      suggestedPort: number;
    }>;
  }> {
    const headers: Record<string, string> = {
      'User-Agent': 'Railway-Neon-PaaS',
      Accept: 'application/vnd.github.v3+json',
    };
    if (this.activeToken) {
      headers['Authorization'] = `Bearer ${this.activeToken}`;
    }

    const allDockerfiles: string[] = [];

    const subfolderMap = new Map<string, {
      path: string;
      name: string;
      framework?: string;
      hasDockerfile: boolean;
      dockerfilePaths?: string[];
      suggestedPort: number;
    }>();

    // Default root option
    subfolderMap.set('.', {
      path: '.',
      name: 'Root (/)',
      framework: 'Auto-detect',
      hasDockerfile: false,
      dockerfilePaths: [],
      suggestedPort: 3000,
    });

    let overallLanguage: string | null = null;

    try {
      // 1. Fetch repo metadata for default language
      const repoRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}`,
        { headers }
      );
      if (repoRes.ok) {
        const repoData = await repoRes.json();
        overallLanguage = repoData.language || null;
      }

      // 2. Discover deployable monorepo subfolders via GitHub git tree
      const ref = branch || 'HEAD';
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        { headers }
      );

      if (treeRes.ok) {
        const treeData = await treeRes.json();
        const treeItems = Array.isArray(treeData.tree) ? treeData.tree : [];

        for (const item of treeItems) {
          const p: string = item.path || '';
          if (
            p.includes('node_modules/') ||
            p.includes('.git/') ||
            p.includes('dist/') ||
            p.includes('build/') ||
            p.includes('.next/') ||
            p.includes('vendor/') ||
            p.includes('test/') ||
            p.includes('tests/') ||
            p.includes('fixtures/')
          ) {
            continue;
          }

          const filename = path.basename(p);
          const dir = path.dirname(p);
          const depth = dir === '.' ? 0 : dir.split('/').length;
          if (depth > 3) continue;

          const isDockerfile =
            filename.toLowerCase() === 'dockerfile' ||
            filename.toLowerCase().startsWith('dockerfile.') ||
            filename.toLowerCase().endsWith('.dockerfile');

          const isManifest = isDockerfile || [
            'package.json',
            'requirements.txt',
            'Pipfile',
            'pyproject.toml',
            'go.mod',
            'Cargo.toml',
            'pom.xml',
            'build.gradle',
            'composer.json',
          ].includes(filename);

          if (!isManifest) continue;

          const cleanDir = dir === '.' ? '.' : dir;
          const current = subfolderMap.get(cleanDir) || {
            path: cleanDir,
            name: cleanDir === '.' ? 'Root (/)' : cleanDir,
            hasDockerfile: false,
            dockerfilePaths: [],
            suggestedPort: 3000,
          };

          if (isDockerfile) {
            current.hasDockerfile = true;
            if (!current.dockerfilePaths) current.dockerfilePaths = [];
            current.dockerfilePaths.push(filename);
            allDockerfiles.push(p);
            if (!current.framework) current.framework = 'Dockerfile';
          }

          if (filename === 'package.json') {
            const lowerDir = cleanDir.toLowerCase();
            if (lowerDir.includes('next') || lowerDir.includes('web') || lowerDir.includes('frontend') || lowerDir.includes('client') || lowerDir.includes('ui')) {
              current.framework = 'Next.js / Frontend';
              current.suggestedPort = 3000;
            } else if (lowerDir.includes('nest') || lowerDir.includes('server') || lowerDir.includes('backend') || lowerDir.includes('api')) {
              current.framework = 'NestJS / API Server';
              current.suggestedPort = 4000;
            } else {
              current.framework = current.framework || 'Node.js App';
              current.suggestedPort = 3000;
            }
          } else if (filename === 'requirements.txt' || filename === 'pyproject.toml') {
            current.framework = 'Python Service';
            current.suggestedPort = 8000;
          } else if (filename === 'go.mod') {
            current.framework = 'Go Service';
            current.suggestedPort = 8080;
          } else if (filename === 'Cargo.toml') {
            current.framework = 'Rust Service';
            current.suggestedPort = 8080;
          }

          subfolderMap.set(cleanDir, current);
        }
      }
    } catch {
      // Fallback
    }

    const subfoldersList = Array.from(subfolderMap.values()).sort((a, b) => {
      if (a.path === '.') return -1;
      if (b.path === '.') return 1;
      return a.path.localeCompare(b.path);
    });

    // Determine details for target subfolder
    const targetPath = (subfolder || '.').trim().replace(/^\/+|\/+$/g, '') || '.';
    const targetEntry = subfolderMap.get(targetPath) || subfolderMap.get('.') || {
      path: targetPath,
      name: targetPath,
      hasDockerfile: false,
      dockerfilePaths: [],
      suggestedPort: 3000,
    };

    const rootEntry = subfolderMap.get('.');
    let hasDockerfile = targetEntry.hasDockerfile || (rootEntry?.hasDockerfile ?? false);

    if (dockerfilePath) {
      const cleanDf = dockerfilePath.trim();
      const match = allDockerfiles.some(
        (df) => df === cleanDf || df.endsWith(`/${cleanDf}`) || path.basename(df) === cleanDf
      );
      if (match) {
        hasDockerfile = true;
      }
    }

    return {
      hasDockerfile,
      dockerfilePaths: allDockerfiles,
      language: overallLanguage,
      framework: targetEntry.framework || (hasDockerfile ? 'Dockerfile' : overallLanguage || 'Auto-detect'),
      suggestedPort: targetEntry.suggestedPort || 3000,
      subfolders: subfoldersList,
    };
  }

  /**
   * Scans a repository (via the GitHub API — no clone) for the environment
   * variables the project actually uses, so the deploy UI can suggest them.
   * Reads `.env.example`-style files first (most authoritative, may carry sample
   * values) then greps a capped set of source files for `process.env.X`,
   * `import.meta.env.X`, `os.getenv("X")`, etc.
   */
  async suggestEnvVars(
    owner: string,
    repo: string,
    branch?: string,
    subfolder?: string,
  ): Promise<Array<{ key: string; client: boolean; sources: string[]; sample?: string }>> {
    const headers: Record<string, string> = {
      'User-Agent': 'Railway-Neon-PaaS',
      Accept: 'application/vnd.github.v3+json',
    };
    if (this.activeToken) headers.Authorization = `Bearer ${this.activeToken}`;

    const ref = branch || 'HEAD';
    const treeRes = await fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
      { headers, signal: AbortSignal.timeout(12000) },
    );
    if (!treeRes.ok) {
      throw new BadRequestException(`Could not read repository tree (${treeRes.statusText})`);
    }
    const treeData = await treeRes.json();
    const items: any[] = Array.isArray(treeData.tree) ? treeData.tree : [];

    const cleanSub = (subfolder || '').trim().replace(/^\/+|\/+$/g, '');
    const prefix = cleanSub && cleanSub !== '.' ? `${cleanSub}/` : '';

    const skipDir = /(^|\/)(node_modules|\.git|dist|build|\.next|vendor|out|coverage|test|tests|__tests__)\//;
    const paths = items
      .filter((i) => i.type === 'blob' && typeof i.path === 'string')
      .map((i) => i.path as string)
      .filter((p) => p.startsWith(prefix) && !skipDir.test(p))
      .map((p) => p.slice(prefix.length));

    // `.env.example`-style files (authoritative).
    const ENV_FILE_RE = /^(\.env(\.example|\.sample|\.template|\.dist|\.defaults|\.local\.example)?|env\.example|example\.env|\.envrc)$/i;
    const envFiles = paths.filter((p) => ENV_FILE_RE.test(path.basename(p))).slice(0, 3);

    // Source files most likely to reference env vars (capped for speed).
    const SRC_EXT = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rb', '.php', '.rs', '.java', '.kt', '.env', '.yml', '.yaml'];
    const PRIORITY = ['next.config', 'vite.config', 'nuxt.config', 'astro.config', 'svelte.config', 'docker-compose', 'app.module', 'main.', 'index.', 'server.', 'config.', 'route.', 'api/'];
    let srcFiles = paths.filter((p) => SRC_EXT.includes(path.extname(p).toLowerCase()));
    srcFiles.sort((a, b) => {
      const pa = PRIORITY.some((x) => a.includes(x)) ? 1 : 0;
      const pb = PRIORITY.some((x) => b.includes(x)) ? 1 : 0;
      return pb - pa;
    });
    srcFiles = srcFiles.slice(0, 15);

    // Fetch raw text (not base64 JSON) with a short timeout — much faster.
    const fetchFile = async (relPath: string): Promise<string> => {
      try {
        const r = await fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${relPath.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
          { headers: { ...headers, Accept: 'application/vnd.github.v3.raw' }, signal: AbortSignal.timeout(8000) },
        );
        if (!r.ok) return '';
        return await r.text();
      } catch {
        return '';
      }
    };

    const SKIP = new Set(['NODE_ENV', 'PORT', 'HOST', 'HOSTNAME', 'PATH', 'HOME', 'PWD', 'TZ', 'NODE_OPTIONS', 'TMPDIR', 'USER']);
    const CLIENT_RE = /^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_|NUXT_PUBLIC_|VUE_APP_|EXPO_PUBLIC_|STORYBOOK_|GATSBY_|ASTRO_|SVELTE_)/;
    const found = new Map<string, { client: boolean; sources: Set<string>; sample?: string }>();
    const addKey = (key: string, source: string, sample?: string) => {
      const k = key.trim();
      if (!k || k.length > 64 || SKIP.has(k.toUpperCase())) return;
      const existing = found.get(k) || { client: CLIENT_RE.test(k), sources: new Set<string>(), sample: undefined };
      existing.sources.add(source);
      if (sample !== undefined && existing.sample === undefined) existing.sample = sample;
      found.set(k, existing);
    };

    // 1. Parse env example files (capture sample values + comments).
    await Promise.all(
      envFiles.map(async (f) => {
        const content = await fetchFile(prefix + f);
        for (const line of content.split('\n')) {
          const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
          if (m) {
            const val = m[2].replace(/^["']|["']$/g, '').trim();
            addKey(m[1], f, val || undefined);
          }
        }
      }),
    );

    // 2. Grep source files for env usage.
    const USE_REGEXES: RegExp[] = [
      /process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
      /process\.env\[\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]\s*\]/g,
      /import\.meta\.env\.([A-Za-z_][A-Za-z0-9_]*)/g,
      /os\.environ(?:\.get)?\(?\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
      /os\.getenv\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g,
      /os\.Getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
      /System\.getenv\(\s*"([A-Za-z_][A-Za-z0-9_]*)"/g,
    ];
    await Promise.all(
      srcFiles.map(async (f) => {
        const content = await fetchFile(prefix + f);
        if (!content) return;
        for (const re of USE_REGEXES) {
          re.lastIndex = 0;
          let m: RegExpExecArray | null;
          while ((m = re.exec(content))) addKey(m[1], f);
        }
      }),
    );

    return Array.from(found.entries())
      .map(([key, v]) => ({ key, client: v.client, sources: Array.from(v.sources), sample: v.sample }))
      .sort((a, b) => a.key.localeCompare(b.key));
  }

  /**
   * Detects a Next.js static export (next.config.* with `output: 'export'`),
   * which emits an `out/` dir that must be served statically instead of `next start`.
   */
  private isNextStaticExport(appDir: string): boolean {
    try {
      for (const f of ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs']) {
        const p = path.join(appDir, f);
        if (fs.existsSync(p)) {
          const c = fs.readFileSync(p, 'utf8');
          if (/output\s*:\s*['"]export['"]/.test(c)) return true;
        }
      }
    } catch {}
    return false;
  }

  /** Reads and parses the app's package.json (or null). */
  private readPackageJson(appDir: string): any | null {
    try {
      const p = path.join(appDir, 'package.json');
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {}
    return null;
  }

  /**
   * Client-exposed build-time variables (Vite/Next/CRA etc.) that must be present
   * during the build to be inlined into the bundle. Other vars are provided at
   * container runtime instead (so secrets aren't baked into the image).
   */
  private getPublicBuildEnv(env?: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    const re = /^(VITE_|NEXT_PUBLIC_|REACT_APP_|PUBLIC_|NUXT_|VUE_APP_|EXPO_PUBLIC_|STORYBOOK_|GATSBY_|ASTRO_|SVELTE_)/;
    for (const [k, v] of Object.entries(env || {})) {
      if (re.test(k)) out[k] = v;
    }
    return out;
  }

  /**
   * True for static sites that must be served from a built folder rather than a
   * server process: Next.js `output: 'export'` (out/), Vite (dist/), CRA (build/).
   */
  private isStaticSite(appDir: string): boolean {
    if (this.isNextStaticExport(appDir)) return true;
    try {
      for (const f of ['vite.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.mts']) {
        if (fs.existsSync(path.join(appDir, f))) return true;
      }
      const pkg = this.readPackageJson(appDir);
      const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
      if (deps['vite'] || deps['react-scripts']) return true;
    } catch {}
    return false;
  }

  private getRepoNodeVersion(appDir: string): string | null {
    try {
      for (const f of ['.nvmrc', '.node-version']) {
        const p = path.join(appDir, f);
        if (fs.existsSync(p)) {
          const v = fs.readFileSync(p, 'utf8').trim().replace(/^v/, '');
          if (v) return v;
        }
      }
      const pkgPath = path.join(appDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const eng = pkg?.engines?.node;
        if (typeof eng === 'string') {
          const m = eng.match(/\d+(\.\d+){0,2}/);
          if (m) return m[0];
        }
      }
    } catch {}
    return null;
  }

  /**
   * Generates a slim, production-optimized Dockerfile for supported stacks so a
   * user can opt into fast cold builds and small images without the Nix toolchain.
   * Returns null when the stack isn't safely supported (caller falls back to Nixpacks).
   */
  private generateSlimDockerfile(
    appDir: string,
    options: {
      port?: number;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
      systemPackages?: string;
      nodeVersion?: string;
      staticSite?: boolean;
      buildEnv?: Record<string, string>;
    },
  ): string | null {
    const port = options.port || 3000;

    // Node major version for the slim base image (repo pin → setting → default 22).
    const nodeMajor = (options.nodeVersion || this.getRepoNodeVersion(appDir) || '22').split('.')[0];

    // Optional OS packages, e.g. "libpq-dev imagemagick". Sanitised to safe tokens
    // (must start alphanumeric) so no leading-dash option/flag can be injected.
    const sysPkgs = (options.systemPackages || '')
      .split(/[\s,]+/)
      .map((p) => p.trim())
      .filter((p) => /^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(p));
    const aptInstall = sysPkgs.length
      ? `RUN apt-get update && apt-get install -y --no-install-recommends ${sysPkgs.join(' ')} && rm -rf /var/lib/apt/lists/*`
      : null;
    const apkInstall = sysPkgs.length ? `RUN apk add --no-cache ${sysPkgs.join(' ')}` : null;

    // ── Node.js ──────────────────────────────────────────────────────────────
    if (fs.existsSync(path.join(appDir, 'package.json'))) {
      let scripts: Record<string, string> = {};
      try {
        scripts = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'))?.scripts || {};
      } catch {}

      const hasPnpm = fs.existsSync(path.join(appDir, 'pnpm-lock.yaml'));
      const hasYarn = fs.existsSync(path.join(appDir, 'yarn.lock'));
      const pm = hasPnpm ? 'pnpm' : hasYarn ? 'yarn' : 'npm';

      const copyManifests = hasPnpm
        ? 'COPY package.json pnpm-lock.yaml* .npmrc* ./'
        : hasYarn
        ? 'COPY package.json yarn.lock* .yarnrc* ./'
        : 'COPY package*.json ./';

      const installAll =
        options.installCommand ||
        (pm === 'pnpm'
          ? 'corepack enable && pnpm install'
          : pm === 'yarn'
          ? 'corepack enable && yarn install'
          : 'npm ci --include=dev || npm install --include=dev');
      const installProd =
        pm === 'pnpm'
          ? 'corepack enable && pnpm install --prod'
          : pm === 'yarn'
          ? 'corepack enable && yarn install --production'
          : 'npm ci --omit=dev || npm install --omit=dev';
      const pruneDev =
        pm === 'pnpm' ? 'pnpm prune --prod || true' : pm === 'yarn' ? 'true' : 'npm prune --omit=dev || true';

      const startCmd = options.staticSite
        ? 'node paas-static-server.js'
        : options.startCommand ||
          (scripts['start:prod'] ? `${pm} run start:prod` : scripts.start ? `${pm} start` : 'node index.js');

      const lines: string[] = [
        '# Generated by the PaaS "Fast" build preset.',
        '# Slim Debian-based Node image — no Nix toolchain, small & quick to build.',
        `FROM node:${nodeMajor}-slim`,
        'WORKDIR /app',
      ];
      if (aptInstall) lines.push(aptInstall);
      lines.push(copyManifests);

      // Most Node apps with a `build` script (Vite, Next, Nest, CRA…) need that
      // step to produce their output; run it, then prune dev deps.
      const buildCmd = options.buildCommand || (scripts.build ? `${pm} run build` : undefined);
      const buildEnv = options.buildEnv || {};
      if (buildCmd) {
        lines.push(`RUN ${installAll}`);
        lines.push('COPY . .');
        // Client build-time vars (VITE_*, NEXT_PUBLIC_*, …) must exist at build time.
        for (const k of Object.keys(buildEnv)) lines.push(`ARG ${k}`);
        for (const [k, v] of Object.entries(buildEnv)) {
          lines.push(`ENV ${k}=${String(v).replace(/\$/g, '\\$')}`);
        }
        lines.push(`RUN ${buildCmd} && ([ -d dist/src ] && [ ! -f dist/main.js ] && cp -r dist/src/* dist/ 2>/dev/null || true)`);
        lines.push(`RUN ${pruneDev}`);
      } else {
        lines.push(`RUN ${installProd}`);
        lines.push('COPY . .');
      }

      lines.push('ENV NODE_ENV=production');
      lines.push(`EXPOSE ${port}`);
      lines.push(`CMD ${JSON.stringify(['sh', '-lc', startCmd])}`);
      lines.push('');
      return lines.join('\n');
    }

    // ── Python (best-effort; requires an explicit start command) ──────────────
    if (
      fs.existsSync(path.join(appDir, 'requirements.txt')) ||
      fs.existsSync(path.join(appDir, 'pyproject.toml'))
    ) {
      if (!options.startCommand) return null; // no known entrypoint → fall back to Nixpacks
      const hasReqs = fs.existsSync(path.join(appDir, 'requirements.txt'));
      const install =
        options.installCommand ||
        (hasReqs ? 'pip install --no-cache-dir -r requirements.txt' : 'pip install --no-cache-dir .');
      const lines = [
        '# Generated by the PaaS "Fast" build preset (Python).',
        'FROM python:3.12-slim',
        'WORKDIR /app',
        'ENV PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1',
      ];
      if (aptInstall) lines.push(aptInstall);
      lines.push(hasReqs ? 'COPY requirements.txt ./' : 'COPY pyproject.toml ./');
      lines.push(`RUN ${install}`);
      lines.push('COPY . .');
      lines.push(`EXPOSE ${port}`);
      lines.push(`CMD ${JSON.stringify(['sh', '-lc', options.startCommand])}`);
      lines.push('');
      return lines.join('\n');
    }

    // ── Go (best-effort multi-stage) ─────────────────────────────────────────
    if (fs.existsSync(path.join(appDir, 'go.mod'))) {
      if (!options.startCommand) return null;
      const buildCmd = options.buildCommand || 'go build -o /out/app .';
      const lines = [
        '# Generated by the PaaS "Fast" build preset (Go).',
        'FROM golang:1.22-alpine AS build',
        'WORKDIR /src',
        'COPY go.mod go.sum* ./',
        'RUN go mod download',
        'COPY . .',
        `RUN ${buildCmd}`,
        'FROM alpine:3.20',
        'WORKDIR /app',
      ];
      if (apkInstall) lines.push(apkInstall);
      lines.push('COPY --from=build /out /app');
      lines.push(`EXPOSE ${port}`);
      lines.push(`CMD ${JSON.stringify(['sh', '-lc', options.startCommand])}`);
      lines.push('');
      return lines.join('\n');
    }

    return null;
  }


  async deployFromGitHub(options: {
    tempId?: string;
    serviceId?: string;
    serviceName?: string;
    repoName: string;
    branch: string;
    cloneUrl: string;
    subfolder?: string;
    dockerfilePath?: string;
    buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    systemPackages?: string;
    nodeVersion?: string;
    port?: number;
    env?: Record<string, string>;
  }) {
    const safeName = options.repoName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const buildId = crypto.randomBytes(4).toString('hex');
    const imageTag = `paas-app-${safeName}:${buildId}`;
    const buildsBaseDir = getBuildsDir();
    const buildDir = path.join(buildsBaseDir, `${safeName}-${buildId}`);

    const cleanSubfolder = (options.subfolder || '').trim().replace(/^\/+|\/+$/g, '');
    const defaultSubName = cleanSubfolder && cleanSubfolder !== '.'
      ? `${safeName}-${path.basename(cleanSubfolder)}`
      : safeName;
    const subName = options.serviceName && options.serviceName.trim()
      ? options.serviceName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
      : defaultSubName;

    // The stable id the UI uses for this deployment: the real service id on a
    // redeploy, or the temporary canvas node id for a brand-new deployment.
    const primaryId = options.serviceId || options.tempId || safeName;
    const runId = `${safeName}-${buildId}`;
    const logFile = `${runId}.log`;

    const session = this.createBuildSession(
      [options.tempId || '', options.serviceId || '', safeName, subName, buildId],
      options.repoName,
      options.branch,
      primaryId,
      runId,
      logFile,
    );

    // Record the deployment run immediately so every surface (canvas, drawer,
    // history tab) sees a "building" entry from the very first moment.
    this.recordDeployStart(primaryId, {
      runId,
      status: 'building',
      phase: 'queued',
      createdAt: new Date().toISOString(),
      branch: options.branch,
      repoName: options.repoName,
      logFile,
      logsCount: 0,
      imageTag,
    });

    const log = (msg: string) => this.appendBuildLog(session, msg);

    // Cold Nixpacks builds can download hundreds of MB from cache.nixos.org on the
    // first run, so honour the configured "Build Timeout (Minutes)" setting here.
    const buildTimeoutMs = this.systemSettingsService.getBuildTimeoutMs();
    const cloneTimeoutMs = Math.max(buildTimeoutMs / 4, 300000); // 5 min minimum for clone

    await fs.promises.mkdir(buildsBaseDir, { recursive: true });

    log(`[${new Date().toISOString()}] 🚀 Starting build & deploy for ${options.repoName} (branch: ${options.branch}, subfolder: ${options.subfolder || 'root'})...\n`);

    // 1. Prepare authenticated clone URL if private
    let gitCloneUrl = options.cloneUrl;
    if (this.activeToken && gitCloneUrl.startsWith('https://github.com/')) {
      gitCloneUrl = gitCloneUrl.replace('https://github.com/', `https://x-access-token:${this.activeToken}@github.com/`);
    }

    let buildStrategy: 'dockerfile' | 'nixpacks' | 'slim' = 'nixpacks';

    try {
      // 2. Clone repository shallowly
      this.setBuildPhase(session, 'importing');
      log(`[${new Date().toISOString()}] 📦 Cloning repository into build workspace...\n`);
      try {
        await this.runProcess('git', [
          'clone',
          '--depth', '1',
          '--branch', options.branch,
          gitCloneUrl,
          buildDir,
        ], { timeoutMs: cloneTimeoutMs, onLog: (chunk) => log(chunk) });
      } catch {
        // Fallback: clone without --branch in case branch tag has different ref
        await this.runProcess('git', [
          'clone',
          '--depth', '1',
          gitCloneUrl,
          buildDir,
        ], { timeoutMs: cloneTimeoutMs, onLog: (chunk) => log(chunk) });
      }

      // Resolve monorepo target directory
      const appDir = cleanSubfolder && cleanSubfolder !== '.'
        ? path.join(buildDir, cleanSubfolder)
        : buildDir;

      if (!fs.existsSync(appDir)) {
        throw new BadRequestException(`Subfolder "${cleanSubfolder}" does not exist in repository ${options.repoName}`);
      }

      // Static sites (Next export → out/, Vite → dist/, CRA → build/) have no
      // server; inject a tiny static server and serve the built folder instead.
      const staticSite = this.isStaticSite(appDir);
      if (staticSite) {
        fs.writeFileSync(path.join(appDir, 'paas-static-server.js'), PAAS_STATIC_SERVER, 'utf8');
        log(`[${new Date().toISOString()}] 📄 Detected a static site — will serve the build output with a static server.\n`);
      }

      // 3. Inspect target directory for Dockerfile or Nixpacks
      let resolvedDockerfilePath: string | null = null;
      const customDf = options.dockerfilePath?.trim();

      if (customDf) {
        // User explicitly specified a Dockerfile path (e.g. 'Dockerfile.prod' or 'docker/Dockerfile.prod')
        if (fs.existsSync(path.join(appDir, customDf))) {
          resolvedDockerfilePath = path.join(appDir, customDf);
        } else if (fs.existsSync(path.join(buildDir, customDf))) {
          resolvedDockerfilePath = path.join(buildDir, customDf);
        } else {
          throw new BadRequestException(
            `Specified Dockerfile "${customDf}" was not found in ${cleanSubfolder || 'repository root'}`
          );
        }
      } else if (options.buildMethod !== 'railpack') {
        // Auto-detect standard Dockerfile variations
        const candidates = [
          path.join(appDir, 'Dockerfile'),
          path.join(appDir, 'dockerfile'),
          path.join(appDir, 'Dockerfile.prod'),
          path.join(appDir, 'Dockerfile.production'),
          path.join(buildDir, 'Dockerfile'),
          path.join(buildDir, 'dockerfile'),
          path.join(buildDir, 'Dockerfile.prod'),
          path.join(buildDir, 'Dockerfile.production'),
        ];
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            resolvedDockerfilePath = candidate;
            break;
          }
        }
      }

      this.setBuildPhase(session, 'building');

      // A stable per-service tag lets each build reuse the previous build's layers.
      // (Nixpacks' cache-key otherwise defaults to the current directory, which is
      // unique per run, so caches were never being reused across builds.)
      const cacheTag = `paas-app-${safeName}:latest`;
      let hasCacheImage = false;
      try {
        await this.runProcess('docker', ['image', 'inspect', cacheTag], { timeoutMs: 15000 });
        hasCacheImage = true;
      } catch {
        hasCacheImage = false;
      }

      const pkg = this.readPackageJson(appDir);
      const hasPrisma = !!(
        pkg?.dependencies?.prisma ||
        pkg?.devDependencies?.prisma ||
        pkg?.dependencies?.['@prisma/client'] ||
        pkg?.devDependencies?.['@prisma/client'] ||
        fs.existsSync(path.join(appDir, 'prisma', 'schema.prisma')) ||
        fs.existsSync(path.join(appDir, 'schema.prisma'))
      );

      let pkgModified = false;

      // If package.json build script has "prisma db push" or "prisma migrate deploy",
      // defer it to runtime container startup (since live DB is not connected during Docker image compilation).
      if (pkg?.scripts?.build && /\b(npx\s+)?prisma\s+(db\s+push|migrate\s+deploy)\b/.test(pkg.scripts.build)) {
        log(`[${new Date().toISOString()}] ℹ️ Deferring "prisma db push/migrate" from build step to container startup...\n`);
        pkg.scripts.build = pkg.scripts.build.replace(
          /\b(npx\s+)?prisma\s+(db\s+push|migrate\s+deploy)\b/g,
          'true /* deferred to container startup */',
        );
        pkgModified = true;
      }

      // Railpack-style entrypoint aliasing for NestJS / TypeScript projects:
      // When root-level TS files (such as prisma.config.ts) cause the TS compiler to output
      // dist/src/main.js instead of dist/main.js, ensure post-build flattens dist/src into dist/
      // so standard entrypoints like `node dist/main` succeed seamlessly.
      const nestFlattenCmd = '([ -d dist/src ] && [ ! -f dist/main.js ] && cp -r dist/src/* dist/ 2>/dev/null || true)';
      if (pkg?.scripts?.build && !pkg.scripts.build.includes('dist/src')) {
        pkg.scripts.build = `${pkg.scripts.build} && ${nestFlattenCmd}`;
        pkgModified = true;
      }

      // Also ensure any scripts calling `node dist/main` are resilient to either location:
      if (pkg?.scripts) {
        for (const [key, scriptVal] of Object.entries(pkg.scripts)) {
          if (typeof scriptVal === 'string' && /\bnode\s+dist\/main(\.js)?\b/.test(scriptVal)) {
            pkg.scripts[key] = scriptVal.replace(
              /\bnode\s+dist\/main(\.js)?\b/g,
              'node -e "const f=require(\'fs\'),p=f.existsSync(\'./dist/main.js\')?\'./dist/main\':f.existsSync(\'./dist/src/main.js\')?\'./dist/src/main\':\'./dist/main\';require(p)"',
            );
            pkgModified = true;
            log(`[${new Date().toISOString()}] ℹ️ Aliased "${key}" entrypoint to auto-resolve dist/src/main.js vs dist/main.js\n`);
          }
        }
      }

      if (pkgModified) {
        try {
          fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
        } catch {}
      }

      const runtimeEnv: Record<string, string> = { ...(options.env || {}) };
      if (hasPrisma || !options.nodeVersion || options.nodeVersion === '22' || options.nodeVersion === '20') {
        if (!runtimeEnv.NODE_OPTIONS) {
          runtimeEnv.NODE_OPTIONS = '--experimental-require-module';
        } else if (!runtimeEnv.NODE_OPTIONS.includes('--experimental-require-module')) {
          runtimeEnv.NODE_OPTIONS = `${runtimeEnv.NODE_OPTIONS} --experimental-require-module`;
        }
      }

      // Build-time compiler environment (used strictly during Docker image compilation).
      // Fallback DATABASE_URL satisfies build-time validation without being injected into container runtime.
      const buildEnv: Record<string, string> = { ...runtimeEnv };
      if (hasPrisma && !buildEnv.DATABASE_URL) {
        buildEnv.DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
      }

      // ── "Fast" preset: generate a slim Dockerfile (opt-in) ──────────────────
      const publicBuildEnv = this.getPublicBuildEnv(buildEnv);
      const slimDockerfile =
        options.buildMethod === 'slim'
          ? this.generateSlimDockerfile(appDir, { ...options, staticSite, buildEnv: publicBuildEnv })
          : null;

      if (slimDockerfile) {
        buildStrategy = 'slim';
        const slimDfPath = path.join(appDir, '.paas-fast.Dockerfile');
        fs.writeFileSync(slimDfPath, slimDockerfile, 'utf8');
        // Keep the build context small so the image builds fast.
        const diPath = path.join(appDir, '.dockerignore');
        if (!fs.existsSync(diPath)) {
          fs.writeFileSync(
            diPath,
            ['node_modules', '.git', 'dist', 'build', '.next', 'npm-debug.log*', '*.log', ''].join('\n'),
            'utf8',
          );
        }
        const dockerArgs = [
          'build',
          '-t', imageTag,
          '-t', cacheTag,
          '--build-arg', 'BUILDKIT_INLINE_CACHE=1',
        ];
        if (hasCacheImage) {
          dockerArgs.push('--cache-from', cacheTag);
        }
        for (const [k, v] of Object.entries(publicBuildEnv)) {
          dockerArgs.push('--build-arg', `${k}=${v}`);
        }
        dockerArgs.push('-f', slimDfPath, appDir);
        log(`[${new Date().toISOString()}] ⚡ Fast slim build engaged (no Nix toolchain)...\n`);
        await this.runProcess('docker', dockerArgs, {
          cwd: appDir,
          timeoutMs: buildTimeoutMs,
          onLog: (chunk) => log(chunk),
        });
      } else if (resolvedDockerfilePath && options.buildMethod !== 'railpack') {
        buildStrategy = 'dockerfile';
        log(`[${new Date().toISOString()}] 🐳 Building image with Dockerfile: ${path.basename(resolvedDockerfilePath)}...\n`);
        const dockerArgs = [
          'build',
          '-t', imageTag,
          '-t', cacheTag,
          '--build-arg', 'BUILDKIT_INLINE_CACHE=1',
        ];
        if (hasCacheImage) {
          dockerArgs.push('--cache-from', cacheTag);
        }
        dockerArgs.push('-f', resolvedDockerfilePath, buildDir);
        await this.runProcess('docker', dockerArgs, {
          cwd: buildDir,
          timeoutMs: buildTimeoutMs,
          onLog: (chunk) => log(chunk),
        });
      } else {
        buildStrategy = 'nixpacks';
        if (options.buildMethod === 'slim') {
          log(`[${new Date().toISOString()}] ℹ️ Fast preset unavailable for this project type — falling back to Nixpacks.\n`);
        }
        log(`[${new Date().toISOString()}] ❄️ Building image with Nixpacks auto-compiler...\n`);
        const nixArgs = [
          'build',
          appDir,
          '--name', imageTag,
          '-t', cacheTag,
          // Key the build cache by the service (stable) instead of the temp dir.
          '--cache-key', subName,
          '--inline-cache',
        ];
        if (hasCacheImage) {
          nixArgs.push('--cache-from', cacheTag);
        }
        // Default to modern Node 22 (LTS) so modern frameworks and packages (e.g. Prisma 7+,
        // Next.js 16+, NestJS) which require Node >=20.19 or >=22 build smoothly.
        let nodeVersion = options.nodeVersion || this.getRepoNodeVersion(appDir) || '22';
        if (nodeVersion === '20' || nodeVersion === '20.18') {
          if (hasPrisma) {
            nodeVersion = '22';
          }
        }
        nixArgs.push('--env', `NIXPACKS_NODE_VERSION=${nodeVersion}`);

        let defaultInstallCmd = 'npm install --legacy-peer-deps || npm ci';
        if (hasPrisma) {
          // Prisma 7+ enforces strict Node version >=20.19 or >=22.12 via scripts/preinstall-entry.js.
          // Nixpacks packages Node 22 as 22.11.0, which causes the preinstall gatekeeper to abort.
          // Passing --ignore-scripts skips this artificial blocker, and we then explicitly generate Prisma Client.
          defaultInstallCmd =
            'npm install --legacy-peer-deps --ignore-scripts && (npm rebuild || true) && (NODE_OPTIONS="--experimental-require-module" npx prisma generate || ./node_modules/.bin/prisma generate || true)';
        }

        let installCmd = options.installCommand?.trim();
        if (
          !installCmd ||
          (hasPrisma &&
            (installCmd === 'npm install --legacy-peer-deps || npm ci' ||
              installCmd === 'npm install' ||
              installCmd === 'npm ci'))
        ) {
          installCmd = defaultInstallCmd;
        }
        nixArgs.push('--install-cmd', installCmd);

        // In Node 22.11.0 (packaged by Nixpacks LTS Nixpkgs snapshot), synchronous require()
        // of ES Modules (used by Prisma 7 state.cjs requiring zeptomatch) requires
        // --experimental-require-module to avoid ERR_REQUIRE_ESM.
        let effectiveBuild = options.buildCommand;
        if (effectiveBuild && /\b(npx\s+)?prisma\s+(db\s+push|migrate\s+deploy)\b/.test(effectiveBuild)) {
          effectiveBuild = effectiveBuild.replace(
            /\b(npx\s+)?prisma\s+(db\s+push|migrate\s+deploy)\b/g,
            'true /* deferred to container startup */',
          );
        }
        if (!effectiveBuild && hasPrisma) {
          effectiveBuild = 'NODE_OPTIONS="--experimental-require-module" npm run build';
        }
        if (effectiveBuild) {
          if (!effectiveBuild.includes('dist/src')) {
            effectiveBuild = `${effectiveBuild} && ([ -d dist/src ] && [ ! -f dist/main.js ] && cp -r dist/src/* dist/ 2>/dev/null || true)`;
          }
          nixArgs.push('--build-cmd', effectiveBuild);
        }

        let effectiveStart = options.startCommand;
        if (!effectiveStart) {
          if (staticSite) {
            // Static site → serve the built folder.
            effectiveStart = 'node /app/paas-static-server.js';
          } else {
            // Prefer an explicit production start (e.g. NestJS `start:prod`).
            if (pkg?.scripts?.['start:prod']) {
              effectiveStart = 'npm run start:prod';
            }
          }
        }
        if (effectiveStart) {
          if (/\bnode\s+dist\/main(\.js)?\b/.test(effectiveStart)) {
            effectiveStart = effectiveStart.replace(
              /\bnode\s+dist\/main(\.js)?\b/g,
              'node -e "const f=require(\'fs\'),p=f.existsSync(\'./dist/main.js\')?\'./dist/main\':f.existsSync(\'./dist/src/main.js\')?\'./dist/src/main\':\'./dist/main\';require(p)"',
            );
          }
          nixArgs.push('--start-cmd', effectiveStart);
        }

        for (const [k, v] of Object.entries(buildEnv)) {
          nixArgs.push('--env', `${k}=${v}`);
        }
        await this.runProcess('nixpacks', nixArgs, {
          cwd: appDir,
          timeoutMs: buildTimeoutMs,
          onLog: (chunk) => log(chunk),
        });
      }

      // Ensure the newly built image is tagged under both short and fully-qualified names
      // so Docker Engine / containerd resolves it under either identifier:
      try {
        await this.runProcess('docker', ['tag', `docker.io/library/${imageTag}`, imageTag], { timeoutMs: 5000 });
      } catch {
        try {
          await this.runProcess('docker', ['tag', imageTag, `docker.io/library/${imageTag}`], { timeoutMs: 5000 });
        } catch {}
      }

      log(`[${new Date().toISOString()}] ✨ Image compilation successful (${imageTag}). Launching service container...\n`);

      this.setBuildPhase(session, 'deploying');

      // 4. Deploy service container using the newly built image
      // When redeploying an existing service we reuse its id so the canvas node,
      // open drawer and live log streams keep pointing at the same service entity.
      // A `deploying-*` placeholder id is never a real service id, so ignore it.
      const reusableServiceId =
        options.serviceId && !options.serviceId.startsWith('deploying-') ? options.serviceId : undefined;
      const service = await this.servicesService.deployService({
        id: reusableServiceId,
        name: subName,
        image: imageTag,
        port: options.port || 3000,
        gitRepo: options.cloneUrl,
        gitBranch: options.branch,
        subfolder: cleanSubfolder || undefined,
        dockerfilePath: options.dockerfilePath || (resolvedDockerfilePath ? path.relative(buildDir, resolvedDockerfilePath) : undefined),
        buildMethod:
          options.buildMethod ||
          (buildStrategy === 'slim' ? 'slim' : buildStrategy === 'dockerfile' ? 'dockerfile' : 'auto'),
        runtimeMode: options.runtimeMode || 'web',
        installCommand: options.installCommand,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
        systemPackages: options.systemPackages,
        nodeVersion: options.nodeVersion,
        env: runtimeEnv,
      });

      session.ids.add(service.id);
      session.status = 'success';
      session.phase = 'running';
      log(`[${new Date().toISOString()}] 🎉 Service "${service.name}" successfully deployed and healthy on port ${service.port || 3000}!\n`);

      // Mark the run successful and re-key the timeline from the temporary node
      // id to the real service id so history is consistent after resolution.
      this.updateDeployEntry(primaryId, runId, {
        status: 'success',
        phase: 'running',
        logsCount: session.logs.length,
        imageTag,
      });
      this.moveDeployHistory(primaryId, service.id);

      // Keep only the new build image + the reusable :latest cache tag; drop the
      // previous build's image so repeated deploys don't accumulate ~900MB each.
      await this.cleanupOldBuildImages(safeName, new Set([imageTag, `paas-app-${safeName}:latest`]));

      return {
        service,
        git: {
          repoName: options.repoName,
          branch: options.branch,
          cloneUrl: options.cloneUrl,
          subfolder: cleanSubfolder || undefined,
          buildStrategy,
          imageTag,
          lastDeployedAt: new Date().toISOString(),
        },
      };
    } catch (err: any) {
      session.status = 'failed';
      session.phase = 'failed';
      const cleanMsg = (err.message || 'Build failed').replace(/x-access-token:[^@]+@/g, '');
      log(`[${new Date().toISOString()}] ❌ Deployment failed: ${cleanMsg}\n`);
      console.error(`[BuildEngine] Deployment failed for ${options.repoName}:`, err.message);
      this.updateDeployEntry(primaryId, runId, {
        status: 'failed',
        phase: 'failed',
        logsCount: session.logs.length,
        errorMessage: cleanMsg,
      });
      throw new BadRequestException(`Deployment failed: ${cleanMsg}`);
    } finally {
      // 5. Clean up temporary checkout workspace
      try {
        await fs.promises.rm(buildDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure
      }
    }
  }

  async redeployService(
    serviceId: string,
    overrides?: {
      repoName?: string;
      branch?: string;
      cloneUrl?: string;
      dockerfilePath?: string;
      buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
      runtimeMode?: 'web' | 'worker';
      subfolder?: string;
      port?: number;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
      systemPackages?: string;
      nodeVersion?: string;
      env?: Record<string, string>;
    }
  ): Promise<{ service: ServiceRecord; git: any }> {
    let existing: ServiceRecord | undefined;
    try {
      existing = await this.servicesService.getService(serviceId);
    } catch {
      // If service is not registered in Docker yet (e.g. temporary canvas node or failed build), handle gracefully
    }

    let repoUrl = overrides?.cloneUrl || existing?.gitRepo || existing?.env?.GIT_REPO;
    if (repoUrl && !repoUrl.startsWith('http://') && !repoUrl.startsWith('https://') && !repoUrl.startsWith('git@')) {
      if (repoUrl.includes('/')) {
        repoUrl = `https://github.com/${repoUrl}.git`;
      } else if (this.cachedUser?.login) {
        repoUrl = `https://github.com/${this.cachedUser.login}/${repoUrl}.git`;
      } else {
        repoUrl = `https://github.com/blockchainbard/${repoUrl}.git`;
      }
    }
    if (!repoUrl) {
      throw new BadRequestException(`Service "${serviceId}" is not associated with a valid Git repository URL.`);
    }

    const branch = overrides?.branch || existing?.gitBranch || existing?.env?.GIT_BRANCH || 'main';
    const subfolder = overrides?.subfolder !== undefined ? overrides.subfolder : existing?.subfolder;
    const dockerfilePath = overrides?.dockerfilePath !== undefined ? overrides.dockerfilePath : existing?.dockerfilePath;
    const buildMethod = overrides?.buildMethod !== undefined ? overrides.buildMethod : existing?.buildMethod;
    const runtimeMode = overrides?.runtimeMode !== undefined ? overrides.runtimeMode : existing?.runtimeMode;
    const port = overrides?.port !== undefined ? overrides.port : existing?.port || 3000;
    const installCommand = overrides?.installCommand !== undefined ? overrides.installCommand : existing?.installCommand;
    const buildCommand = overrides?.buildCommand !== undefined ? overrides.buildCommand : existing?.buildCommand;
    const startCommand = overrides?.startCommand !== undefined ? overrides.startCommand : existing?.startCommand;
    const systemPackages = overrides?.systemPackages !== undefined ? overrides.systemPackages : existing?.systemPackages;
    const nodeVersion = overrides?.nodeVersion !== undefined ? overrides.nodeVersion : existing?.nodeVersion;

    // Parse repoName from url
    const parts = repoUrl.replace(/\.git$/, '').split('/');
    const repoName = overrides?.repoName || parts[parts.length - 1] || existing?.name || 'app';

    console.log(`[BuildEngine] Redeploying service ${repoName} (${serviceId}) with dockerfilePath: ${dockerfilePath || 'auto'}...`);

    // Build the new image and deploy in place. `deployFromGitHub` reuses the
    // provided serviceId, and `deployService` atomically stops & removes the
    // previous container sharing the same name before starting the new one.
    // This keeps zero downtime during the build and avoids destroying the
    // service record (and its live log stream) on failure.
    const result = await this.deployFromGitHub({
      serviceId,
      tempId: serviceId,
      repoName,
      branch,
      cloneUrl: repoUrl,
      subfolder,
      dockerfilePath,
      buildMethod,
      runtimeMode,
      installCommand,
      buildCommand,
      startCommand,
      systemPackages,
      nodeVersion,
      port,
      env: overrides?.env !== undefined ? overrides.env : (existing?.env || {}),
    });

    return result;
  }

  async handleWebhook(event: string, payload: any, signature?: string) {
    if (this.webhookSecret && signature) {
      const payloadStr = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const isValid = this.verifyWebhookSignature(payloadStr, signature);
      if (!isValid) {
        throw new BadRequestException('Invalid webhook signature');
      }
    }

    if (event === 'ping') {
      return { msg: 'pong', zen: payload?.zen };
    }

    if (event === 'push') {
      const repoFullName = payload?.repository?.full_name;
      const ref = payload?.ref; // e.g. "refs/heads/main"
      const branch = ref ? ref.replace('refs/heads/', '') : 'main';
      console.log(`[GitHub Webhook] Push event for ${repoFullName} (${branch})`);

      const services = await this.servicesService.listServices();
      const redeployed: string[] = [];

      for (const svc of services) {
        const svcRepo = svc.gitRepo || svc.env?.GIT_REPO;
        const svcBranch = svc.gitBranch || svc.env?.GIT_BRANCH;

        if (
          svcRepo &&
          (svcRepo.includes(repoFullName) || svcRepo.toLowerCase() === payload?.repository?.clone_url?.toLowerCase()) &&
          (!svcBranch || svcBranch === branch)
        ) {
          console.log(`[GitHub Webhook] Triggering auto-redeploy for matching service ${svc.name} (${svc.id})...`);
          redeployed.push(svc.name);
          // Launch build & deployment asynchronously so GitHub webhook receives immediate 200 OK without timing out
          this.redeployService(svc.id).catch((err: any) => {
            console.error(`[GitHub Webhook] Failed to auto-redeploy service ${svc.name}:`, err.message);
          });
        }
      }

      return {
        received: true,
        event,
        repo: repoFullName,
        branch,
        redeployedServices: redeployed,
      };
    }

    return { received: true, event };
  }

  verifyWebhookSignature(payload: string, signature: string | undefined): boolean {
    if (!signature || !this.webhookSecret) return true;
    try {
      const hmac = crypto.createHmac('sha256', this.webhookSecret);
      hmac.update(payload);
      const digest = `sha256=${hmac.digest('hex')}`;
      return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
    } catch {
      return false;
    }
  }
}
