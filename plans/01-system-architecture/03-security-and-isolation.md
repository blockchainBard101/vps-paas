# 03. Security, Multi-Tenancy, and Container Isolation

This document outlines the security architecture for our self-hosted PaaS, protecting the host system from malicious user code, preventing cross-tenant resource contamination, and securing database credentials.

---

## 1. Docker Socket Hardening

Direct access to `/var/run/docker.sock` grants root-equivalent control over the host. To secure the control plane:

### 1.1 Socket Proxy Pattern (Least Privilege)
The Control Plane never accesses `/var/run/docker.sock` directly if running inside a container. Instead, it interacts through a restricted **Docker Socket Proxy** (`tecnativa/docker-socket-proxy`):

```yaml
# docker-compose.security.yml
services:
  docker-proxy:
    image: tecnativa/docker-socket-proxy:latest
    container_name: paas-docker-proxy
    restart: always
    environment:
      # Allowed read operations
      CONTAINERS: 1
      IMAGES: 1
      INFO: 1
      NETWORKS: 1
      VOLUMES: 1
      VERSION: 1
      # Allowed write operations
      POST: 1
      DELETE: 1
      # Strictly prohibited operations
      AUTH: 0
      SECRETS: 0
      SWARM: 0
      SYSTEM: 0
      BUILD: 1
      EXEC: 1
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
    ports:
      - "127.0.0.1:2375:2375"
    networks:
      - paas-control-network
```

---

## 2. Container Isolation & Resource Constraints (cgroups v2)

To prevent a single runaway process or crypto-miner from starving the host VPS, every container created by the PaaS must enforce strict kernel resource constraints.

### 2.1 Default Resource Quotas
When the orchestrator invokes `docker.createContainer()`, it injects these `HostConfig` parameters:

| Resource | Default Quota | Maximum Tier | Prevention Goal |
| :--- | :--- | :--- | :--- |
| **Memory** | 512 MB | 8 GB | Out-of-Memory (OOM) host crashes |
| **Swap** | 0 MB (Disabled) | 1 GB | Host disk trashing / swapping latency |
| **CPU Quota** | 1.0 vCPU (`100000 / 100000`) | 4.0 vCPUs | CPU 100% starvation |
| **PIDs Limit** | 256 processes | 1024 processes | Fork bombs (`:(){ :|:& };:`) |
| **Disk Storage** | 10 GB per container | 100 GB | Disk space exhaustion |
| **No-New-Privileges**| `true` | `true` | Privilege escalation prevention |

### 2.2 Dockerode Resource Implementation Snippet

```typescript
const containerOptions: Docker.ContainerCreateOptions = {
  Image: imageName,
  name: containerName,
  HostConfig: {
    // Memory Limit: 512 MB
    Memory: 512 * 1024 * 1024,
    // Disable Swap to prevent swapping to host disk
    MemorySwap: 512 * 1024 * 1024,
    // CPU: 1 vCPU (100,000 microseconds per 100,000 period)
    CpuPeriod: 100000,
    CpuQuota: 100000,
    // Prevent fork bombs
    PidsLimit: 256,
    // Drop Linux capabilities & prevent privilege escalation
    SecurityOpt: ['no-new-privileges:true'],
    CapDrop: ['ALL'],
    CapAdd: ['CHOWN', 'DAC_OVERRIDE', 'SETGID', 'SETUID', 'NET_BIND_SERVICE'],
    RestartPolicy: { Name: 'unless-stopped', MaximumRetryCount: 5 },
  },
};
```

---

## 3. Encrypted Secret Vault (Zero-Plaintext at Rest)

Environment variables and database root credentials must never be stored as plaintext in the Control Plane database.

### 3.1 Envelope Encryption Scheme (AES-256-GCM)
- Every project has an internal `project_secret_key` generated on creation.
- The platform Master Key (`ENCRYPTION_MASTER_KEY`) is stored as a secure host environment variable.
- Variables are encrypted using AES-256-GCM with a unique 12-byte initialization vector (IV) per record.

```typescript
import crypto from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const MASTER_KEY = Buffer.from(process.env.ENCRYPTION_MASTER_KEY!, 'hex'); // 32 bytes

export function encryptSecret(plainText: string): { cipherText: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, MASTER_KEY, iv);
  
  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    cipherText: encrypted,
    iv: iv.toString('hex'),
    tag,
  };
}

export function decryptSecret(cipherText: string, ivHex: string, tagHex: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, MASTER_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  
  let decrypted = decipher.update(cipherText, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}
```

---

## 4. SQL Execution Safety & Query Runner Guardrails

Because the platform provides a built-in Neon-style SQL Runner, we must protect the system against accidental destruction and resource lockups.

### 4.1 Statement Timeout Enforcement
Every connection checked out from the pool for user-initiated queries executes inside a strict timeout:

```sql
-- Automatically injected before every interactive query
SET statement_timeout = 15000; -- 15 seconds max execution
SET idle_in_transaction_session_timeout = 30000; -- 30 seconds max idle
SET lock_timeout = 5000; -- 5 seconds lock wait timeout
```

### 4.2 Read-Only Mode Switch
Users can toggle **"Safe / Read-Only Mode"** in the UI:
```sql
BEGIN TRANSACTION READ ONLY;
-- User query executed here
COMMIT;
```
If an `INSERT`, `UPDATE`, `DROP`, or `ALTER` statement is submitted while Safe Mode is enabled, PostgreSQL native engine automatically aborts the transaction with code `25006` (`read_only_sql_transaction`).

### 4.3 Query Cancellation Architecture
If a user submits an intensive calculation and clicks **"Cancel Query"**, the frontend sends a cancellation request. The backend identifies the PostgreSQL backend PID and executes:
```typescript
await adminClient.query('SELECT pg_cancel_backend($1)', [runningPid]);
```
This terminates the specific running query without tearing down the client connection or restarting the database container.
