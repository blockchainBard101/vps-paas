# Phase 1: Core Docker Engine & Database Provisioner Implementation

This implementation guide provides the exact steps and code required to build the foundational Phase 1 milestone: connecting to Docker, provisioning an isolated PostgreSQL 16 container, and outputting connection credentials.

---

## 1. Project Initialization

Initialize a new Next.js 15 application with Tailwind CSS and TypeScript:

```bash
npx create-next-app@latest paas-core --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd paas-core
npm install dockerode pg dotenv lucide-react
npm install -D @types/dockerode @types/pg
```

---

## 2. Docker Client Setup

Create the singleton Dockerode client connecting to the local Docker daemon:

```typescript
// src/lib/docker.ts
import Docker from 'dockerode';

// Connect to Docker daemon via local Unix socket
export const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
});
```

---

## 3. Database Provisioning Server Action

Implement the Next.js Server Action to provision a PostgreSQL container:

```typescript
// src/app/actions/database.ts
'use server';

import { docker } from '@/lib/docker';
import crypto from 'node:crypto';
import { Client } from 'pg';

export interface ProvisionedDatabase {
  serviceId: string;
  containerId: string;
  name: string;
  dbName: string;
  connectionUrl: string;
}

export async function provisionDatabaseAction(formData: FormData): Promise<ProvisionedDatabase> {
  const serviceName = (formData.get('name') as string) || 'my-postgres';
  const serviceId = crypto.randomBytes(4).toString('hex');
  const password = crypto.randomBytes(16).toString('hex');
  const containerName = `paas-pg-${serviceId}`;
  const volumeName = `paas-vol-${serviceId}`;
  const dbName = 'railway';

  // 1. Ensure internal bridge network exists
  const networks = await docker.listNetworks();
  if (!networks.some((n) => n.Name === 'paas-internal-network')) {
    await docker.createNetwork({ Name: 'paas-internal-network', Driver: 'bridge' });
  }

  // 2. Create persistent volume
  await docker.createVolume({ Name: volumeName });

  // 3. Create & start Postgres container
  const container = await docker.createContainer({
    Image: 'postgres:16-alpine',
    name: containerName,
    Env: [
      `POSTGRES_DB=${dbName}`,
      `POSTGRES_USER=postgres`,
      `POSTGRES_PASSWORD=${password}`,
    ],
    HostConfig: {
      Binds: [`${volumeName}:/var/lib/postgresql/data`],
      NetworkMode: 'paas-internal-network',
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 512 * 1024 * 1024, // 512 MB
    },
  });

  await container.start();

  // 4. Retrieve container internal IP
  const inspect = await container.inspect();
  const ip = inspect.NetworkSettings.Networks['paas-internal-network'].IPAddress;

  // 5. Wait for readiness
  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const client = new Client({
        host: ip,
        port: 5432,
        user: 'postgres',
        password,
        database: dbName,
        connectionTimeoutMillis: 1000,
      });
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  if (!ready) {
    throw new Error('Database container started but failed readiness health check.');
  }

  const connectionUrl = `postgresql://postgres:${password}@${containerName}:5432/${dbName}`;

  return {
    serviceId,
    containerId: container.id,
    name: serviceName,
    dbName,
    connectionUrl,
  };
}
```

---

## 4. 1-Click Provisioning UI

```tsx
// src/app/page.tsx
'use client';

import React, { useState } from 'react';
import { provisionDatabaseAction, ProvisionedDatabase } from './actions/database';
import { Database, Copy, Check, Loader2, Play } from 'lucide-react';

export default function Phase1Dashboard() {
  const [loading, setLoading] = useState(false);
  const [db, setDb] = useState<ProvisionedDatabase | null>(null);
  const [copied, setCopied] = useState(false);

  async function handleProvision(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    try {
      const formData = new FormData(e.currentTarget);
      const result = await provisionDatabaseAction(formData);
      setDb(result);
    } catch (err: any) {
      alert(`Provisioning failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard() {
    if (!db) return;
    navigator.clipboard.writeText(db.connectionUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 pb-6 border-b border-zinc-800">
          <div className="p-2.5 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
            <Database className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Provision Managed PostgreSQL</h1>
            <p className="text-xs text-zinc-400">Spawn an isolated Docker container with persistent NVMe storage</p>
          </div>
        </div>

        <form onSubmit={handleProvision} className="mt-6 space-y-4">
          <div>
            <label className="block text-xs font-medium text-zinc-300 mb-1.5">Service Name</label>
            <input
              name="name"
              defaultValue="production-postgres"
              className="w-full px-3.5 py-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-sm focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-medium text-sm rounded-lg flex items-center justify-center gap-2 transition-colors shadow-lg shadow-indigo-600/20"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4 fill-current" />}
            <span>{loading ? 'Provisioning Container...' : '1-Click Add Database'}</span>
          </button>
        </form>

        {db && (
          <div className="mt-8 p-4 bg-zinc-950 rounded-xl border border-emerald-500/30 space-y-3">
            <div className="flex items-center justify-between text-xs text-emerald-400 font-medium">
              <span>✔ Database Provisioned & Running</span>
              <span className="font-mono text-zinc-500">ID: {db.serviceId}</span>
            </div>

            <div>
              <span className="text-[11px] text-zinc-400 block mb-1">Internal Connection URL:</span>
              <div className="flex items-center gap-2 bg-zinc-900 p-2.5 rounded-lg border border-zinc-800 font-mono text-xs text-zinc-200 break-all">
                <span className="flex-1">{db.connectionUrl}</span>
                <button
                  onClick={copyToClipboard}
                  className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded text-zinc-300 transition-colors"
                  title="Copy URL"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```
