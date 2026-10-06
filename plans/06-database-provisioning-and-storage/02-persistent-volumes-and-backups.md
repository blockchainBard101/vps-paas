# 02. Persistent Storage, Automated Backups & Database Branching

Database reliability depends on persistent volume isolation, consistent backups, and point-in-time recovery. This document details our storage architecture, backup pipeline, and Neon-style database branching mechanism.

---

## 1. Storage Architecture & Named Volumes

All stateful containers store their data on Docker named volumes backed by the host's high-speed NVMe filesystem:

```
HOST FILESYSTEM (/var/lib/docker/volumes/)
├── paas-vol-pg-svc123/_data/       <──► Mounted into: /var/lib/postgresql/data
├── paas-vol-redis-svc456/_data/    <──► Mounted into: /data
└── paas-vol-uploads-svc789/_data/  <──► Mounted into: /app/uploads
```

### Advantages of Docker Named Volumes:
1. **Container Ephemerality**: Destroying, updating, or rebuilding the database container never deletes data on the volume.
2. **Native Performance**: Near-bare-metal I/O throughput without virtualization penalties.
3. **Backup Isolation**: Host-level tools can access the volume snapshot directly.

---

## 2. Automated Scheduled Backups (`pg_dump`)

The Control Plane schedules automated backups:
- **Frequency**: Every night at 02:00 UTC (configurable per project).
- **Format**: PostgreSQL custom archive format (`-Fc`), enabling parallel restores and built-in zlib compression.
- **Destination**: Dual destination (Local VPS storage `/var/lib/paas/backups/` and encrypted offsite S3 / Cloudflare R2 bucket).

### 2.1 Backup Runner Implementation

```typescript
// server/backups/BackupRunner.ts
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export async function createDatabaseBackup({
  serviceId,
  containerName,
  user = 'postgres',
  dbName = 'railway',
  backupDir = '/var/lib/paas/backups',
}: {
  serviceId: string;
  containerName: string;
  user?: string;
  dbName?: string;
  backupDir?: string;
}): Promise<string> {
  const serviceDir = path.join(backupDir, serviceId);
  fs.mkdirSync(serviceDir, { recursive: true });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(serviceDir, `backup-${timestamp}.dump`);
  const writeStream = fs.createWriteStream(filePath);

  // Execute pg_dump directly inside the running container via docker exec
  return new Promise((resolve, reject) => {
    const proc = spawn('docker', [
      'exec',
      '-i',
      containerName,
      'pg_dump',
      '-U', user,
      '-d', dbName,
      '-Fc', // PostgreSQL custom format
      '-Z', '6', // Compression level
    ]);

    proc.stdout.pipe(writeStream);

    proc.stderr.on('data', (data) => {
      console.warn(`pg_dump stderr: ${data.toString()}`);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Backup] Successfully created database backup: ${filePath}`);
        resolve(filePath);
      } else {
        reject(new Error(`pg_dump failed with exit code ${code}`));
      }
    });
  });
}
```

---

## 3. Database Branching (Neon-Style Ephemeral Clones)

A flagship feature of Neon is instant database branching for PRs and staging environments. We replicate this on our VPS using volume snapshots and stream restoration:

### 3.1 Branching Workflow
1. User clicks **"Create Database Branch"** (or PR preview environment boots).
2. The orchestrator triggers an atomic streaming dump of the parent database:
   ```bash
   docker exec -i paas-pg-parent pg_dump -U postgres -d railway -Fc | \
   docker exec -i paas-pg-child pg_restore -U postgres -d railway --clean --if-exists
   ```
3. A brand new isolated PostgreSQL container (`paas-pg-branch-pr42`) is provisioned with its own independent volume.
4. Developers test schema migrations, destructive seeds, or feature experiments without touching production data!
