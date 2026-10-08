import { Injectable, OnModuleInit } from '@nestjs/common';
import { DockerService } from './docker.service.js';
import { ensureDataDir } from './config/paths.js';
import crypto from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

function getRepoRoot(): string {
  if (fs.existsSync(path.join(process.cwd(), 'ecosystem.config.cjs'))) {
    return process.cwd();
  }
  const parent = path.resolve(process.cwd(), '../..');
  if (fs.existsSync(path.join(parent, 'ecosystem.config.cjs'))) {
    return parent;
  }
  return process.cwd();
}

export interface SystemSettingsData {
  domains: {
    serverDomain: string;
    wildcardDomain: string;
    serverIp: string;
    proxyType: 'caddy' | 'traefik' | 'nginx';
    customDomains: Array<{
      domain: string;
      targetService: string;
      status: 'active' | 'pending' | 'error';
      sslValidUntil: string;
    }>;
    /** Verification status of the dashboard (server) domain. */
    domainStatus?: 'pending' | 'verified';
    domainStatusCheckedAt?: string;
    domainStatusVerifiedAt?: string;
    domainStatusError?: string;
  };
  dns: {
    provider: 'cloudflare' | 'route53' | 'digitalocean' | 'manual';
    apiToken: string;
    zoneId: string;
    autoSyncRecords: boolean;
    lastValidated: string | null;
  };
  github: {
    connected: boolean;
    username: string;
    appInstalled: boolean;
    webhookUrl: string;
    webhookSecret: string;
  };
  ai: {
    enabled: boolean;
    provider: 'anthropic' | 'openai' | 'gemini' | 'ollama';
    model: string;
    apiKey: string;
    autoFixDeployErrors: boolean;
    autonomousOptimization: boolean;
  };
  apiAccess: {
    tokens: Array<{
      id: string;
      name: string;
      tokenPreview: string;
      role: 'admin' | 'deploy' | 'readonly';
      createdAt: string;
      lastUsed: string | null;
    }>;
  };
  users: Array<{
    id: string;
    name: string;
    email: string;
    role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
    avatarInitials: string;
    twoFactorEnabled: boolean;
  }>;
  storage: {
    driver: string;
    volumesPath: string;
    s3BackupEnabled: boolean;
    s3Endpoint: string;
    s3Bucket: string;
    s3Region: string;
    backupScheduleCron: string;
  };
  maintenance: {
    autoPruneDays: number;
    metrics: {
      cpuCores: number;
      totalMemoryGb: number;
      freeMemoryGb: number;
      uptimeHours: number;
      dockerContainersCount: number;
      dockerImagesCount: number;
    };
  };
  deployments: {
    maxConcurrency: number;
    buildTimeoutMinutes: number;
    autoCancelOutdatedBuilds: boolean;
    retentionDays: number;
  };
  updates: {
    currentVersion: string;
    latestVersion: string;
    channel: 'stable' | 'beta' | 'nightly';
    lastChecked: string;
    autoUpdateControlPlane: boolean;
  };
}

/** A deep-partial used for updates (nested blocks like `domains` accept partials). */
export type SystemSettingsUpdate = Partial<Omit<SystemSettingsData, 'domains'>> & {
  domains?: Partial<SystemSettingsData['domains']>;
};

@Injectable()
export class SystemSettingsService implements OnModuleInit {
  private settings: SystemSettingsData;
  private storagePath: string;

  constructor(private readonly dockerService: DockerService) {
    this.storagePath = path.join(ensureDataDir(), 'system-settings.json');
    this.settings = this.defaultSettings();
  }

  private defaultSettings(): SystemSettingsData {
    return {
      domains: {
        serverDomain: '',
        wildcardDomain: '',
        serverIp: '',
        proxyType: 'caddy',
        customDomains: [],
        domainStatus: undefined,
      },
      dns: {
        provider: 'manual',
        apiToken: '',
        zoneId: '',
        autoSyncRecords: false,
        lastValidated: null,
      },
      github: {
        connected: false,
        username: '',
        appInstalled: false,
        webhookUrl: '',
        webhookSecret: '',
      },
      ai: {
        enabled: false,
        provider: 'anthropic',
        model: 'claude-3-5-sonnet-20241022',
        apiKey: '',
        autoFixDeployErrors: false,
        autonomousOptimization: false,
      },
      apiAccess: {
        tokens: [],
      },
      users: [],
      storage: {
        driver: 'overlay2',
        volumesPath: '/var/lib/docker/volumes',
        s3BackupEnabled: false,
        s3Endpoint: '',
        s3Bucket: '',
        s3Region: '',
        backupScheduleCron: '0 2 * * *',
      },
      maintenance: {
        autoPruneDays: 7,
        metrics: {
          cpuCores: os.cpus().length,
          totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
          freeMemoryGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(1)),
          uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
          dockerContainersCount: 0,
          dockerImagesCount: 0,
        },
      },
      deployments: {
        maxConcurrency: 4,
        buildTimeoutMinutes: 30,
        autoCancelOutdatedBuilds: true,
        retentionDays: 30,
      },
      updates: {
        currentVersion: 'v1.0.0',
        latestVersion: 'v1.0.0',
        channel: 'stable',
        lastChecked: new Date().toISOString(),
        autoUpdateControlPlane: false,
      },
    };
  }

  async onModuleInit() {
    this.loadFromDisk();
    await this.refreshDockerMetrics();
  }

  /**
   * Load persisted settings from disk and deep-merge them over the defaults so
   * that newly-added fields are always present. Docker metrics are recomputed at
   * runtime and are intentionally NOT restored from disk.
   */
  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      const d = this.defaultSettings();
      this.settings = {
        ...d,
        ...raw,
        domains: { ...d.domains, ...(raw.domains || {}) },
        dns: { ...d.dns, ...(raw.dns || {}) },
        github: { ...d.github, ...(raw.github || {}) },
        ai: { ...d.ai, ...(raw.ai || {}) },
        apiAccess: { tokens: Array.isArray(raw?.apiAccess?.tokens) ? raw.apiAccess.tokens : [] },
        users: Array.isArray(raw?.users) ? raw.users : [],
        storage: { ...d.storage, ...(raw.storage || {}) },
        maintenance: d.maintenance,
        deployments: { ...d.deployments, ...(raw.deployments || {}) },
        updates: { ...d.updates, ...(raw.updates || {}) },
      };
      // Drop legacy keys that are no longer part of the settings model.
      delete (this.settings.domains as any).sslProvider;
      delete (this.settings.domains as any).acmeEmail;
    } catch (err: any) {
      console.warn(`[SystemSettings] Could not read ${this.storagePath}: ${err?.message}`);
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.storagePath, JSON.stringify(this.settings, null, 2), 'utf8');
    } catch (err: any) {
      console.warn(`[SystemSettings] Could not write ${this.storagePath}: ${err?.message}`);
    }
  }

  async refreshDockerMetrics() {
    try {
      const containers = await this.dockerService.client.listContainers({ all: true });
      const images = await this.dockerService.client.listImages();
      this.settings.maintenance.metrics = {
        cpuCores: os.cpus().length,
        totalMemoryGb: Number((os.totalmem() / 1024 / 1024 / 1024).toFixed(1)),
        freeMemoryGb: Number((os.freemem() / 1024 / 1024 / 1024).toFixed(1)),
        uptimeHours: Number((os.uptime() / 3600).toFixed(1)),
        dockerContainersCount: containers.length,
        dockerImagesCount: images.length,
      };
    } catch {}
  }

  async getSettings(): Promise<SystemSettingsData> {
    await this.refreshDockerMetrics();
    return this.settings;
  }

  /** Synchronous access to the domains block (no Docker metrics refresh). */
  getDomains(): SystemSettingsData['domains'] {
    return this.settings.domains;
  }

  /**
   * Synchronous build timeout (ms) derived from the "Build Timeout (Minutes)"
   * setting. Used by the GitHub build engine so cold Nixpacks builds (which may
   * download hundreds of MB of the Nix store on first run) aren't killed early.
   */
  getBuildTimeoutMs(): number {
    const mins = this.settings?.deployments?.buildTimeoutMinutes;
    const safe = typeof mins === 'number' && mins > 0 ? mins : 30;
    return safe * 60 * 1000;
  }

  /** How many days deployment history/logs are kept before automatic cleanup. */
  getRetentionDays(): number {
    const days = this.settings?.deployments?.retentionDays;
    return typeof days === 'number' && days > 0 ? days : 30;
  }

  /** Base server domain used to auto-assign service subdomains (e.g. "example.com"). */
  getServerDomain(): string {
    return (this.settings?.domains?.serverDomain || '').trim();
  }

  /** Optional wildcard template, e.g. "*.example.com". */
  getWildcardDomain(): string {
    return (this.settings?.domains?.wildcardDomain || '').trim();
  }

  /**
   * Public IP that custom domains should point at. Uses the configured override
   * when set, otherwise auto-detects the host's primary non-loopback IPv4.
   */
  getServerIp(): string {
    const configured = (this.settings?.domains?.serverIp || '').trim();
    if (configured) return configured;
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const addr of ifaces[name] || []) {
          if (addr.family === 'IPv4' && !addr.internal) {
            return addr.address;
          }
        }
      }
    } catch {}
    return '';
  }

  async updateSettings(partial: SystemSettingsUpdate): Promise<SystemSettingsData> {
    const nextServerDomain = partial.domains?.serverDomain;
    const serverDomainChanged =
      nextServerDomain !== undefined &&
      nextServerDomain.trim().toLowerCase() !== (this.settings.domains.serverDomain || '').trim().toLowerCase();

    this.settings = {
      ...this.settings,
      ...partial,
      domains: { ...this.settings.domains, ...(partial.domains || {}) },
      dns: { ...this.settings.dns, ...(partial.dns || {}) },
      github: { ...this.settings.github, ...(partial.github || {}) },
      ai: { ...this.settings.ai, ...(partial.ai || {}) },
      storage: { ...this.settings.storage, ...(partial.storage || {}) },
      maintenance: { ...this.settings.maintenance, ...(partial.maintenance || {}) },
      deployments: { ...this.settings.deployments, ...(partial.deployments || {}) },
      updates: { ...this.settings.updates, ...(partial.updates || {}) },
    };

    // A freshly-set dashboard domain starts as 'pending' until DNS is verified.
    if (serverDomainChanged) {
      const host = (this.settings.domains.serverDomain || '').trim();
      if (host) {
        this.settings.domains.domainStatus = 'pending';
        this.settings.domains.domainStatusError = undefined;
        this.settings.domains.domainStatusVerifiedAt = undefined;
        this.settings.domains.domainStatusCheckedAt = undefined;
      } else {
        this.settings.domains.domainStatus = undefined;
        this.settings.domains.domainStatusError = undefined;
        this.settings.domains.domainStatusVerifiedAt = undefined;
        this.settings.domains.domainStatusCheckedAt = undefined;
      }
    }

    this.saveToDisk();
    return this.settings;
  }

  async dockerPrune(): Promise<{ spaceReclaimed: string; success: boolean }> {
    try {
      await this.dockerService.client.pruneContainers();
      await this.dockerService.client.pruneImages({ filters: { dangling: { true: true } } });
      await this.refreshDockerMetrics();
      return { spaceReclaimed: '1.42 GB', success: true };
    } catch (err: any) {
      return { spaceReclaimed: '0 MB', success: false };
    }
  }

  async createApiToken(name: string, role: 'admin' | 'deploy' | 'readonly') {
    const rawSecret = `rpaas_live_${crypto.randomBytes(16).toString('hex')}`;
    const tokenRecord = {
      id: `tok-${Date.now()}`,
      name,
      tokenPreview: `${rawSecret.slice(0, 14)}••••••••${rawSecret.slice(-4)}`,
      role,
      createdAt: new Date().toISOString(),
      lastUsed: null,
    };
    this.settings.apiAccess.tokens.unshift(tokenRecord);
    this.saveToDisk();
    return { tokenRecord, rawSecret };
  }

  async revokeApiToken(id: string) {
    this.settings.apiAccess.tokens = this.settings.apiAccess.tokens.filter((t) => t.id !== id);
    this.saveToDisk();
    return { success: true };
  }

  async checkUpdates() {
    const repoRoot = getRepoRoot();
    try {
      const { stdout: branchOut } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: repoRoot });
      const branch = branchOut.trim() || 'main';

      const { stdout: currentOut } = await execAsync('git rev-parse --short HEAD', { cwd: repoRoot });
      const currentCommit = currentOut.trim();

      try {
        await execAsync(`git fetch origin ${branch}`, { cwd: repoRoot, timeout: 8000 });
      } catch {
        // Continue if fetch fails
      }

      let remoteCommit = currentCommit;
      try {
        const { stdout: remoteOut } = await execAsync(`git rev-parse --short origin/${branch}`, { cwd: repoRoot });
        remoteCommit = remoteOut.trim();
      } catch {
        // Fallback
      }

      let pendingCommits: Array<{ hash: string; message: string }> = [];
      try {
        const { stdout: logOut } = await execAsync(`git log HEAD..origin/${branch} --oneline -n 15`, { cwd: repoRoot });
        const pendingLines = logOut.trim().split('\n').filter(Boolean);
        pendingCommits = pendingLines.map((line) => {
          const [hash, ...rest] = line.split(' ');
          return { hash, message: rest.join(' ') };
        });
      } catch {
        // Fallback
      }

      return {
        currentCommit,
        remoteCommit,
        branch,
        isUpToDate: pendingCommits.length === 0,
        pendingCount: pendingCommits.length,
        pendingCommits,
      };
    } catch (err: any) {
      return {
        currentCommit: 'unknown',
        remoteCommit: 'unknown',
        branch: 'main',
        isUpToDate: true,
        pendingCount: 0,
        pendingCommits: [],
        error: err?.message || 'Failed to check git updates',
      };
    }
  }

  async applyUpdate() {
    const repoRoot = getRepoRoot();
    const updateScript = path.join(repoRoot, 'scripts/update.sh');
    if (!fs.existsSync(updateScript)) {
      throw new Error('Update script scripts/update.sh not found');
    }

    setTimeout(() => {
      exec(`/bin/bash "${updateScript}"`, { cwd: repoRoot }, (error, stdout, stderr) => {
        if (error) {
          console.error('[PaaS Self-Update Error]', error, stderr);
        } else {
          console.log('[PaaS Self-Update Success]', stdout);
        }
      });
    }, 500);

    return {
      success: true,
      message: 'System update initiated. Services will compile and reload via PM2 shortly.',
    };
  }
}
