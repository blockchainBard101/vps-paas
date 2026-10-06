# 04. Dynamic Database Connection Pooler & Connection Security

In a multi-tenant PaaS, hundreds of PostgreSQL containers may be running simultaneously. The Control Plane cannot maintain permanent, active connection pools to every single database container, as this would exhaust host memory and Postgres `max_connections`.

This document details our **Dynamic Connection Pool Manager**, which opens connections on-demand and reclaims them after periods of inactivity.

---

## 1. Dynamic Pool Manager Architecture

```
User selects "users" table
           │
           ▼
┌────────────────────────────────────────────────────────┐
│ Control Plane Dynamic Database Connection Manager      │
│                                                        │
│ 1. Check LRU Cache for pool: `service_${serviceId}`     │
│    ├── Hit: Reuse existing warm pool                   │
│    └── Miss:                                           │
│         - Decrypt DB credentials from vault            │
│         - Resolve internal IP: `containerName:5432`    │
│         - Instantiate new `pg.Pool` (max: 5 conn)      │
│         - Set 10-minute idle eviction timer            │
│                                                        │
│ 2. Acquire connection, run query, release to pool      │
└──────────────────────────┬─────────────────────────────┘
                           │ TCP Wire Protocol
                           ▼
           ┌───────────────────────────────┐
           │ Target PostgreSQL Container   │
           │ (Internal Docker Bridge)      │
           └───────────────────────────────┘
```

---

## 2. Dynamic Pool Manager Implementation

```typescript
// services/DatabasePoolManager.ts
import { Pool, PoolConfig } from 'pg';

interface PoolEntry {
  pool: Pool;
  lastUsedAt: number;
  serviceId: string;
}

export class DatabasePoolManager {
  private pools = new Map<string, PoolEntry>();
  private readonly IDLE_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    // Periodic sweep for idle database pools
    setInterval(() => this.cleanupIdlePools(), 60 * 1000);
  }

  /**
   * Retrieves an existing pool or creates a new one for the specified service
   */
  async getPoolForService(
    serviceId: string,
    connectionConfig: {
      host: string;
      port: number;
      database: string;
      user: string;
      password: string;
    }
  ): Promise<Pool> {
    const existing = this.pools.get(serviceId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.pool;
    }

    // Configure lean pool size for PaaS introspection & query tasks
    const poolConfig: PoolConfig = {
      host: connectionConfig.host,
      port: connectionConfig.port,
      database: connectionConfig.database,
      user: connectionConfig.user,
      password: connectionConfig.password,
      max: 5, // Maximum 5 connections per DB for studio queries
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

    const newPool = new Pool(poolConfig);

    // Verify connectivity immediately
    const client = await newPool.connect();
    client.release();

    this.pools.set(serviceId, {
      pool: newPool,
      lastUsedAt: Date.now(),
      serviceId,
    });

    return newPool;
  }

  /**
   * Closes and removes an individual pool (e.g. when database is deleted or restarted)
   */
  async closePool(serviceId: string): Promise<void> {
    const entry = this.pools.get(serviceId);
    if (entry) {
      await entry.pool.end();
      this.pools.delete(serviceId);
    }
  }

  /**
   * Evicts pools that have not been touched for over 10 minutes
   */
  private async cleanupIdlePools(): Promise<void> {
    const now = Date.now();
    for (const [serviceId, entry] of this.pools.entries()) {
      if (now - entry.lastUsedAt > this.IDLE_TIMEOUT_MS) {
        console.log(`[DatabasePoolManager] Evicting idle connection pool for service ${serviceId}`);
        await entry.pool.end().catch((err) => console.error('Error closing pool:', err));
        this.pools.delete(serviceId);
      }
    }
  }
}
```

---

## 3. Query Cancellation Engine

When a developer clicks **"Cancel Query"** in the UI, we avoid severing the pool connection; instead, we cancel the backend PostgreSQL execution:

```typescript
export async function cancelRunningQuery({
  serviceId,
  backendPid,
  pool,
}: {
  serviceId: string;
  backendPid: number;
  pool: Pool;
}) {
  const adminClient = await pool.connect();
  try {
    // Invokes PostgreSQL's native process cancellation
    const res = await adminClient.query('SELECT pg_cancel_backend($1) as cancelled', [backendPid]);
    return res.rows[0]?.cancelled ?? false;
  } finally {
    adminClient.release();
  }
}
```

---

## 4. Guardrails & Dangerous DDL Interceptors

To prevent accidental catastrophes while using the Studio:
1. **Drop Database Interceptor**: Direct commands like `DROP DATABASE` or `DROP SCHEMA public CASCADE` require typing the database name in a confirmation modal.
2. **Transaction Rollback on Error**: All multi-cell batch updates are wrapped in `BEGIN ... COMMIT` blocks; if a single row constraint fails, the entire batch rolls back, preventing partial data corruption.
