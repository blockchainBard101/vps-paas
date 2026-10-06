# Railway + Neon PaaS: Complete Architecture & Implementation Blueprint

An open-source, self-hosted Platform-as-a-Service (PaaS) combining **Railway's visual canvas orchestration** with **Neon's built-in database table viewer and SQL runner**. Designed to run on a single VPS or scale across multi-node infrastructure using Docker, Nixpacks, Caddy, Next.js 15, and `@xyflow/react`.

---

## 🌟 Vision & Key Capabilities

1. **Railway-Style Interactive Canvas**:
   - Visual nodes for Web Services, Background Workers, PostgreSQL, Redis, and Persistent Volumes powered by `@xyflow/react`.
   - Drag-to-connect dependency wiring: dragging a wire from PostgreSQL to a Web Service automatically injects `DATABASE_URL` and internal networking aliases.
   - Real-time pulsating status indicators, CPU/RAM resource gauges, and dynamic deployment timelines.

2. **Neon-Style Embedded Database Studio**:
   - Built-in visual **Table Editor** for provisioned PostgreSQL instances: inspect schemas, sort, filter, and paginate millions of rows with virtualized scrolling.
   - Inline cell editing, foreign-key relationship traversal, row insertion, and batch commits.
   - Integrated **Monaco SQL Runner** with intelligent auto-completion derived from live database introspection, query execution plans (`EXPLAIN ANALYZE`), and CSV/JSON exports.

3. **Automated Nixpacks & Dockerfile Builds**:
   - Zero-configuration application deployments: push code, and Nixpacks auto-detects Node.js, Python, Go, Rust, Ruby, PHP, and builds optimized OCI containers.
   - Streaming raw build and runtime logs over WebSockets directly into `@xterm/xterm`.

4. **Dynamic Edge Routing with Caddy**:
   - Zero-downtime Blue/Green deployments.
   - Automated subdomains (`project-service.yourdomain.com`) and custom domain mapping via Caddy's dynamic JSON API.
   - Automated SSL/TLS certificates via Let's Encrypt / ZeroSSL without server restarts.

---

## 🏗️ High-Level System Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (Next.js 15 App Router + React 19)                     │
│  ┌─────────────────────────┐  ┌───────────────────────────┐  ┌───────────────────────┐ │
│  │   Interactive Canvas    │  │     Neon Table Viewer     │  │   Monaco SQL Runner   │ │
│  │   (@xyflow/react Nodes) │  │  (Virtualized Data Grid)  │  │   (Introspect & Run)  │ │
│  └────────────┬────────────┘  └─────────────┬─────────────┘  └───────────┬───────────┘ │
│               │                             │                            │             │
│               │  Real-Time WebSocket / SSE  │   tRPC / REST Client       │             │
│               └─────────────────────────────┼────────────────────────────┘             │
└─────────────────────────────────────────────┼──────────────────────────────────────────┘
                                              ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                       CONTROL PLANE (Fastify / NestJS / tRPC)                          │
│  ┌───────────────────────┐  ┌─────────────────────────────┐  ┌───────────────────────┐ │
│  │  Canvas & Topology    │  │   Database Introspection    │  │  Build & Queue Worker │ │
│  │  Service Graph Engine │  │   & Connection Pool Manager │  │  (Nixpacks / Git CLI) │ │
│  └───────────┬───────────┘  └──────────────┬──────────────┘  └───────────┬───────────┘ │
│              │                             │                             │             │
│              │ Dockerode API               │ PostgreSQL (TCP 5432)       │ Child Proc  │
└──────────────┼─────────────────────────────┼─────────────────────────────┼─────────────┘
               ▼                             ▼                             ▼
┌──────────────────────────────┐ ┌───────────────────────────┐ ┌─────────────────────────┐
│     DOCKER ENGINE DAEMON     │ │  INTERNAL DOCKER BRIDGE   │ │    EDGE REVERSE PROXY   │
│ - Web Services (Containers)  │ │   ("paas-internal-net")   │ │  - Caddy Dynamic API    │
│ - Managed Postgres Databases │ │ - Isolated service DNS    │ │  - Auto-SSL Certificates│
│ - Redis Caches               │ │ - Inter-container traffic │ │  - Zero-downtime routing│
│ - Named Volumes (Data)       │ │ - DB access by service IP │ │  - Custom domain proxy  │
└──────────────────────────────┘ └───────────────────────────┘ └─────────────────────────┘
```

---

## 📁 Blueprint Folder Structure

The complete architectural specifications, database schemas, API contracts, and implementation source code are organized into the following modules:

```
vps/
├── README.md                                    # This master blueprint document
└── plans/
    ├── 01-system-architecture/                  # Global topology, networking, security
    │   ├── 01-high-level-architecture.md        # Comprehensive multi-layer architecture
    │   ├── 02-networking-and-routing.md         # Caddy API, Docker networks, DNS, SSL
    │   └── 03-security-and-isolation.md         # Docker socket hardening, cgroups, secret vault
    │
    ├── 02-neon-database-viewer/                 # Neon-style DB Studio implementation
    │   ├── 01-neon-table-editor-architecture.md # Virtualized grid, inline cell editing, FK nav
    │   ├── 02-database-introspection-engine.md  # PostgreSQL catalog queries & schema analyzer
    │   ├── 03-sql-runner-and-monaco-editor.md   # Monaco SQL editor, EXPLAIN visualizer, safe runs
    │   └── 04-connection-pooler-and-security.md # Dynamic pg-pool manager, timeouts, cancellation
    │
    ├── 03-frontend-canvas-and-ui/               # Railway canvas & terminal experience
    │   ├── 01-railway-canvas-xyflow.md          # React Flow nodes, edge wiring, env linking
    │   ├── 02-terminal-logs-and-metrics.md      # xterm.js WebSockets, CPU/RAM micro-charts
    │   └── 03-design-system-and-components.md   # Zinc dark theme, glassmorphism, slide-overs
    │
    ├── 04-control-plane-backend/                # Core orchestrator & topology management
    │   ├── 01-api-and-database-schema.md        # Prisma schema, project graph, tRPC routers
    │   ├── 02-docker-orchestrator-dockerode.md  # Dockerode wrapper, container lifecycle
    │   ├── 03-dynamic-env-injection-and-linking.md# Variable templating ${{ Postgres.DATABASE_URL }}
    │   └── 04-auth-teams-and-rbac.md            # Browser login, multi-tenant orgs, team invites & RBAC
    │
    ├── 05-build-and-deploy-pipeline/            # Build automation & deployments
    │   ├── 01-nixpacks-build-engine.md          # Nixpacks CLI builder, multi-language detection
    │   ├── 02-git-integration-and-webhooks.md   # GitHub Webhooks, PR ephemeral environments
    │   └── 03-zero-downtime-deployments.md      # Blue-Green canary swapping with health checks
    │
    ├── 06-database-provisioning-and-storage/    # Managed data stores & volumes
    │   ├── 01-managed-postgres-service.md       # 1-click Postgres 16 & Redis provisioners
    │   └── 02-persistent-volumes-and-backups.md # Docker volumes, automated pg_dump, S3 snapshots
    │
    └── 07-implementation-roadmap-and-code/      # Step-by-step build guides with working code
        ├── 01-phase-1-core-docker-and-db-provisioner.md  # Phase 1: DB container provisioning
        ├── 02-phase-2-neon-table-viewer-implementation.md# Phase 2: Neon table viewer & SQL editor
        ├── 03-phase-3-canvas-and-realtime-logs.md        # Phase 3: React Flow canvas & xterm logs
        ├── 04-phase-4-nixpacks-and-caddy-routing.md      # Phase 4: Nixpacks engine & Caddy routing
        └── 05-phase-5-production-deployment-guide.md     # Phase 5: Production VPS deployment
```

---

## 🛠️ Recommended Technology Stack

| Layer | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend Framework** | **Next.js 15 (React 19)** | App Router, Server Actions, SSR & Streaming UI |
| **Interactive Canvas** | **`@xyflow/react` v12** | Node-graph canvas for Railway visual topology |
| **Table Editor Grid** | **`@tanstack/react-table` + `@tanstack/react-virtual`** | Neon-style high-performance virtualized grid |
| **SQL Editor** | **`@monaco-editor/react`** | PostgreSQL syntax highlighting, autocompletion, formatting |
| **Live Terminal** | **`@xterm/xterm` + addons** | Real-time WebSocket terminal for build/runtime logs |
| **Styling & UI** | **Tailwind CSS + Radix UI + Lucide** | Sleek zinc dark mode (`#09090b`), glassmorphism |
| **Backend / API** | **Fastify / NestJS + tRPC** | High-throughput async runtime with type-safety |
| **Database ORM** | **Prisma / Drizzle** | Control plane internal database state management |
| **Docker Engine API** | **`dockerode` + `@types/dockerode`** | Container, volume, and network orchestration |
| **Build Engine** | **Nixpacks CLI (by Railway)** | Zero-config automatic build pack for 20+ runtimes |
| **Reverse Proxy / SSL**| **Caddy v2** | Dynamic JSON API configuration with automated Let's Encrypt |
| **Message Queue / Cache**| **Redis + BullMQ** | Asynchronous build jobs and live pub/sub log broadcasts |

---

## 🚀 Recommended Implementation Sequence

1. **Step 1: Database Provisioning & Table Introspection Engine** (`Phase 1` & `Phase 2`)
   - Create the Dockerode container manager to spawn Postgres 16 instances with persistent volumes.
   - Build the backend introspection queries (`pg_catalog`) to extract tables, columns, indexes, and foreign keys.
   - Implement the Neon-style visual table editor with virtualized rows and inline cell edits.

2. **Step 2: Interactive Service Canvas** (`Phase 3`)
   - Set up `@xyflow/react` with custom `ServiceNode` and `DatabaseNode` components.
   - Implement visual drag-and-drop wiring to automatically link services with environment variables (`DATABASE_URL`).
   - Add live status beacons and WebSocket resource metric sparklines.

3. **Step 3: Real-Time Terminal & Log Streaming** (`Phase 3`)
   - Stream Docker stdout/stderr demuxed streams over WebSockets directly to `@xterm/xterm`.

4. **Step 4: Build Engine & Edge Routing** (`Phase 4`)
   - Integrate Nixpacks to compile Git repositories into local OCI images.
   - Connect Caddy's dynamic JSON API to assign instant subdomains and automatically obtain SSL certificates.
   - Execute zero-downtime Blue/Green container swaps.

5. **Step 5: Production Deployment & Hardening** (`Phase 5`)
   - Deploy the PaaS control plane on a single VPS using Docker Compose, systemd, and socket proxies.
