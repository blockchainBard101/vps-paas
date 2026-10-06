# 03. Zero-Downtime Blue/Green Deployments & Health Checks

Dropping HTTP requests during deployments is unacceptable. This document specifies our Blue/Green rolling deployment engine, health check polling loop, and automated rollback state machine.

---

## 1. Zero-Downtime Lifecycle State Machine

```
   ┌────────────────────────────────────────────────────────┐
   │ 1. Current State: Container v1 Active on Caddy Proxy   │
   └───────────────────────────┬────────────────────────────┘
                               │
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 2. Build Image v2 & Launch Container v2 on Bridge Net  │
   │    (v1 continues serving 100% of live traffic)         │
   └───────────────────────────┬────────────────────────────┘
                               │
                               ▼
   ┌────────────────────────────────────────────────────────┐
   │ 3. Poll Health Check Endpoint (e.g. GET /health)       │
   │    Interval: 1000ms | Max Retries: 30 (30 seconds)     │
   └───────────────┬────────────────────────┬───────────────┘
                   │ Success (200 OK)       │ Timeout / Error
                   ▼                        ▼
┌─────────────────────────────────────┐  ┌───────────────────────────────────┐
│ 4. Atomic Caddy Upstream Swap       │  │ 4b. Rollback & Abort              │
│    Route dials v2 container         │  │     Destroy v2 container          │
│    v2 now serves all live traffic   │  │     v1 continues running smoothly │
└──────────────────┬──────────────────┘  │     Mark deployment FAILED        │
                   │                     └───────────────────────────────────┘
                   ▼
┌─────────────────────────────────────┐
│ 5. Graceful Drain of Container v1   │
│    Send SIGTERM, wait 15 seconds    │
│    Remove v1 container              │
└─────────────────────────────────────┘
```

---

## 2. Health Checker Implementation

```typescript
// server/orchestrator/HealthChecker.ts
export class HealthChecker {
  /**
   * Polls a container's health endpoint until it returns HTTP 200 or times out
   */
  static async waitForHealthy({
    containerIp,
    port = 3000,
    path = '/health',
    maxRetries = 30,
    intervalMs = 1000,
  }: {
    containerIp: string;
    port?: number;
    path?: string;
    maxRetries?: number;
    intervalMs?: number;
  }): Promise<boolean> {
    const url = `http://${containerIp}:${port}${path}`;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 2000);

        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeout);

        if (response.status >= 200 && response.status < 400) {
          console.log(`[HealthCheck] Container healthy on attempt ${attempt}`);
          return true;
        }
      } catch (err) {
        // Service not yet accepting connections
      }

      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    return false;
  }
}
```

---

## 3. Atomic Blue/Green Rollout Runner

```typescript
// server/orchestrator/DeploymentRunner.ts
export async function executeBlueGreenDeployment({
  serviceId,
  newImageTag,
  routeId,
}: {
  serviceId: string;
  newImageTag: string;
  routeId: string;
}) {
  const service = await db.service.findUniqueOrThrow({ where: { id: serviceId } });
  const oldContainerId = service.activeContainerId;

  // 1. Launch new container (v2 / Green)
  const newContainer = await dockerOrchestrator.createServiceContainer({
    name: `${service.name}-${Date.now()}`,
    image: newImageTag,
    networkName: 'paas-internal-network',
    env: await resolveServiceVariables(serviceId),
  });

  await newContainer.start();
  const inspectData = await newContainer.inspect();
  const newIp = inspectData.NetworkSettings.Networks['paas-internal-network'].IPAddress;

  // 2. Perform Health Check
  const isHealthy = await HealthChecker.waitForHealthy({
    containerIp: newIp,
    port: service.internalPort,
  });

  if (!isHealthy) {
    console.error(`[Deployment] Health check failed for new container. Aborting.`);
    await dockerOrchestrator.stopAndRemove(newContainer.id);
    throw new Error('Health check failed: Container did not respond with HTTP 200');
  }

  // 3. Atomically swap Caddy route upstream to the new container
  await swapServiceUpstream(routeId, `${newContainer.id}:${service.internalPort}`);

  // 4. Update Database record with new active container
  await db.service.update({
    where: { id: serviceId },
    data: { activeContainerId: newContainer.id, healthStatus: 'HEALTHY' },
  });

  // 5. Graceful drain and cleanup of old container (v1 / Blue)
  if (oldContainerId) {
    console.log(`[Deployment] Draining and stopping old container: ${oldContainerId}`);
    setTimeout(async () => {
      await dockerOrchestrator.stopAndRemove(oldContainerId, 15);
    }, 5000);
  }
}
```
