# 01. Control Plane Database Schema & API Contracts

The Control Plane manages user projects, visual canvas topologies, deployment histories, and encrypted credentials. This document defines the internal schema (using Prisma ORM) and the tRPC API router interfaces.

---

## 1. Prisma Control Plane Database Schema

```prisma
datasource db {
  provider = "postgresql"
  url      = env("CONTROL_PLANE_DATABASE_URL")
}

generator client {
  provider = "prisma-client-js"
}

enum ServiceType {
  WEB_SERVICE
  BACKGROUND_WORKER
  POSTGRES
  REDIS
  MYSQL
}

enum DeploymentStatus {
  QUEUED
  BUILDING
  DEPLOYING
  HEALTHY
  FAILED
  CRASHED
  TERMINATED
}

enum HealthStatus {
  HEALTHY
  UNHEALTHY
  STARTING
  UNKNOWN
}

enum Role {
  OWNER
  ADMIN
  DEVELOPER
  VIEWER
}

model User {
  id            String               @id @default(cuid())
  name          String?
  email         String               @unique
  passwordHash  String?
  image         String?
  createdAt     DateTime             @default(now())
  updatedAt     DateTime             @updatedAt

  memberships   OrganizationMember[]
}

model Organization {
  id          String               @id @default(cuid())
  name        String
  slug        String               @unique
  createdAt   DateTime             @default(now())

  members     OrganizationMember[]
  projects    Project[]
}

model OrganizationMember {
  id             String       @id @default(cuid())
  role           Role         @default(DEVELOPER)
  userId         String
  user           User         @relation(fields: [userId], references: [id], onDelete: Cascade)
  organizationId String
  organization   Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime     @default(now())

  @@unique([userId, organizationId])
}

model Project {
  id             String        @id @default(cuid())
  name           String
  description    String?
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdAt      DateTime      @default(now())
  updatedAt      DateTime      @updatedAt

  environments Environment[]
  nodesLayout  Json?         // Stores React Flow canvas node positions and zoom
}

model Environment {
  id          String        @id @default(cuid())
  name        String        // e.g. "production", "staging"
  projectId   String
  project     Project       @relation(fields: [projectId], references: [id], onDelete: Cascade)
  createdAt   DateTime      @default(now())

  services    Service[]
  edges       ServiceEdge[] // Visual wires connecting services on the canvas

  @@unique([projectId, name])
}

model Service {
  id              String         @id @default(cuid())
  name            String         // e.g. "api-backend", "postgres"
  type            ServiceType
  environmentId   String
  environment     Environment    @relation(fields: [environmentId], references: [id], onDelete: Cascade)

  // Git & Build Config
  repoUrl         String?
  branch          String?        @default("main")
  dockerfilePath  String?
  buildCommand    String?
  startCommand    String?
  rootDirectory   String?        @default("/")

  // Resource Quotas
  cpuQuota        Float          @default(1.0) // 1.0 vCPU
  memoryLimitMb   Int            @default(512) // 512 MB

  // Container State
  activeContainerId String?
  healthStatus    HealthStatus   @default(STARTING)
  internalPort    Int            @default(3000)

  deployments     Deployment[]
  variables       EnvironmentVariable[]
  volumes         PersistentVolume[]
  domains         DomainRoute[]

  // Canvas Node Position Coordinates
  canvasX         Float          @default(0)
  canvasY         Float          @default(0)

  createdAt       DateTime       @default(now())
  updatedAt       DateTime       @updatedAt
}

model ServiceEdge {
  id            String      @id @default(cuid())
  environmentId String
  environment   Environment @relation(fields: [environmentId], references: [id], onDelete: Cascade)
  sourceId      String      // Service ID providing variables (e.g. Postgres)
  targetId      String      // Service ID consuming variables (e.g. Web App)

  createdAt     DateTime    @default(now())
}

model Deployment {
  id          String           @id @default(cuid())
  serviceId   String
  service     Service          @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  status      DeploymentStatus @default(QUEUED)
  commitHash  String?
  commitMessage String?
  imageTag    String?          // e.g. "paas-app-cuid:commit"
  containerId String?
  buildLogs   String?          @db.Text
  runtimeLogs String?          @db.Text
  startedAt   DateTime?
  finishedAt  DateTime?
  createdAt   DateTime         @default(now())
}

model EnvironmentVariable {
  id          String   @id @default(cuid())
  serviceId   String
  service     Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  key         String
  cipherValue String   @db.Text // Encrypted using AES-256-GCM
  iv          String
  tag         String
  isSecret    Boolean  @default(true)

  @@unique([serviceId, key])
}

model PersistentVolume {
  id          String   @id @default(cuid())
  name        String   // Docker named volume (e.g. "proj_pgdata_cuid")
  mountPath   String   // Mount target inside container (e.g. "/var/lib/postgresql/data")
  sizeGb      Int      @default(10)
  serviceId   String
  service     Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
}

model DomainRoute {
  id          String   @id @default(cuid())
  domain      String   @unique // e.g. "api.customer.com" or "app-prod.paas.local"
  isCustom    Boolean  @default(false)
  sslActive   Boolean  @default(false)
  serviceId   String
  service     Service  @relation(fields: [serviceId], references: [id], onDelete: Cascade)
  createdAt   DateTime @default(now())
}
```

---

## 2. Core tRPC API Router Specifications

The frontend communicates with the backend via strongly typed tRPC procedures:

```typescript
// server/routers/appRouter.ts
import { router, publicProcedure } from '../trpc';
import { z } from 'zod';

export const appRouter = router({
  // Project & Canvas Graph
  project: router({
    getCanvasTopology: publicProcedure
      .input(z.object({ projectId: z.string(), environment: z.string() }))
      .query(async ({ input }) => {
        // Returns all services, nodes, coordinates, and visual edge links
      }),

    updateNodePosition: publicProcedure
      .input(z.object({ serviceId: z.string(), x: z.number(), y: z.number() }))
      .mutation(async ({ input }) => {
        // Saves node coordinate changes on the canvas
      }),

    linkServices: publicProcedure
      .input(z.object({ sourceServiceId: z.string(), targetServiceId: z.string() }))
      .mutation(async ({ input }) => {
        // Creates ServiceEdge and automatically injects connection string env vars
      }),
  }),

  // Database Studio (Neon Viewer API)
  database: router({
    introspect: publicProcedure
      .input(z.object({ serviceId: z.string() }))
      .query(async ({ input }) => {
        // Returns list of schemas, tables, column types, and constraints
      }),

    getRows: publicProcedure
      .input(
        z.object({
          serviceId: z.string(),
          schema: z.string().default('public'),
          table: z.string(),
          limit: z.number().default(50),
          offset: z.number().default(0),
          orderBy: z.string().optional(),
          orderDir: z.enum(['asc', 'desc']).optional(),
        })
      )
      .query(async ({ input }) => {
        // Executes paginated query for virtual data grid
      }),

    updateCell: publicProcedure
      .input(
        z.object({
          serviceId: z.string(),
          schema: z.string(),
          table: z.string(),
          primaryKey: z.record(z.any()),
          column: z.string(),
          newValue: z.any(),
        })
      )
      .mutation(async ({ input }) => {
        // Updates single cell value via parameterized UPDATE statement
      }),

    executeSql: publicProcedure
      .input(
        z.object({
          serviceId: z.string(),
          sql: z.string(),
          readOnly: z.boolean().default(false),
        })
      )
      .mutation(async ({ input }) => {
        // Runs arbitrary SQL in Monaco runner with statement timeout
      }),
  }),
});

export type AppRouter = typeof appRouter;
```
