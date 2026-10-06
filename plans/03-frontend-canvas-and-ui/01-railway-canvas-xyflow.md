# 01. Railway-Style Interactive Canvas with React Flow

The signature feature of Railway is that infrastructure is presented as an interactive visual node graph on an infinite canvas rather than a flat table. This document details the implementation of this canvas using `@xyflow/react` (React Flow v12).

---

## 1. Canvas Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│  [Project: My SaaS]  [Env: Production ▼]     [+ New Service]  [Canvas / List Toggle]   │
├────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                        │
│     ┌────────────────────────┐              ┌────────────────────────┐                 │
│     │ 🌐 web-frontend        │              │ ⚡ api-backend         │                 │
│     │ Active (v3)            │              │ Active (v7)            │                 │
│     │ RAM: 112MB | CPU: 1.2% │───────┐      │ RAM: 245MB | CPU: 3.4% │                 │
│     └────────────────────────┘       │      └───────────▲────────────┘                 │
│                                      │                  │                              │
│                                      │                  │ (Wire: Injects DATABASE_URL) │
│                                      │                  │                              │
│                                      ▼                  │                              │
│                             ┌───────────────────────────┴────┐                         │
│                             │ 🐘 postgres-main               │                         │
│                             │ Active (16.2-alpine)           │                         │
│                             │ Storage: 1.4GB / 20GB          │                         │
│                             └────────────────────────────────┘                         │
│                                                                                        │
│ [Mini-Map]                                            [Zoom: 100%] [Fit View] [Lock]   │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Custom Node Components

Each infrastructure entity is represented by a specialized custom React Flow node.

### 2.1 The Database Node (`DatabaseNode.tsx`)
Displays database engine icon, connection status, open ports, and live storage utilization:

```tsx
// components/canvas/nodes/DatabaseNode.tsx
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Database, HardDrive, ExternalLink } from 'lucide-react';

export function DatabaseNode({ data, selected }: { data: any; selected: boolean }) {
  const isHealthy = data.status === 'healthy';

  return (
    <div
      className={`w-72 rounded-xl border bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md transition-all duration-200 ${
        selected ? 'border-indigo-500 ring-2 ring-indigo-500/20' : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-zinc-950 transition-transform hover:scale-125"
      />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
            <Database className="w-4 h-4 text-indigo-400" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-zinc-100">{data.name}</h4>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{data.engine || 'PostgreSQL 16'}</span>
          </div>
        </div>

        {/* Status Indicator Beacon */}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="text-xs text-zinc-400 capitalize">{data.status}</span>
        </div>
      </div>

      {/* Metrics & Storage Info */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40">
          <HardDrive className="w-3.5 h-3.5 text-zinc-500" />
          <span>{data.diskUsage || '1.4GB'}</span>
        </div>
        <div className="flex items-center justify-between bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40">
          <span>Conn:</span>
          <span className="text-zinc-200 font-mono">{data.activeConnections || 4}</span>
        </div>
      </div>

      {/* Action Trigger for Neon Data Studio */}
      <button
        onClick={data.onOpenStudio}
        className="mt-3 w-full py-1.5 px-3 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
      >
        <span>Open Data Studio</span>
        <ExternalLink className="w-3 h-3" />
      </button>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-indigo-500 !border-2 !border-zinc-950 transition-transform hover:scale-125"
      />
    </div>
  );
}
```

---

### 2.2 The Web Service Node (`ServiceNode.tsx`)

```tsx
// components/canvas/nodes/ServiceNode.tsx
import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Globe, GitBranch, Cpu, MemoryStick } from 'lucide-react';

export function ServiceNode({ data, selected }: { data: any; selected: boolean }) {
  const isHealthy = data.status === 'running';

  return (
    <div
      className={`w-72 rounded-xl border bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md transition-all duration-200 ${
        selected ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-zinc-950 transition-transform hover:scale-125"
      />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div className="p-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
            <Globe className="w-4 h-4 text-emerald-400" />
          </div>
          <div>
            <h4 className="font-semibold text-sm text-zinc-100">{data.name}</h4>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500">
              <GitBranch className="w-3 h-3" />
              <span>{data.branch || 'main'}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              isHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
            }`}
          />
          <span className="text-xs text-zinc-400 capitalize">{data.status}</span>
        </div>
      </div>

      {/* Live Resource Gauges */}
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="flex items-center gap-1.5 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40 text-zinc-400">
          <Cpu className="w-3.5 h-3.5 text-zinc-500" />
          <span>CPU: {data.cpuPercent || '1.2%'}</span>
        </div>
        <div className="flex items-center gap-1.5 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40 text-zinc-400">
          <MemoryStick className="w-3.5 h-3.5 text-zinc-500" />
          <span>RAM: {data.memoryUsage || '120MB'}</span>
        </div>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-zinc-950 transition-transform hover:scale-125"
      />
    </div>
  );
}
```

---

## 3. Drag-and-Drop Environment Variable Auto-Linking

In Railway, connecting two nodes visually automatically links their configuration:
1. When a user drags a wire from a **Database Node** (`source`) to a **Web Service Node** (`target`), the canvas triggers the `onConnect` callback.
2. The UI opens a confirmation modal:
   > **Link Services**: Do you want to inject `DATABASE_URL` from **postgres-main** into **api-backend**?
3. If confirmed:
   - A new edge is saved in the database.
   - An environment variable entry is created on the target service:
     `DATABASE_URL=${{ postgres-main.DATABASE_URL }}`.
   - A redeployment trigger is scheduled for the target service so it boots with the newly injected credentials.
