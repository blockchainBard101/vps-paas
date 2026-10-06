import { Injectable, OnModuleInit } from '@nestjs/common';
import Docker from 'dockerode';

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

@Injectable()
export class DockerService implements OnModuleInit {
  private docker: Docker;

  constructor() {
    const macDockerSocket = path.join(os.homedir(), '.docker', 'run', 'docker.sock');
    const defaultSocket = fs.existsSync(macDockerSocket)
      ? macDockerSocket
      : '/var/run/docker.sock';

    const socketPath = process.env.DOCKER_SOCKET_PATH || defaultSocket;
    console.log(`[DockerService] Connecting to Docker socket at: ${socketPath}`);

    this.docker = new Docker({ socketPath });
  }

  async onModuleInit() {
    await this.ensureInternalNetwork();
  }

  get client(): Docker {
    return this.docker;
  }

  async ensureInternalNetwork(networkName = 'paas-internal-network'): Promise<void> {
    try {
      const networks = await this.docker.listNetworks();
      const exists = networks.some((n) => n.Name === networkName);
      if (!exists) {
        await this.docker.createNetwork({
          Name: networkName,
          Driver: 'bridge',
          CheckDuplicate: true,
        });
        console.log(`[DockerService] Created internal network: ${networkName}`);
      }
    } catch (err: any) {
      console.warn(`[DockerService] Network check notice: ${err.message}`);
    }
  }
}
