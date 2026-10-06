import { Injectable, BadRequestException, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DockerService } from './docker.service.js';
import crypto from 'node:crypto';

export interface ServiceRecord {
  id: string;
  name: string;
  image: string;
  containerId: string;
  containerName: string;
  status: 'running' | 'stopped' | 'restarting';
  port?: number;
  internalPort?: number;
  gitRepo?: string;
  gitBranch?: string;
  subfolder?: string;
  dockerfilePath?: string;
  buildMethod?: 'auto' | 'railpack' | 'dockerfile';
  runtimeMode?: 'web' | 'worker';
  installCommand?: string;
  buildCommand?: string;
  startCommand?: string;
  env: Record<string, string>;
  createdAt: string;
  startedAt?: string;
}

@Injectable()
export class ServicesService implements OnModuleInit {
  private services: Map<string, ServiceRecord> = new Map();

  constructor(private readonly dockerService: DockerService) {}

  async onModuleInit() {
    await this.discoverExisting();
  }

  async discoverExisting() {
    try {
      const containers = await this.dockerService.client.listContainers({ all: true });
      for (const info of containers) {
        const match = info.Names.find((n) => n.startsWith('/paas-svc-'));
        if (match) {
          const containerName = match.replace(/^\//, '');
          const parts = containerName.split('-');
          const serviceId = parts[parts.length - 1];
          const svcName = parts.slice(2, parts.length - 1).join('-') || 'service';
          const container = this.dockerService.client.getContainer(info.Id);
          const inspect = await container.inspect();

          const envMap: Record<string, string> = {};
          for (const e of inspect.Config.Env || []) {
            const [k, ...v] = e.split('=');
            envMap[k] = v.join('=');
          }

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
          if (exposedKeys.length > 0) {
            internalPort = parseInt(exposedKeys[0].replace(/\/tcp$/, ''), 10);
          } else if (envMap['PORT']) {
            internalPort = parseInt(envMap['PORT'], 10);
          }

          const gitRepo = inspect.Config.Labels?.['paas.git.repo'] || envMap['GIT_REPO'] || undefined;
          const gitBranch = inspect.Config.Labels?.['paas.git.branch'] || envMap['GIT_BRANCH'] || undefined;
          const subfolder = inspect.Config.Labels?.['paas.git.subfolder'] || envMap['GIT_SUBFOLDER'] || undefined;
          const dockerfilePath = inspect.Config.Labels?.['paas.git.dockerfile_path'] || envMap['DOCKERFILE_PATH'] || envMap['GIT_DOCKERFILE_PATH'] || undefined;
          const buildMethod = (inspect.Config.Labels?.['paas.git.build_method'] || envMap['BUILD_METHOD'] || undefined) as any;
          const runtimeMode = (inspect.Config.Labels?.['paas.runtime_mode'] || envMap['RUNTIME_MODE'] || 'web') as any;
          const installCommand = inspect.Config.Labels?.['paas.install_cmd'] || envMap['INSTALL_COMMAND'] || undefined;
          const buildCommand = inspect.Config.Labels?.['paas.build_cmd'] || envMap['BUILD_COMMAND'] || undefined;
          const startCommand = inspect.Config.Labels?.['paas.start_cmd'] || envMap['START_COMMAND'] || undefined;

          const record: ServiceRecord = {
            id: serviceId,
            name: svcName,
            image: inspect.Config.Image,
            containerId: info.Id,
            containerName,
            status: info.State === 'running' ? 'running' : 'stopped',
            port: hostPort,
            internalPort: internalPort || hostPort,
            gitRepo,
            gitBranch,
            subfolder,
            dockerfilePath,
            buildMethod,
            runtimeMode,
            installCommand,
            buildCommand,
            startCommand,
            env: envMap,
            createdAt: inspect.Created,
            startedAt: inspect.State?.StartedAt || undefined,
          };

          this.services.set(serviceId, record);
          console.log(`[ServicesService] Discovered existing service: ${svcName} (${serviceId})`);
        }
      }
    } catch (e: any) {
      console.warn(`[ServicesService] Discovery notice: ${e.message}`);
    }
  }

  async listServices(): Promise<ServiceRecord[]> {
    const records: ServiceRecord[] = [];
    const containers = await this.dockerService.client.listContainers({ all: true });

    for (const [id, rec] of this.services.entries()) {
      const live = containers.find((c) => c.Id === rec.containerId || c.Names.includes(`/${rec.containerName}`));
      if (live) {
        rec.status = live.State === 'running' ? 'running' : 'stopped';
      } else {
        rec.status = 'stopped';
      }
      records.push({ ...rec });
    }

    return records;
  }

  async getService(id: string): Promise<ServiceRecord> {
    const service = this.services.get(id);
    if (!service) {
      throw new NotFoundException(`Service '${id}' not found`);
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
    buildMethod?: 'auto' | 'railpack' | 'dockerfile';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    command?: string[];
  }): Promise<ServiceRecord> {
    const serviceId = options.id || crypto.randomBytes(4).toString('hex');
    const safeName = options.name.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    const containerName = `paas-svc-${safeName}-${serviceId}`;
    const image = options.image || 'nginx:alpine';
    const envVars = options.env || {};

    const envArray = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

    try {
      // Pull image if not already cached
      try {
        await this.dockerService.client.getImage(image).inspect();
      } catch {
        console.log(`[ServicesService] Pulling image: ${image}...`);
        const pullStream = await this.dockerService.client.pull(image);
        await new Promise((resolve, reject) => {
          this.dockerService.client.modem.followProgress(pullStream, (err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        });
      }

      await this.dockerService.ensureInternalNetwork();

      // Clean up any existing container with the exact same name (e.g. during in-place redeploy)
      try {
        const existingContainer = this.dockerService.client.getContainer(containerName);
        await existingContainer.stop().catch(() => {});
        await existingContainer.remove({ force: true }).catch(() => {});
      } catch {}

      const exposedPort = options.port || 80;
      const portKey = `${exposedPort}/tcp`;

      const container = await this.dockerService.client.createContainer({
        Image: image,
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
        },
      });

      await container.start();

      const inspect = await container.inspect();
      const hostPort = inspect.NetworkSettings.Ports[portKey]?.[0]?.HostPort
        ? parseInt(inspect.NetworkSettings.Ports[portKey][0].HostPort, 10)
        : undefined;

      const record: ServiceRecord = {
        id: serviceId,
        name: safeName,
        image,
        containerId: container.id,
        containerName,
        status: 'running',
        port: hostPort,
        internalPort: exposedPort,
        gitRepo: options.gitRepo,
        gitBranch: options.gitBranch,
        subfolder: options.subfolder,
        dockerfilePath: options.dockerfilePath,
        buildMethod: options.buildMethod || 'auto',
        runtimeMode: options.runtimeMode || 'web',
        installCommand: options.installCommand,
        buildCommand: options.buildCommand,
        startCommand: options.startCommand,
        env: envVars,
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };

      this.services.set(serviceId, record);
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
    return service;
  }

  async restartService(id: string): Promise<ServiceRecord> {
    const service = await this.getService(id);
    const container = this.dockerService.client.getContainer(service.containerId);
    await container.restart();
    service.status = 'running';
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
    return { success: true };
  }

  async updateEnvironment(id: string, env: Record<string, string>): Promise<ServiceRecord> {
    const service = await this.getService(id);
    service.env = { ...service.env, ...env };
    // To apply new env vars in Docker, recreate or restart
    return service;
  }

  async updateSettings(
    id: string,
    settings: {
      dockerfilePath?: string;
      buildMethod?: 'auto' | 'railpack' | 'dockerfile';
      runtimeMode?: 'web' | 'worker';
      subfolder?: string;
      port?: number;
      installCommand?: string;
      buildCommand?: string;
      startCommand?: string;
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
