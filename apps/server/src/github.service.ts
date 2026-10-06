import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ServicesService, ServiceRecord } from './services.service.js';
import { SystemSettingsService } from './system-settings.service.js';
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
  }[] = [];

  public createBuildSession(identifiers: string[], repoName: string, branch: string) {
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
    };
    this.buildSessions.unshift(session);
    return session;
  }

  public findBuildSession(id: string) {
    if (!id) return undefined;
    const lower = id.toLowerCase();
    return this.buildSessions.find(
      (s) => s.ids.has(id) || s.ids.has(lower) || s.repoName.toLowerCase() === lower || s.repoName.toLowerCase().includes(lower)
    );
  }

  public appendBuildLog(session: { logs: string[]; listeners: Set<(chunk: string) => void> }, text: string) {
    const clean = text.replace(/x-access-token:[^@]+@/g, '');
    session.logs.push(clean);
    session.listeners.forEach((listener) => {
      try {
        listener(clean);
      } catch {}
    });
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
      let attempts = 0;
      const maxAttempts = 30; // 30 * 300ms = 9 seconds grace period for build session registration

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
          onData(`[BuildEngine] No active build logs found for "${id}". If container is running, switch to Container Logs.\n`);
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

  public getBuildLogs(id: string): { logs: string[]; status: string } {
    const session = this.findBuildSession(id);
    if (!session) {
      return { logs: [], status: 'not_found' };
    }
    return { logs: session.logs, status: session.status };
  }

  constructor(
    private readonly servicesService: ServicesService,
    private readonly systemSettingsService: SystemSettingsService,
  ) {
    const baseDir = process.env.DATA_DIR || path.join(process.cwd(), 'data');
    if (!fs.existsSync(baseDir)) {
      try {
        fs.mkdirSync(baseDir, { recursive: true });
      } catch (err) {
        console.warn('[GitHubService] Could not create data dir:', err);
      }
    }
    this.storagePath = path.join(baseDir, 'github-config.json');
    this.loadConfig();
  }

  async onModuleInit() {
    // If token exists, verify and sync status
    if (this.activeToken) {
      await this.getStatus().catch(() => {});
    }
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
      )}&scope=repo,read:user,user:email,read:org&redirect_uri=${encodeURIComponent(this.getOAuthCallbackUrl())}`,
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
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(
      this.clientId
    )}&scope=repo,read:user,user:email,read:org&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${state}`;

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
      if (options.timeoutMs) {
        timer = setTimeout(() => {
          child.kill('SIGTERM');
          reject(new Error(`Command "${cmd}" timed out after ${options.timeoutMs}ms`));
        }, options.timeoutMs);
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

  async deployFromGitHub(options: {
    tempId?: string;
    serviceId?: string;
    repoName: string;
    branch: string;
    cloneUrl: string;
    subfolder?: string;
    dockerfilePath?: string;
    buildMethod?: 'auto' | 'railpack' | 'dockerfile';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    port?: number;
    env?: Record<string, string>;
  }) {
    const safeName = options.repoName.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const buildId = crypto.randomBytes(4).toString('hex');
    const imageTag = `paas-app-${safeName}:${buildId}`;
    const buildsBaseDir = path.join(process.cwd(), 'data', 'builds');
    const buildDir = path.join(buildsBaseDir, `${safeName}-${buildId}`);

    const cleanSubfolder = (options.subfolder || '').trim().replace(/^\/+|\/+$/g, '');
    const subName = cleanSubfolder && cleanSubfolder !== '.'
      ? `${safeName}-${path.basename(cleanSubfolder)}`
      : safeName;

    const session = this.createBuildSession(
      [options.tempId || '', options.serviceId || '', safeName, subName, buildId],
      options.repoName,
      options.branch,
    );

    const log = (msg: string) => this.appendBuildLog(session, msg);

    await fs.promises.mkdir(buildsBaseDir, { recursive: true });

    log(`[${new Date().toISOString()}] 🚀 Starting build & deploy for ${options.repoName} (branch: ${options.branch}, subfolder: ${options.subfolder || 'root'})...\n`);

    // 1. Prepare authenticated clone URL if private
    let gitCloneUrl = options.cloneUrl;
    if (this.activeToken && gitCloneUrl.startsWith('https://github.com/')) {
      gitCloneUrl = gitCloneUrl.replace('https://github.com/', `https://x-access-token:${this.activeToken}@github.com/`);
    }

    let buildStrategy: 'dockerfile' | 'nixpacks' = 'nixpacks';

    try {
      // 2. Clone repository shallowly
      log(`[${new Date().toISOString()}] 📦 Cloning repository into build workspace...\n`);
      try {
        await this.runProcess('git', [
          'clone',
          '--depth', '1',
          '--branch', options.branch,
          gitCloneUrl,
          buildDir,
        ], { timeoutMs: 120000, onLog: (chunk) => log(chunk) });
      } catch {
        // Fallback: clone without --branch in case branch tag has different ref
        await this.runProcess('git', [
          'clone',
          '--depth', '1',
          gitCloneUrl,
          buildDir,
        ], { timeoutMs: 120000, onLog: (chunk) => log(chunk) });
      }

      // Resolve monorepo target directory
      const appDir = cleanSubfolder && cleanSubfolder !== '.'
        ? path.join(buildDir, cleanSubfolder)
        : buildDir;

      if (!fs.existsSync(appDir)) {
        throw new BadRequestException(`Subfolder "${cleanSubfolder}" does not exist in repository ${options.repoName}`);
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

      if (resolvedDockerfilePath && options.buildMethod !== 'railpack') {
        buildStrategy = 'dockerfile';
        log(`[${new Date().toISOString()}] 🐳 Building image with Dockerfile: ${path.basename(resolvedDockerfilePath)}...\n`);
        await this.runProcess('docker', ['build', '-t', imageTag, '-f', resolvedDockerfilePath, buildDir], {
          cwd: buildDir,
          timeoutMs: 400000,
          onLog: (chunk) => log(chunk),
        });
      } else {
        buildStrategy = 'nixpacks';
        log(`[${new Date().toISOString()}] ❄️ Building image with Nixpacks auto-compiler...\n`);
        const nixArgs = ['build', appDir, '--name', imageTag];
        nixArgs.push('--install-cmd', options.installCommand || 'npm install --legacy-peer-deps || npm ci');
        if (options.buildCommand) {
          nixArgs.push('--build-cmd', options.buildCommand);
        }
        if (options.startCommand) {
          nixArgs.push('--start-cmd', options.startCommand);
        }
        if (options.env) {
          for (const [k, v] of Object.entries(options.env)) {
            nixArgs.push('--env', `${k}=${v}`);
          }
        }
        await this.runProcess('nixpacks', nixArgs, {
          cwd: appDir,
          timeoutMs: 400000,
          onLog: (chunk) => log(chunk),
        });
      }

      log(`[${new Date().toISOString()}] ✨ Image compilation successful (${imageTag}). Launching service container...\n`);

      // 4. Deploy service container using the newly built image
      const service = await this.servicesService.deployService({
        name: subName,
        image: imageTag,
        port: options.port || 3000,
        gitRepo: options.cloneUrl,
        gitBranch: options.branch,
        subfolder: cleanSubfolder || undefined,
        dockerfilePath: options.dockerfilePath || (resolvedDockerfilePath ? path.relative(buildDir, resolvedDockerfilePath) : undefined),
        buildMethod: options.buildMethod || (buildStrategy === 'dockerfile' ? 'dockerfile' : 'auto'),
        runtimeMode: options.runtimeMode || 'web',
        installCommand: options.installCommand,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
        env: options.env || {},
      });

      session.ids.add(service.id);
      session.status = 'success';
      log(`[${new Date().toISOString()}] 🎉 Service "${service.name}" successfully deployed and healthy on port ${service.port || 3000}!\n`);

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
      const cleanMsg = (err.message || 'Build failed').replace(/x-access-token:[^@]+@/g, '');
      log(`[${new Date().toISOString()}] ❌ Deployment failed: ${cleanMsg}\n`);
      console.error(`[BuildEngine] Deployment failed for ${options.repoName}:`, err.message);
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
      buildMethod?: 'auto' | 'railpack' | 'dockerfile';
      runtimeMode?: 'web' | 'worker';
      subfolder?: string;
      port?: number;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
    }
  ): Promise<{ service: ServiceRecord; git: any }> {
    let existing: ServiceRecord | undefined;
    try {
      existing = await this.servicesService.getService(serviceId);
    } catch {
      // If service is not registered in Docker yet (e.g. temporary canvas node or failed build), handle gracefully
    }

    const repoUrl = overrides?.cloneUrl || existing?.gitRepo || existing?.env?.GIT_REPO;
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

    // Parse repoName from url
    const parts = repoUrl.replace(/\.git$/, '').split('/');
    const repoName = overrides?.repoName || parts[parts.length - 1] || existing?.name || 'app';

    console.log(`[BuildEngine] Redeploying service ${repoName} (${serviceId}) with dockerfilePath: ${dockerfilePath || 'auto'}...`);

    // Deploy new container
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
      port,
      env: existing?.env || {},
    });

    // Remove old container if it exists
    if (existing?.containerId) {
      try {
        await this.servicesService.deleteService(serviceId);
      } catch (e: any) {
        console.warn(`[BuildEngine] Notice removing previous container for ${serviceId}: ${e.message}`);
      }
    }

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
          console.log(`[GitHub Webhook] Redeploying matching service ${svc.name} (${svc.id})...`);
          try {
            await this.servicesService.restartService(svc.id);
            redeployed.push(svc.name);
          } catch (err: any) {
            console.error(`[GitHub Webhook] Failed to restart service ${svc.name}:`, err.message);
          }
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
