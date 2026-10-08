import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DockerService } from './docker.service.js';
import { CaddyService, CaddyRoute } from './caddy.service.js';
import { SystemSettingsService } from './system-settings.service.js';
import { ensureDataDir } from './config/paths.js';
import crypto from 'node:crypto';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';

export interface DomainStatusRecord {
  status: 'pending' | 'verified';
  targetIp?: string;
  verifiedAt?: string;
  lastCheckedAt?: string;
  lastError?: string;
  createdAt: string;
}

export interface ServiceRecord {
  id: string;
  name: string;
  image: string;
  containerId: string;
  containerName: string;
  status: 'running' | 'stopped' | 'restarting' | 'failed';
  errorMessage?: string;
  port?: number;
  internalPort?: number;
  containerIp?: string;
  gitRepo?: string;
  gitBranch?: string;
  subfolder?: string;
  dockerfilePath?: string;
  buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
  runtimeMode?: 'web' | 'worker';
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  systemPackages?: string;
  nodeVersion?: string;
  domains?: string[];
  domainStatus?: Record<string, DomainStatusRecord>;
  env: Record<string, string>;
  createdAt: string;
  startedAt?: string;
}

@Injectable()
export class ServicesService implements OnModuleInit {
  private services: Map<string, ServiceRecord> = new Map();
  private storagePath: string;

  constructor(
    private readonly dockerService: DockerService,
    private readonly caddyService: CaddyService,
    private readonly systemSettingsService: SystemSettingsService,
  ) {
    this.storagePath = path.join(ensureDataDir(), 'services.json');
  }

  async onModuleInit() {
    // The control plane owns the durable service definitions (env + settings);
    // Docker is the runtime and only supplies live container state.
    this.loadFromDisk();
    await this.discoverExisting();
    // Best-effort: re-push all known routes to Caddy so domain routing
    // self-heals after a control-plane or edge-proxy restart.
    this.syncCaddy().catch(() => {});
    this.startDomainVerifier();
  }

  /**
   * Background DNS verifier: periodically re-checks PENDING domains so their
   * status is correct even when no UI is watching. Runs every 45s, only touches
   * domains that are still pending, and skips ones checked very recently so DNS
   * has time to propagate.
   */
  private startDomainVerifier(): void {
    const INTERVAL_MS = 45000;
    const timer = setInterval(() => {
      this.verifyPendingDomains().catch(() => {});
    }, INTERVAL_MS);
    // Don't keep the process alive solely for this timer.
    (timer as any).unref?.();
  }

  private async verifyPendingDomains(): Promise<void> {
    const now = Date.now();
    let changed = false;
    const statusSnapshot = (s: ServiceRecord) =>
      JSON.stringify(
        Object.fromEntries((s.domains || []).map((h) => [h, s.domainStatus?.[h]?.status || 'pending'])),
      );
    for (const service of this.services.values()) {
      const hosts = (service.domains || []).filter((h) => {
        const st = service.domainStatus?.[h];
        if (st?.status === 'verified') return false;
        const checkedAt = st?.lastCheckedAt ? new Date(st.lastCheckedAt).getTime() : 0;
        if (checkedAt && now - checkedAt < 20000) return false;
        return true;
      });
      if (hosts.length === 0) continue;
      const before = statusSnapshot(service);
      await this.verifyDomains(service);
      if (statusSnapshot(service) !== before) changed = true;
    }
    // Only persist when a domain actually flipped (avoids constant writes).
    if (changed) this.saveToDisk();

    // Also re-check the global dashboard domain while it's still pending.
    try {
      const domains = this.systemSettingsService.getDomains();
      const host = (domains.serverDomain || '').trim();
      const checkedAt = domains.domainStatusCheckedAt
        ? new Date(domains.domainStatusCheckedAt).getTime()
        : 0;
      if (host && domains.domainStatus !== 'verified' && (!checkedAt || now - checkedAt >= 20000)) {
        await this.verifyServerDomain();
      }
    } catch {}
  }

  /** System/container env vars that are never treated as user configuration. */
  private isSystemEnvKey(key: string): boolean {
    const u = (key || '').toUpperCase();
    if (
      [
        'PATH', 'HOME', 'PWD', 'OLDPWD', 'SHLVL', '_', 'USER', 'LOGNAME', 'TERM', 'ENV', 'CI', 'HOSTNAME',
        'LANG', 'LC_ALL', 'LC_CTYPE', 'QTDIR', 'CPATH', 'LIBRARY_PATH', 'LD_LIBRARY_PATH',
        'GIT_SSL_CAINFO', 'NIX_SSL_CERT_FILE', 'SOURCE_DATE_EPOCH',
        'NODE_ENV', 'NODE_VERSION', 'YARN_VERSION', 'NPM_CONFIG_PRODUCTION',
      ].includes(u)
    ) {
      return true;
    }
    return (
      u.startsWith('NIX') || u.startsWith('NPM_') || u.startsWith('YARN_') || u.startsWith('RV_') ||
      u.startsWith('PKG_') || u.startsWith('LD_') || u.startsWith('GEM_') || u.startsWith('PIP_') ||
      u.startsWith('NGINX') || u.startsWith('NJS_') || u.startsWith('ACME_') || u.startsWith('DYNPKG_')
    );
  }

  /** Only the durable, control-plane-owned fields are persisted to disk. */
  private toDurable(rec: ServiceRecord) {
    return {
      id: rec.id,
      name: rec.name,
      image: rec.image,
      gitRepo: rec.gitRepo,
      gitBranch: rec.gitBranch,
      subfolder: rec.subfolder,
      dockerfilePath: rec.dockerfilePath,
      buildMethod: rec.buildMethod,
      runtimeMode: rec.runtimeMode,
      installCommand: rec.installCommand,
      buildCommand: rec.buildCommand,
      startCommand: rec.startCommand,
      systemPackages: rec.systemPackages,
      nodeVersion: rec.nodeVersion,
      domains: rec.domains || [],
      domainStatus: rec.domainStatus || {},
      env: rec.env,
      createdAt: rec.createdAt,
    };
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(this.storagePath)) return;
      const list = JSON.parse(fs.readFileSync(this.storagePath, 'utf8'));
      if (!Array.isArray(list)) return;
      for (const item of list) {
        if (!item || !item.id) continue;
        const safeName = String(item.name || 'service').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
        this.services.set(item.id, {
          ...item,
          containerId: '',
          containerName: `paas-svc-${safeName}-${item.id}`,
          status: 'stopped',
          domains: item.domains || [],
          domainStatus: item.domainStatus || {},
          // Defensively strip any system/container vars from persisted env.
          env: Object.fromEntries(
            Object.entries(item.env || {}).filter(([k]) => !this.isSystemEnvKey(k)),
          ),
        } as ServiceRecord);
      }
      console.log(`[ServicesService] Loaded ${this.services.size} service(s) from ${this.storagePath}`);
    } catch (e: any) {
      console.warn('[ServicesService] Failed to load services.json:', e?.message);
    }
  }

  private saveToDisk() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const list = Array.from(this.services.values()).map((r) => this.toDurable(r));
      fs.writeFileSync(this.storagePath, JSON.stringify(list, null, 2), 'utf8');
    } catch (e: any) {
      console.warn('[ServicesService] Failed to save services.json:', e?.message);
    }
  }

  async discoverExisting() {
    try {
      const containers = await this.dockerService.client.listContainers({ all: true });
      let changed = false;

      for (const info of containers) {
        const match = info.Names.find((n) => n.startsWith('/paas-svc-'));
        if (!match) continue;
        const containerName = match.replace(/^\//, '');
        const parts = containerName.split('-');
        const serviceId = parts[parts.length - 1];
        const svcName = parts.slice(2, parts.length - 1).join('-') || 'service';
        const inspect = await this.dockerService.client.getContainer(info.Id).inspect();

        let hostPort: number | undefined;
        for (const key of Object.keys(inspect.NetworkSettings.Ports || {})) {
          const binding = inspect.NetworkSettings.Ports[key];
          if (binding && binding[0]) {
            hostPort = parseInt(binding[0].HostPort, 10);
            break;
          }
        }
        const exposedKeys = Object.keys(inspect.Config.ExposedPorts || {});
        let internalPort: number | undefined;
        if (exposedKeys.length > 0) internalPort = parseInt(exposedKeys[0].replace(/\/tcp$/, ''), 10);

        const containerIp =
          inspect.NetworkSettings?.Networks?.['paas-internal-network']?.IPAddress ||
          (inspect.NetworkSettings as any)?.IPAddress;

        const existing = this.services.get(serviceId);
        if (existing) {
          // Known service → keep the control-plane-owned env/settings intact;
          // refresh live runtime fields only.
          existing.containerId = info.Id;
          existing.containerName = containerName;
          existing.image = inspect.Config.Image || existing.image;
          existing.status = info.State === 'running' ? 'running' : 'stopped';
          existing.port = hostPort ?? existing.port;
          existing.internalPort = internalPort ?? existing.internalPort;
          existing.containerIp = containerIp || existing.containerIp;
          existing.startedAt = inspect.State?.StartedAt || existing.startedAt;
          changed = true;
        } else {
          // Unknown/external container → import it with a clean (filtered) env.
          const rawEnv: Record<string, string> = {};
          for (const e of inspect.Config.Env || []) {
            const [k, ...v] = e.split('=');
            rawEnv[k] = v.join('=');
          }
          const env: Record<string, string> = {};
          for (const [k, v] of Object.entries(rawEnv)) {
            if (!this.isSystemEnvKey(k)) env[k] = v;
          }
          const L = inspect.Config.Labels || {};
          const record: ServiceRecord = {
            id: serviceId,
            name: svcName,
            image: inspect.Config.Image,
            containerId: info.Id,
            containerName,
            status: info.State === 'running' ? 'running' : 'stopped',
            port: hostPort,
            internalPort: internalPort || hostPort,
            gitRepo: L['paas.git.repo'] || undefined,
            gitBranch: L['paas.git.branch'] || undefined,
            subfolder: L['paas.git.subfolder'] || undefined,
            dockerfilePath: L['paas.git.dockerfile_path'] || undefined,
            buildMethod: (L['paas.git.build_method'] || undefined) as any,
            runtimeMode: (L['paas.runtime_mode'] || 'web') as any,
            installCommand: L['paas.install_cmd'] || undefined,
            buildCommand: L['paas.build_cmd'] || undefined,
            startCommand: L['paas.start_cmd'] || undefined,
            systemPackages: L['paas.sys_packages'] || undefined,
            nodeVersion: L['paas.node_version'] || undefined,
            env,
            createdAt: inspect.Created,
            startedAt: inspect.State?.StartedAt || undefined,
          };
          this.services.set(serviceId, record);
          changed = true;
          console.log(`[ServicesService] Imported existing service: ${svcName} (${serviceId})`);
        }
      }

      if (changed) this.saveToDisk();
    } catch (e: any) {
      console.warn(`[ServicesService] Discovery notice: ${e.message}`);
    }
  }

  private async evaluateContainerHealth(
    live: any,
  ): Promise<{ status: 'running' | 'stopped' | 'restarting' | 'failed'; errorMessage?: string }> {
    let isCrashLoop = false;
    let crashError: string | undefined;

    const liveStatus = (live.Status || '').toLowerCase();
    const liveState = (live.State || '').toLowerCase();

    if (liveState === 'restarting' || liveStatus.includes('restarting')) {
      isCrashLoop = true;
      crashError = 'Container is in a crash loop (auto-restarting)';
    }

    try {
      const container = this.dockerService.client.getContainer(live.Id);
      const inspect = await container.inspect();
      if (inspect.State) {
        if (inspect.State.Restarting) {
          isCrashLoop = true;
          crashError = 'Container is in a crash loop (auto-restarting)';
        } else if (!inspect.State.Running && inspect.State.ExitCode !== 0) {
          isCrashLoop = true;
          crashError = inspect.State.Error || `Container exited with code ${inspect.State.ExitCode}`;
        } else if (inspect.State.Running && (inspect.RestartCount || 0) > 0) {
          const startedAt = new Date(inspect.State.StartedAt).getTime();
          const uptimeSec = (Date.now() - startedAt) / 1000;
          // If restarted multiple times and has been up for less than 45 seconds, it is actively flapping
          if (inspect.RestartCount >= 2 && uptimeSec < 45) {
            isCrashLoop = true;
            crashError = `Container is in a crash loop (restarted ${inspect.RestartCount} times)`;
          }
        }
      }
    } catch {}

    if (isCrashLoop) {
      try {
        const logsBuffer = await this.dockerService.client.getContainer(live.Id).logs({
          stderr: true,
          stdout: true,
          tail: 15,
        });
        const raw = logsBuffer.toString('utf8').replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '').trim();
        const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
        const errLine = lines
          .slice()
          .reverse()
          .find(
            (l) =>
              l.toLowerCase().includes('error:') ||
              l.toLowerCase().includes('error [') ||
              l.startsWith('npm ERR!') ||
              l.toLowerCase().includes('failed') ||
              l.toLowerCase().includes('exception'),
          );
        if (errLine) {
          crashError = errLine.replace(/^.*Error:\s*/i, 'Error: ');
        }
      } catch {}

      return { status: 'failed', errorMessage: crashError || 'Container crashed on startup' };
    }

    return {
      status: liveState === 'running' ? 'running' : 'stopped',
      errorMessage: undefined,
    };
  }

  async listServices(): Promise<ServiceRecord[]> {
    const records: ServiceRecord[] = [];
    const containers = await this.dockerService.client.listContainers({ all: true });

    for (const [id, rec] of this.services.entries()) {
      const live = containers.find((c) => c.Id === rec.containerId || c.Names.includes(`/${rec.containerName}`));
      if (live) {
        const health = await this.evaluateContainerHealth(live);
        rec.status = health.status;
        if (health.errorMessage) {
          rec.errorMessage = health.errorMessage;
        } else if (health.status === 'running') {
          rec.errorMessage = undefined;
        }
      } else {
        if (rec.status !== 'failed') {
          rec.status = 'stopped';
        }
      }
      records.push({ ...rec });
    }

    return records;
  }

  markServiceFailed(id: string, errorMessage?: string): void {
    const s = this.services.get(id);
    if (s) {
      s.status = 'failed';
      if (errorMessage) s.errorMessage = errorMessage;
      this.saveToDisk();
    }
  }

  async getService(id: string): Promise<ServiceRecord> {
    const service = this.services.get(id);
    if (!service) {
      throw new NotFoundException(`Service '${id}' not found`);
    }

    if (service.containerId || service.containerName) {
      try {
        const containers = await this.dockerService.client.listContainers({ all: true });
        const live = containers.find(
          (c) => c.Id === service.containerId || c.Names.includes(`/${service.containerName}`),
        );
        if (live) {
          const health = await this.evaluateContainerHealth(live);
          service.status = health.status;
          if (health.errorMessage) {
            service.errorMessage = health.errorMessage;
          } else if (health.status === 'running') {
            service.errorMessage = undefined;
          }
        } else {
          if (service.status !== 'failed') {
            service.status = 'stopped';
          }
        }
      } catch {}
    }

    return service;
  }

  async deployService(options: {
    id?: string;
    name: string;
    image?: string;
    env?: Record<string, string>;
    port?: number;
    gitRepo?: string;
    gitBranch?: string;
    subfolder?: string;
    dockerfilePath?: string;
    buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    systemPackages?: string;
    nodeVersion?: string;
    domains?: string[];
    command?: string[];
  }): Promise<ServiceRecord> {
    const serviceId = options.id || crypto.randomBytes(4).toString('hex');
    const safeName = options.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const containerName = `paas-svc-${safeName}-${serviceId}`;
    const image = options.image || 'nginx:alpine';
    const envVars: Record<string, string> = { ...(options.env || {}) };
    // Keep the app's listening port in sync with the port we expose and host-map,
    // so the edge route, the published port and the app itself all agree.
    const exposedPort = options.port || 80;
    if (options.runtimeMode !== 'worker') {
      envVars.PORT = String(exposedPort);
    }

    const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

    try {
      // Pull image if not already cached, resolving any containerd / docker.io/library prefix variations
      let targetImage = image;
      try {
        await this.dockerService.client.getImage(targetImage).inspect();
      } catch (inspectErr: any) {
        if (targetImage.startsWith('paas-app-') || !targetImage.includes('/')) {
          const libraryTag = `docker.io/library/${targetImage}`;
          try {
            await this.dockerService.client.getImage(libraryTag).inspect();
            targetImage = libraryTag;
          } catch {
            const fallbackLatest = `${targetImage.split(':')[0]}:latest`;
            try {
              await this.dockerService.client.getImage(fallbackLatest).inspect();
              targetImage = fallbackLatest;
            } catch {
              try {
                const libraryLatest = `docker.io/library/${fallbackLatest}`;
                await this.dockerService.client.getImage(libraryLatest).inspect();
                targetImage = libraryLatest;
              } catch {
                console.warn(`[ServicesService] Local image "${targetImage}" inspect notice: ${inspectErr?.message}`);
              }
            }
          }
        } else {
          console.log(`[ServicesService] Pulling image: ${targetImage}...`);
          const pullStream = await this.dockerService.client.pull(targetImage);
          await new Promise((resolve, reject) => {
            this.dockerService.client.modem.followProgress(pullStream, (err, res) => {
              if (err) reject(err);
              else resolve(res);
            });
          });
        }
      }

      await this.dockerService.ensureInternalNetwork();

      // Clean up any existing container with the exact same name (e.g. during in-place redeploy)
      try {
        const existingContainer = this.dockerService.client.getContainer(containerName);
        await existingContainer.stop().catch(() => {});
        await existingContainer.remove({ force: true }).catch(() => {});
      } catch {}

      const portKey = `${exposedPort}/tcp`;

      const createOptions = {
        name: containerName,
        Env: envArray,
        Cmd: options.command,
        ExposedPorts: { [portKey]: {} },
        HostConfig: {
          NetworkMode: 'paas-internal-network',
          PortBindings: {
            [portKey]: [{ HostPort: '0' }], // allocate ephemeral host port for testing
          },
          RestartPolicy: { Name: 'unless-stopped' },
        },
        Labels: {
          'paas.service': 'true',
          'paas.id': serviceId,
          'paas.name': safeName,
          ...(options.gitRepo ? { 'paas.git.repo': options.gitRepo } : {}),
          ...(options.gitBranch ? { 'paas.git.branch': options.gitBranch } : {}),
          ...(options.subfolder ? { 'paas.git.subfolder': options.subfolder } : {}),
          ...(options.dockerfilePath ? { 'paas.git.dockerfile_path': options.dockerfilePath } : {}),
          ...(options.buildMethod ? { 'paas.git.build_method': options.buildMethod } : {}),
          ...(options.runtimeMode ? { 'paas.runtime_mode': options.runtimeMode } : {}),
          ...(options.installCommand ? { 'paas.install_cmd': options.installCommand } : {}),
          ...(options.buildCommand ? { 'paas.build_cmd': options.buildCommand } : {}),
          ...(options.startCommand ? { 'paas.start_cmd': options.startCommand } : {}),
          ...(options.systemPackages ? { 'paas.sys_packages': options.systemPackages } : {}),
          ...(options.nodeVersion ? { 'paas.node_version': options.nodeVersion } : {}),
        },
      };

      let container: any;
      try {
        container = await this.dockerService.client.createContainer({
          ...createOptions,
          Image: targetImage,
        });
      } catch (createErr: any) {
        // Fallback for containerd image stores where names may be qualified with docker.io/library/ or vice-versa
        const candidates = [
          targetImage.startsWith('docker.io/library/')
            ? targetImage.replace('docker.io/library/', '')
            : `docker.io/library/${targetImage}`,
          `${targetImage.split(':')[0]}:latest`,
          `docker.io/library/${targetImage.split(':')[0]}:latest`,
        ];
        let fallbackCreated = false;
        for (const candidate of candidates) {
          try {
            container = await this.dockerService.client.createContainer({
              ...createOptions,
              Image: candidate,
            });
            targetImage = candidate;
            fallbackCreated = true;
            break;
          } catch {}
        }
        if (!fallbackCreated) {
          throw createErr;
        }
      }

      await container.start();

      const inspect = await container.inspect();
      const hostPort = inspect.NetworkSettings.Ports[portKey]?.[0]?.HostPort
        ? parseInt(inspect.NetworkSettings.Ports[portKey][0].HostPort, 10)
        : undefined;
      const containerIp =
        inspect.NetworkSettings?.Networks?.['paas-internal-network']?.IPAddress ||
        (inspect.NetworkSettings as any)?.IPAddress;

      const record: ServiceRecord = {
        id: serviceId,
        name: safeName,
        image,
        containerId: container.id,
        containerName,
        status: 'running',
        port: hostPort,
        internalPort: exposedPort,
        containerIp,
        gitRepo: options.gitRepo,
        gitBranch: options.gitBranch,
        subfolder: options.subfolder,
        dockerfilePath: options.dockerfilePath,
        buildMethod: options.buildMethod || 'auto',
        runtimeMode: options.runtimeMode || 'web',
        installCommand: options.installCommand,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
        systemPackages: options.systemPackages,
        nodeVersion: options.nodeVersion,
        domains:
          options.domains ||
          (options.id ? this.services.get(options.id)?.domains : undefined) ||
          this.defaultDomains(safeName),
        env: envVars,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };

      // Preserve verification state across redeploys; mark newly-assigned
      // domains as pending until their DNS points at this server.
      const prevRecord = options.id ? this.services.get(options.id) : undefined;
      const statusMap: Record<string, DomainStatusRecord> = { ...(prevRecord?.domainStatus || {}) };
      const targetIp = this.systemSettingsService.getServerIp();
      for (const host of record.domains || []) {
        if (!statusMap[host]) {
          const isWildcard = this.isCoveredByVerifiedWildcard(host);
          statusMap[host] = {
            status: isWildcard ? 'verified' : 'pending',
            targetIp,
            createdAt: new Date().toISOString(),
            verifiedAt: isWildcard ? new Date().toISOString() : undefined,
          };
        }
      }
      record.domainStatus = statusMap;

      this.services.set(serviceId, record);
      this.saveToDisk();
      this.syncCaddy().catch(() => {});
      return record;
    } catch (err: any) {
      throw new BadRequestException(`Failed to deploy service: ${err.message}`);
    }
  }

  async stopService(id: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    const container = this.dockerService.client.getContainer(service.containerId);
    await container.stop();
    service.status = 'stopped';
    this.saveToDisk();
    this.syncCaddy().catch(() => {});
    return service;
  }

  async restartService(id: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    if (service.image) {
      try {
        return await this.deployService({
          id: service.id,
          name: service.name,
          image: service.image,
          port: service.internalPort || 3000,
          env: service.env,
          domains: service.domains,
          gitRepo: service.gitRepo,
          gitBranch: service.gitBranch,
          subfolder: service.subfolder,
          dockerfilePath: service.dockerfilePath,
          buildMethod: service.buildMethod,
          runtimeMode: service.runtimeMode,
          installCommand: service.installCommand,
          buildCommand: service.buildCommand,
          startCommand: service.startCommand,
          systemPackages: service.systemPackages,
          nodeVersion: service.nodeVersion,
        });
      } catch (err: any) {
        console.warn(`[ServicesService] Re-deploy during restart failed, falling back to container.restart(): ${err.message}`);
      }
    }
    const container = this.dockerService.client.getContainer(service.containerId);
    await container.restart();
    service.status = 'running';
    this.syncCaddy().catch(() => {});
    return service;
  }

  async deleteService(id: string): Promise<{ success: boolean }> {
    const service = await this.getService(id);
    const container = this.dockerService.client.getContainer(service.containerId);
    try {
      await container.stop();
    } catch {}
    await container.remove({ force: true });
    this.services.delete(id);
    this.saveToDisk();
    this.syncCaddy().catch(() => {});
    return { success: true };
  }

  async updateEnvironment(id: string, env: Record<string, string>): Promise<ServiceRecord> {
    const service = await this.getService(id);
    // Platform-managed keys live alongside user vars; preserve them so an env
    // edit replaces the user's variables (including deletions) without wiping them.
    const PLATFORM_KEYS = new Set([
      'PORT', 'GIT_REPO', 'GIT_BRANCH', 'GIT_SUBFOLDER', 'GIT_DOCKERFILE_PATH', 'DOCKERFILE_PATH',
      'BUILD_METHOD', 'RUNTIME_MODE', 'INSTALL_COMMAND', 'BUILD_COMMAND', 'START_COMMAND',
      'SYSTEM_PACKAGES', 'NODE_VERSION',
    ]);
    const next: Record<string, string> = {};
    for (const [k, v] of Object.entries(service.env || {})) {
      if (PLATFORM_KEYS.has(k)) next[k] = v;
    }
    Object.assign(next, env);
    service.env = next;
    // Applied to the container on next redeploy.
    this.saveToDisk();
    this.syncCaddy().catch(() => {});
    return service;
  }

  /** Default auto-assigned subdomains for a service, e.g. myapp.example.com. */
  private defaultDomains(safeName: string): string[] {
    const base = this.systemSettingsService.getServerDomain();
    return base ? [`${safeName}.${base}`] : [];
  }

  /** Add a custom domain to a service and re-sync the edge proxy. */
  async addDomain(id: string, domain: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    const clean = (domain || '')
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/\/.*$/, '');
    if (!clean) throw new BadRequestException('A domain name is required');
    // Prevent two services from claiming the same host (Caddy would otherwise
    // silently route only to whichever route it evaluated first).
    const conflict = Array.from(this.services.values()).find(
      (s) => s.id !== id && (s.domains || []).includes(clean),
    );
    if (conflict) {
      throw new BadRequestException(
        `Domain "${clean}" is already assigned to service "${conflict.name}". Remove it there first.`,
      );
    }
    const list = service.domains || [];
    if (!list.includes(clean)) list.push(clean);
    service.domains = list;
    service.domainStatus = service.domainStatus || {};
    if (!service.domainStatus[clean]) {
      const isWildcard = this.isCoveredByVerifiedWildcard(clean);
      service.domainStatus[clean] = {
        status: isWildcard ? 'verified' : 'pending',
        targetIp: this.systemSettingsService.getServerIp(),
        createdAt: new Date().toISOString(),
        verifiedAt: isWildcard ? new Date().toISOString() : undefined,
      };
    }
    this.saveToDisk();
    await this.syncCaddy().catch(() => {});
    // Run an immediate DNS check so the domain can flip to verified right away.
    await this.verifyDomains(service).catch(() => {});
    this.saveToDisk();
    return service;
  }

  /** Remove a domain from a service and re-sync the edge proxy. */
  async removeDomain(id: string, domain: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    service.domains = (service.domains || []).filter((d) => d !== domain);
    if (service.domainStatus) delete service.domainStatus[domain];
    this.saveToDisk();
    await this.syncCaddy().catch(() => {});
    return service;
  }

  /** The IP custom domains should point at (configured or auto-detected). */
  getServerIp(): string {
    return this.systemSettingsService.getServerIp();
  }

  /** Verify a single service's domains against the server IP. */
  async verifyServiceDomains(id: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    await this.verifyDomains(service);
    this.saveToDisk();
    return service;
  }

  /** Verify every domain across all services (edge auto-check). */
  async verifyAllDomains(): Promise<{ verified: number; pending: number; checked: number }> {
    let verified = 0;
    let pending = 0;
    for (const service of this.services.values()) {
      await this.verifyDomains(service);
      for (const host of service.domains || []) {
        if (service.domainStatus?.[host]?.status === 'verified') verified++;
        else pending++;
      }
    }
    this.saveToDisk();
    return { verified, pending, checked: verified + pending };
  }

  /**
   * Check whether a single hostname currently resolves to this server's IP
   * (used by onboarding / settings to validate a base or wildcard domain).
   */
  async checkHost(host: string): Promise<{ host: string; targetIp: string; ips: string[]; verified: boolean }> {
    const clean = (host || '').trim().toLowerCase();
    const targetIp = this.systemSettingsService.getServerIp();
    const ips = clean ? await this.resolveDomainIps(clean) : [];
    return { host: clean, targetIp, ips, verified: !!targetIp && ips.includes(targetIp) };
  }

  /** Verify the global dashboard (server) domain and persist its status. */
  async verifyServerDomain(): Promise<{ host: string; targetIp: string; ips: string[]; verified: boolean }> {
    const host = (this.systemSettingsService.getServerDomain() || '').trim().toLowerCase();
    const targetIp = this.systemSettingsService.getServerIp();

    if (!host) {
      await this.systemSettingsService.updateSettings({
        domains: {
          domainStatus: undefined,
          domainStatusCheckedAt: undefined,
          domainStatusVerifiedAt: undefined,
          domainStatusError: undefined,
        },
      });
      return { host: '', targetIp, ips: [], verified: false };
    }

    const ips = await this.resolveDomainIps(host);
    const verified = !!targetIp && ips.includes(targetIp);
    await this.systemSettingsService.updateSettings({
      domains: {
        domainStatus: verified ? 'verified' : 'pending',
        domainStatusCheckedAt: new Date().toISOString(),
        domainStatusVerifiedAt: verified ? new Date().toISOString() : undefined,
        domainStatusError: verified
          ? undefined
          : ips.length
            ? `Currently points to ${ips.join(', ')}`
            : 'No DNS records found yet',
      },
    });
    if (verified) {
      await this.verifyAllDomains().catch(() => {});
    }
    return { host, targetIp, ips, verified };
  }

  /** Determine whether a domain is covered by an already-verified base or wildcard domain. */
  isCoveredByVerifiedWildcard(host: string): boolean {
    const domainsConfig = this.systemSettingsService.getDomains();
    if (domainsConfig?.domainStatus !== 'verified') return false;

    const cleanHost = (host || '').trim().toLowerCase();
    const serverDomain = (this.systemSettingsService.getServerDomain() || '').trim().toLowerCase();
    const wildcardDomain = (this.systemSettingsService.getWildcardDomain() || '').trim().toLowerCase();

    // Direct match with base domain
    if (serverDomain && cleanHost === serverDomain) {
      return true;
    }

    // Subdomain match against base domain: e.g. mudacle.test.walhost.xyz ends with .test.walhost.xyz
    if (serverDomain && cleanHost.endsWith(`.${serverDomain}`)) {
      return true;
    }

    // Subdomain match against wildcard pattern: e.g. *.test.walhost.xyz
    if (wildcardDomain) {
      const suffix = wildcardDomain.startsWith('*.')
        ? wildcardDomain.slice(2)
        : wildcardDomain.replace(/^\*/, '');
      if (suffix && (cleanHost === suffix || cleanHost.endsWith(`.${suffix}`))) {
        return true;
      }
    }

    return false;
  }

  /** Resolve the IPv4/IPv6 addresses (following a CNAME) for a hostname. */
  private async resolveDomainIps(host: string): Promise<string[]> {
    const ips: string[] = [];
    try {
      ips.push(...(await dns.promises.resolve4(host)));
    } catch {}
    if (ips.length === 0) {
      try {
        const cnames = await dns.promises.resolveCname(host);
        for (const c of cnames) {
          try {
            ips.push(...(await dns.promises.resolve4(c)));
          } catch {}
        }
      } catch {}
    }
    // Also try OS-level resolver (getaddrinfo) in case Node's internal c-ares cache or servers differ
    if (ips.length === 0) {
      try {
        const lookupResult = await dns.promises.lookup(host, { all: true });
        for (const res of lookupResult) {
          if (res.address) ips.push(res.address);
        }
      } catch {}
    }
    try {
      ips.push(...(await dns.promises.resolve6(host)));
    } catch {}
    return Array.from(new Set(ips));
  }

  /** Update a service's per-domain verification status in place. */
  private async verifyDomains(service: ServiceRecord): Promise<void> {
    const targetIp = this.systemSettingsService.getServerIp();
    service.domainStatus = service.domainStatus || {};
    await Promise.all(
      (service.domains || []).map(async (host) => {
        const cleanHost = (host || '').trim().toLowerCase();
        const entry: DomainStatusRecord = service.domainStatus![host] || {
          status: 'pending',
          createdAt: new Date().toISOString(),
        };
        entry.targetIp = targetIp;
        entry.lastCheckedAt = new Date().toISOString();

        // 1. Inherit verification if covered by a verified wildcard or base domain
        if (this.isCoveredByVerifiedWildcard(cleanHost)) {
          entry.status = 'verified';
          entry.verifiedAt = entry.verifiedAt || new Date().toISOString();
          entry.lastError = undefined;
          service.domainStatus![host] = entry;
          return;
        }

        // 2. Otherwise verify via DNS resolution against target server IP
        const ips = await this.resolveDomainIps(cleanHost);
        if (targetIp && ips.includes(targetIp)) {
          entry.status = 'verified';
          entry.verifiedAt = entry.verifiedAt || new Date().toISOString();
          entry.lastError = undefined;
        } else {
          entry.status = 'pending';
          entry.lastError =
            ips.length === 0 ? 'No DNS records found yet' : `Currently points to ${ips.join(', ')}`;
        }
        service.domainStatus![host] = entry;
      }),
    );
  }

  /** All host→target routes derived from dashboard domain and running services' assigned domains. */
  getRoutes(): CaddyRoute[] {
    const routes: CaddyRoute[] = [];
    const seen = new Set<string>();

    // 1. Route the control plane dashboard domain if configured
    const serverDomain = this.systemSettingsService.getServerDomain()?.trim();
    if (serverDomain && !seen.has(serverDomain)) {
      seen.add(serverDomain);
      routes.push({ host: serverDomain, target: 'localhost:3000' });
    }

    // 2. Route all running services' assigned domains
    for (const svc of this.services.values()) {
      if (!svc.domains || svc.domains.length === 0) continue;
      if (svc.status !== 'running') continue;
      // When Caddy runs as a system host daemon, it cannot resolve Docker container
      // hostnames directly. Use the published host port (127.0.0.1:port) or the
      // container's bridge IP address so reverse_proxy reaches the app reliably.
      const target = svc.port
        ? `127.0.0.1:${svc.port}`
        : svc.containerIp
          ? `${svc.containerIp}:${svc.internalPort || 3000}`
          : `${svc.containerName}:${svc.internalPort || 3000}`;
      for (const host of svc.domains) {
        if (seen.has(host)) continue;
        seen.add(host);
        routes.push({ host, target });
      }
    }
    return routes;
  }

  /** Recompute and push all routes to Caddy (best-effort). */
  async syncCaddy(): Promise<{ applied: boolean; error?: string }> {
    return this.caddyService.applyRoutes(this.getRoutes());
  }

  async updateSettings(
    id: string,
    settings: {
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
    }
  ): Promise<ServiceRecord> {
    const service = await this.getService(id);
    if (settings.dockerfilePath !== undefined) service.dockerfilePath = settings.dockerfilePath || undefined;
    if (settings.buildMethod !== undefined) service.buildMethod = settings.buildMethod;
    if (settings.runtimeMode !== undefined) service.runtimeMode = settings.runtimeMode;
    if (settings.subfolder !== undefined) service.subfolder = settings.subfolder || undefined;
    if (settings.port !== undefined) {
      service.port = settings.port;
      service.internalPort = settings.port;
      service.env['PORT'] = String(settings.port);
    }
    if (settings.installCommand !== undefined) service.installCommand = settings.installCommand;
    if (settings.buildCommand !== undefined) service.buildCommand = settings.buildCommand;
    if (settings.startCommand !== undefined) service.startCommand = settings.startCommand;
    if (settings.systemPackages !== undefined) service.systemPackages = settings.systemPackages || undefined;
    if (settings.nodeVersion !== undefined) service.nodeVersion = settings.nodeVersion || undefined;

    if (settings.dockerfilePath !== undefined) {
      if (settings.dockerfilePath) {
        service.env['DOCKERFILE_PATH'] = settings.dockerfilePath;
      } else {
        delete service.env['DOCKERFILE_PATH'];
      }
    }
    if (settings.subfolder !== undefined) {
      if (settings.subfolder && settings.subfolder !== '.') {
        service.env['GIT_SUBFOLDER'] = settings.subfolder;
      } else {
        delete service.env['GIT_SUBFOLDER'];
      }
    }
    this.saveToDisk();
    return service;
  }

  private demuxLogs(buf: Buffer): string {
    if (!buf || buf.length === 0) return '';
    // Check if Docker log headers (8-byte header per frame) are present
    if (buf.length >= 8 && (buf[0] === 1 || buf[0] === 2) && buf[1] === 0 && buf[2] === 0 && buf[3] === 0) {
      let offset = 0;
      const parts: string[] = [];
      while (offset < buf.length) {
        if (offset + 8 > buf.length) {
          parts.push(buf.subarray(offset).toString('utf8'));
          break;
        }
        const size = buf.readUInt32BE(offset + 4);
        const start = offset + 8;
        const end = Math.min(start + size, buf.length);
        parts.push(buf.subarray(start, end).toString('utf8'));
        offset = start + size;
      }
      return parts.join('');
    }
    return buf.toString('utf8');
  }

  async getRecentLogs(id: string, tail = 100): Promise<string> {
    const service = await this.getService(id);
    const container = this.dockerService.client.getContainer(service.containerId);
    const logs = await container.logs({
      stdout: true,
      stderr: true,
      tail,
      timestamps: true,
    });
    return this.demuxLogs(Buffer.isBuffer(logs) ? logs : Buffer.from(logs));
  }

  async streamLogs(
    id: string,
    onChunk: (chunk: string) => void,
    onEnd: () => void,
  ): Promise<() => void> {
    try {
      const service = await this.getService(id);
      if (!service || !service.containerId) {
        onChunk(`[ContainerLogs] No active container found for service "${id}".\n`);
        onEnd();
        return () => {};
      }

      const container = this.dockerService.client.getContainer(service.containerId);

      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true,
        tail: 100,
        timestamps: true,
      });

      logStream.on('data', (chunk: Buffer) => {
        const cleanText = this.demuxLogs(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        if (cleanText) {
          onChunk(cleanText);
        }
      });

      logStream.on('end', onEnd);
      logStream.on('error', onEnd);

      return () => {
        try {
          (logStream as any).destroy?.();
        } catch {}
      };
    } catch (err: any) {
      onChunk(`[ContainerLogs] Container stream error: ${err.message || 'Container not found or stopped.'}\n`);
      onEnd();
      return () => {};
    }
  }
}
