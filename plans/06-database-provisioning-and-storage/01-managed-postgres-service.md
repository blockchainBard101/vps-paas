# 01. Managed PostgreSQL & Redis 1-Click Provisioning

One of Railway's core attractions is clicking "Add PostgreSQL" and instantly getting a fully configured database ready to connect. This document details our containerized database provisioner for PostgreSQL 16 and Redis 7.

---

## 1. Automated PostgreSQL 16 Provisioning Flow

When a user adds a PostgreSQL database node on the canvas:

```
[User clicks "+ Add PostgreSQL"]
               │
               ▼
1. Generate cryptographically strong password (32 chars)
2. Create dedicated Docker volume: `proj_{projectId}_pgdata_{cuid}`
3. Spawn `postgres:16-alpine` on `paas-internal-network`
4. Wait for TCP 5432 readiness check
5. Execute initial SQL migration to enable essential extensions:
   - `uuid-ossp` (UUID generation)
   - `pgcrypto` (Hashing & encryption functions)
   - `citext` (Case-insensitive text)
6. Register internal connection string:
   `postgresql://postgres:<password>@<container_name>:5432/<dbname>`
7. Initialize schema introspection cache
```

---

## 2. PostgreSQL Provisioner Implementation

```typescript
// server/provisioners/PostgresProvisioner.ts
import Docker from 'dockerode';
import crypto from 'node:crypto';
import { Client } from 'pg';

export interface ProvisionPostgresResult {
  serviceName: string;
  containerId: string;
  volumeName: string;
  databaseName: string;
  user: string;
  password: string;
  internalDns: string;
  connectionUrl: string;
}

export class PostgresProvisioner {
  constructor(private docker: Docker) {}

  async provision({
    projectId,
    serviceId,
    dbName = 'railway',
  }: {
    projectId: string;
    serviceId: string;
    dbName?: string;
  }): Promise<ProvisionPostgresResult> {
    const password = crypto.randomBytes(16).toString('hex');
    const containerName = `paas-pg-${serviceId}`;
    const volumeName = `paas-vol-pg-${serviceId}`;

    // 1. Create persistent Docker volume
    await this.docker.createVolume({ Name: volumeName });

    // 2. Spawn Postgres 16 container with tuned runtime parameters
    const container = await this.docker.createContainer({
      Image: 'postgres:16-alpine',
      name: containerName,
      Env: [
        `POSTGRES_DB=${dbName}`,
        `POSTGRES_USER=postgres`,
        `POSTGRES_PASSWORD=${password}`,
        `PGDATA=/var/lib/postgresql/data/pgdata`,
      ],
      Cmd: [
        'postgres',
        '-c', 'shared_buffers=128MB',
        '-c', 'max_connections=100',
        '-c', 'work_mem=4MB',
        '-c', 'maintenance_work_mem=32MB',
      ],
      HostConfig: {
        Binds: [`${volumeName}:/var/lib/postgresql/data`],
        NetworkMode: 'paas-internal-network',
        RestartPolicy: { Name: 'unless-stopped' },
        Memory: 1024 * 1024 * 1024, // 1 GB RAM quota
        MemorySwap: 1024 * 1024 * 1024,
        CpuQuota: 100000, // 1 vCPU
      },
      Labels: {
        'paas.service.type': 'postgres',
        'paas.project.id': projectId,
      },
    });

    await container.start();

    // 3. Wait for database readiness
    const inspectData = await container.inspect();
    const containerIp = inspectData.NetworkSettings.Networks['paas-internal-network'].IPAddress;

    await this.waitForPostgresReady(containerIp, password, dbName);

    // 4. Enable standard extensions
    await this.enableExtensions(containerIp, password, dbName);

    const internalDns = containerName;
    const connectionUrl = `postgresql://postgres:${password}@${internalDns}:5432/${dbName}`;

    return {
      serviceName: containerName,
      containerId: container.id,
      volumeName,
      databaseName: dbName,
      user: 'postgres',
      password,
      internalDns,
      connectionUrl,
    };
  }

  private async waitForPostgresReady(ip: string, pass: string, db: string): Promise<void> {
    for (let i = 0; i < 30; i++) {
      try {
        const client = new Client({
          host: ip,
          port: 5432,
          user: 'postgres',
          password: pass,
          database: db,
          connectionTimeoutMillis: 1500,
        });
        await client.connect();
        await client.query('SELECT 1');
        await client.end();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    throw new Error('PostgreSQL container failed to become ready within 30 seconds');
  }

  private async enableExtensions(ip: string, pass: string, db: string): Promise<void> {
    const client = new Client({
      host: ip,
      port: 5432,
      user: 'postgres',
      password: pass,
      database: db,
    });
    await client.connect();
    await client.query(`
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";
      CREATE EXTENSION IF NOT EXISTS "citext";
    `);
    await client.end();
  }
}
```

---

## 3. Automated Redis 7 Provisioning

Redis instances are provisioned with password authentication and persistent disk append-only logs (`AOF`):

```typescript
export async function provisionRedisInstance(docker: Docker, serviceId: string) {
  const password = crypto.randomBytes(16).toString('hex');
  const containerName = `paas-redis-${serviceId}`;
  const volumeName = `paas-vol-redis-${serviceId}`;

  await docker.createVolume({ Name: volumeName });

  const container = await docker.createContainer({
    Image: 'redis:7-alpine',
    name: containerName,
    Cmd: ['redis-server', '--requirepass', password, '--appendonly', 'yes'],
    HostConfig: {
      Binds: [`${volumeName}:/data`],
      NetworkMode: 'paas-internal-network',
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 256 * 1024 * 1024, // 256 MB quota
    },
  });

  await container.start();

  return {
    containerId: container.id,
    redisUrl: `redis://:${password}@${containerName}:6379`,
  };
}
```
