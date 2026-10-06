# 02. Networking, DNS, and Dynamic Edge Routing

This document details the dual-network topology of the platform: private container-to-container internal communication and edge routing with automated TLS via Caddy v2's dynamic JSON API.

---

## 1. Dual-Network Architecture

The platform uses two isolated networking tiers:

```
                                  PUBLIC INTERNET
                                         │
                                         ▼
                     ┌───────────────────────────────────────┐
                     │          HOST PORTS: 80 / 443         │
                     │           Caddy v2 Edge Proxy         │
                     └───────────────────┬───────────────────┘
                                         │ Internal Proxy Calls
                                         ▼
┌────────────────────────────────────────────────────────────────────────┐
│             DOCKER BRIDGE NETWORK: "paas-internal-network"             │
│                                                                        │
│   ┌───────────────────────────┐      ┌───────────────────────────┐     │
│   │   Web Service: "api"      │      │   Web Service: "web"      │     │
│   │   IP: 172.28.0.12         │      │   IP: 172.28.0.14         │     │
│   │   Port: 3000              │      │   Port: 3000              │     │
│   └─────────────┬─────────────┘      └─────────────┬─────────────┘     │
│                 │                                  │                   │
│                 │   Inter-Container DNS:           │                   │
│                 │   "postgres:5432"                │                   │
│                 ▼                                  ▼                   │
│   ┌──────────────────────────────────────────────────────────────┐     │
│   │               Database Service: "postgres"                   │     │
│   │               IP: 172.28.0.20 | Port: 5432                   │     │
│   │               NO PUBLIC PORTS EXPOSED BY DEFAULT             │     │
│   └──────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────┘
```

### 1.1 Private Tier: `paas-internal-network`
- A dedicated Docker bridge network (`paas-internal-network`, subnet `172.28.0.0/16`).
- Containers on this network resolve each other by container name or network alias:
  - Container named `proj_prod_postgres` with network alias `postgres` can be accessed by any other container on the network via `postgres:5432`.
  - Database ports (`5432`, `6379`, `3306`) are **never mapped to host ports** (e.g., `-p 5432:5432` is omitted). This prevents arbitrary external port scans and attacks.

### 1.2 Public Tier: Caddy Edge Reverse Proxy
- Caddy runs on the host (or in a host-networked Docker container) listening on ports `80` (HTTP) and `443` (HTTPS).
- Caddy is also joined to `paas-internal-network` or proxies to internal container IPs directly.
- Caddy's dynamic administration endpoint is bound to `127.0.0.1:2019`.

---

## 2. Dynamic Routing with Caddy JSON API

Instead of writing static `Caddyfile` or `nginx.conf` files and reloading the server, the Control Plane communicates with Caddy's native **Dynamic JSON API**. This ensures zero dropped connections and sub-millisecond configuration changes.

### 2.1 Initial Caddy Base Configuration
On server bootstrap, Caddy is loaded with an HTTP server listening on `:80` and `:443`:

```json
{
  "admin": {
    "listen": "127.0.0.1:2019"
  },
  "apps": {
    "http": {
      "servers": {
        "srv0": {
          "listen": [":443"],
          "routes": []
        }
      }
    },
    "tls": {
      "automation": {
        "policies": [
          {
            "issuers": [
              {
                "module": "acme"
              }
            ]
          }
        ]
      }
    }
  }
}
```

### 2.2 Adding a Dynamic Route for a Newly Deployed Service
When a service container boots and passes its health check, the Control Plane executes:

```typescript
// Caddy Route Registration Service
export async function registerServiceRoute({
  domain,
  targetContainerName,
  targetPort = 3000,
  routeId,
}: {
  domain: string;
  targetContainerName: string;
  targetPort: number;
  routeId: string;
}) {
  const routePayload = {
    "@id": routeId,
    "match": [
      {
        "host": [domain]
      }
    ],
    "handle": [
      {
        "handler": "reverse_proxy",
        "upstreams": [
          {
            "dial": `${targetContainerName}:${targetPort}`
          }
        ],
        "headers": {
          "request": {
            "set": {
              "X-Forwarded-Proto": ["https"],
              "X-Forwarded-For": ["{http.request.remote.host}"]
            }
          }
        }
      }
    ],
    "terminal": true
  };

  const response = await fetch("http://127.0.0.1:2019/config/apps/http/servers/srv0/routes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(routePayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to register Caddy route: ${errorText}`);
  }
}
```

### 2.3 Atomic Blue/Green Route Swapping
When a new container version (`v2`) is healthy, we atomically swap the upstream without dropping a single packet:

```typescript
export async function swapServiceUpstream(routeId: string, newUpstreamDial: string) {
  // Update the upstreams array directly via Caddy ID pointer
  const response = await fetch(
    `http://127.0.0.1:2019/id/${routeId}/handle/0/upstreams`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify([{ dial: newUpstreamDial }]),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to swap upstream for route ${routeId}`);
  }
}
```

### 2.4 Removing a Route
When a service or deployment is deleted:

```typescript
export async function deleteServiceRoute(routeId: string) {
  await fetch(`http://127.0.0.1:2019/id/${routeId}`, {
    method: "DELETE",
  });
}
```

---

## 3. Automated Subdomain & Custom Domain Handling

### 3.1 Platform Subdomains (Wildcard DNS)
- Wildcard DNS record configured at your domain registrar:
  ```
  *.paas.yourdomain.com  IN A <VPS_STATIC_IPV4>
  *.paas.yourdomain.com  IN AAAA <VPS_STATIC_IPV6>
  ```
- Any service can immediately receive an endpoint like `my-api-production.paas.yourdomain.com`.
- Caddy automatically provisions an SSL certificate via ACME HTTP-01 or DNS-01 challenges.

### 3.2 Custom Domains (`api.customerdomain.com`)
- The developer points a `CNAME` or `A` record to the PaaS IP.
- Caddy's **On-Demand TLS** automatically issues a Let's Encrypt certificate upon the first incoming HTTPS request matching the domain:

```json
{
  "apps": {
    "tls": {
      "automation": {
        "on_demand": {
          "ask": "http://127.0.0.1:4000/api/v1/domains/validate-ownership"
        }
      }
    }
  }
}
```
> **Security Tip**: The `ask` endpoint prevents DDoS attacks where an attacker points millions of junk domains at your server to exhaust Let's Encrypt rate limits. The PaaS API returns HTTP 200 only if the custom domain is registered in the database for an active project.

---

## 4. Connecting to Databases: Internal vs External Access

1. **Internal Application Access (Zero Latency & Maximum Security)**:
   - Web applications communicate directly inside `paas-internal-network`.
   - Connection URL: `postgresql://postgres:pass@postgres:5432/dbname`.
   - Unencrypted internal wire speed; zero public internet exposure.

2. **External Client Access (DBeaver, TablePlus, psql)**:
   - For users wishing to connect desktop tools from their laptops, the PaaS provides an optional **TCP Port Proxy** (or SSH Bastion tunnel).
   - When external access is enabled, the PaaS allocates an ephemeral high port (e.g. `tcp.paas.yourdomain.com:15432`) mapped securely with TLS wrapping or password enforcement.
