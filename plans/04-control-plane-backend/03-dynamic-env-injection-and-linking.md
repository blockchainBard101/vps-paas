# 03. Cross-Service Environment Variable Interpolation & Linking

Railway's greatest developer experience advantage is that environment variables can dynamically reference outputs from other services (e.g. `${{ postgres.DATABASE_URL }}`). This document specifies the interpolation engine, dependency graph resolution, and cascading update cycle.

---

## 1. Variable Reference Syntax

Variables support Railway-style handlebars-like interpolation:

| Expression | Resolves To | Example Output |
| :--- | :--- | :--- |
| `${{ postgres.DATABASE_URL }}` | Full PostgreSQL connection string | `postgresql://postgres:pass@proj_postgres:5432/db` |
| `${{ postgres.PGPORT }}` | Internal database port | `5432` |
| `${{ redis.REDIS_URL }}` | Redis connection string | `redis://:secret@proj_redis:6379` |
| `${{ self.PORT }}` | Container internal port | `3000` |
| `${{ caddy.DOMAIN }}` | Assigned public domain | `app-prod.paas.example.com` |

---

## 2. Dependency Graph Resolution (DAG)

Services form a Directed Acyclic Graph (DAG) based on variable references:

```
[Postgres Database] ───────────────┐
                                  ├──► [Backend API] ──► [Frontend Web]
[Redis Cache] ─────────────────────┘
```

### 2.1 Cycle Detection & Topological Sort
Before launching or updating an environment, the Control Plane performs a topological sort:
- If Service A references Service B, and Service B references Service A, an error is raised: `Circular dependency detected between Service A and Service B`.
- Services are initialized in topological order: Databases first, followed by APIs, followed by Web Frontends.

---

## 3. Variable Interpolation Resolver Implementation

```typescript
// server/services/VariableInterpolationService.ts
export interface ServiceContext {
  id: string;
  name: string;
  type: string;
  internalDns: string;
  exposedPort: number;
  rawVariables: Record<string, string>; // Decrypted key-value map
}

export class VariableInterpolationService {
  /**
   * Resolves all ${{ ServiceName.KEY }} expressions in a service's environment variables
   */
  static resolveVariables(
    targetService: ServiceContext,
    allServicesInEnv: ServiceContext[]
  ): string[] {
    const serviceMap = new Map<string, ServiceContext>();
    for (const s of allServicesInEnv) {
      serviceMap.set(s.name.toLowerCase(), s);
    }

    const resolvedEntries: string[] = [];
    const regex = /\$\{\{\s*([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_]+)\s*\}\}/g;

    for (const [key, rawValue] of Object.entries(targetService.rawVariables)) {
      const substituted = rawValue.replace(regex, (match, serviceRef, varKey) => {
        const refLower = serviceRef.toLowerCase();

        // Handle "self" reference
        if (refLower === 'self') {
          if (varKey === 'PORT') return String(targetService.exposedPort);
          return targetService.rawVariables[varKey] || '';
        }

        const sourceService = serviceMap.get(refLower);
        if (!sourceService) {
          console.warn(`[VariableResolver] Unknown service reference: ${serviceRef}`);
          return match;
        }

        // Handle virtual properties
        if (varKey === 'HOST') return sourceService.internalDns;
        if (varKey === 'PORT') return String(sourceService.exposedPort);

        // Handle standard variables
        return sourceService.rawVariables[varKey] || '';
      });

      resolvedEntries.push(`${key}=${substituted}`);
    }

    return resolvedEntries;
  }
}
```

---

## 4. Cascading Updates & Automated Redeployments

When a database password or port is rotated:
1. The Control Plane updates the database service variables.
2. The orchestrator queries `ServiceEdge` where `sourceId = postgres.id`.
3. For every dependent service (e.g. `api-backend`), the Control Plane:
   - Re-evaluates variable interpolation.
   - Marks the service state as `Pending Restart`.
   - Issues a rolling container restart so the running process picks up the new credentials.
