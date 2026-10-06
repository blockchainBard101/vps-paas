# 02. Docker Engine Orchestrator with Dockerode

The core orchestration engine interacts with the local Docker daemon via `dockerode`. This document provides a production-grade TypeScript orchestrator managing container lifecycles, volume attachments, log demultiplexing, and metrics collection.

---

## 1. Complete `DockerOrchestrator` Class Implementation

```typescript
// server/orchestrator/DockerOrchestrator.ts
import Docker from 'dockerode';
import { Readable, PassThrough } from 'node:stream';

export interface CreateContainerParams {
  name: string;
  image: string;
  networkName: string;
  env: string[];
  ports?: { containerPort: number; hostPort?: number }[];
  volumes?: { volumeName: string; containerPath: string }[];
  memoryLimitMb?: number;
  cpuQuota?: number;
  labels?: Record<string, string>;
}

export class DockerOrchestrator {
  private docker: Docker;

  constructor(socketPath: string = '/var/run/docker.sock') {
    this.docker = new Docker({ socketPath });
  }

  /**
   * Ensures the internal PaaS bridge network exists
   */
  async ensureNetwork(networkName: string = 'paas-internal-network'): Promise<void> {
    const networks = await this.docker.listNetworks();
    const exists = networks.some((n) => n.Name === networkName);

    if (!exists) {
      await this.docker.createNetwork({
        Name: networkName,
        Driver: 'bridge',
        CheckDuplicate: true,
        Internal: false,
        Attachable: true,
      });
      console.log(`[DockerOrchestrator] Created internal bridge network: ${networkName}`);
    }
  }

  /**
   * Creates an isolated container with resource limits and volume bindings
   */
  async createServiceContainer(params: CreateContainerParams): Promise<Docker.Container> {
    await this.ensureNetwork(params.networkName);

    const binds = (params.volumes || []).map(
      (v) => `${v.volumeName}:${v.containerPath}`
    );

    const exposedPorts: Record<string, {}> = {};
    const portBindings: Record<string, any[]> = {};

    if (params.ports) {
      for (const p of params.ports) {
        const portKey = `${p.containerPort}/tcp`;
        exposedPorts[portKey] = {};
        if (p.hostPort) {
          portBindings[portKey] = [{ HostPort: `${p.hostPort}` }];
        }
      }
    }

    const memoryBytes = (params.memoryLimitMb || 512) * 1024 * 1024;
    const cpuQuota = Math.round((params.cpuQuota || 1.0) * 100000);

    const container = await this.docker.createContainer({
      Image: params.image,
      name: params.name,
      Env: params.env,
      ExposedPorts: exposedPorts,
      HostConfig: {
        Binds: binds,
        PortBindings: portBindings,
        NetworkMode: params.networkName,
        Memory: memoryBytes,
        MemorySwap: memoryBytes, // Disables swap
        CpuPeriod: 100000,
        CpuQuota: cpuQuota,
        PidsLimit: 256,
        RestartPolicy: { Name: 'unless-stopped' },
        SecurityOpt: ['no-new-privileges:true'],
      },
      Labels: {
        'paas.managed': 'true',
        ...(params.labels || {}),
      },
    });

    return container;
  }

  /**
   * Starts a container by ID
   */
  async startContainer(containerId: string): Promise<void> {
    const container = this.docker.getContainer(containerId);
    await container.start();
  }

  /**
   * Gracefully stops and removes a container
   */
  async stopAndRemove(containerId: string, timeoutSeconds = 10): Promise<void> {
    const container = this.docker.getContainer(containerId);
    try {
      await container.stop({ t: timeoutSeconds });
    } catch (err: any) {
      // Ignore if container is already stopped
      if (err.statusCode !== 304) console.warn('Container stop warning:', err.message);
    }
    await container.remove({ force: true });
  }

  /**
   * Demultiplexes raw Docker log streams into clean text chunks
   * Docker log streams prefix each line with an 8-byte binary header:
   * [1 byte stream_type, 3 bytes padding, 4 bytes big-endian length]
   */
  async streamContainerLogs(
    containerId: string,
    onLogChunk: (chunk: string) => void,
    tailLines = 100
  ): Promise<() => void> {
    const container = this.docker.getContainer(containerId);

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: tailLines,
      timestamps: false,
    });

    const outStream = new PassThrough();

    outStream.on('data', (chunk: Buffer) => {
      onLogChunk(chunk.toString('utf8'));
    });

    // Use Dockerode's native demux helper
    this.docker.modem.demuxStream(logStream, outStream, outStream);

    return () => {
      // Abort / close stream on disconnect
      logStream.destroy();
      outStream.destroy();
    };
  }

  /**
   * Creates a dedicated Docker named volume
   */
  async createNamedVolume(volumeName: string): Promise<void> {
    await this.docker.createVolume({
      Name: volumeName,
      Driver: 'local',
      Labels: { 'paas.volume': 'true' },
    });
  }
}
```

---

## 2. Executing Diagnostic Commands Inside Containers

For running database seed scripts, migrations (`prisma migrate deploy`), or ping checks, we use Docker's `exec` facility:

```typescript
export async function executeInContainer(
  container: Docker.Container,
  command: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const exec = await container.exec({
    Cmd: command,
    AttachStdout: true,
    AttachStderr: true,
  });

  return new Promise((resolve, reject) => {
    exec.start({}, (err, stream) => {
      if (err || !stream) return reject(err);

      let stdout = '';
      let stderr = '';

      container.modem.demuxStream(
        stream,
        { write: (chunk: Buffer) => (stdout += chunk.toString('utf8')) },
        { write: (chunk: Buffer) => (stderr += chunk.toString('utf8')) }
      );

      stream.on('end', async () => {
        const inspect = await exec.inspect();
        resolve({
          stdout,
          stderr,
          exitCode: inspect.ExitCode ?? 0,
        });
      });
    });
  });
}
```
