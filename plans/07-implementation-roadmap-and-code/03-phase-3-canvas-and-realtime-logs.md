# Phase 3: Interactive Canvas & Real-Time Logs Implementation

This implementation guide provides the code to connect the visual **Railway Canvas** (`@xyflow/react`) with real-time **terminal log streaming** (`@xterm/xterm` + WebSockets).

---

## 1. Additional Dependencies

```bash
npm install @xyflow/react @xterm/xterm @xterm/addon-fit @xterm/addon-web-links ws
npm install -D @types/ws
```

---

## 2. Fastify WebSocket Log Streaming Server

Create a standalone WebSocket server (or mount inside your Fastify/Express backend) that hooks into Docker's container log stream:

```typescript
// server/ws-logs.ts
import { WebSocketServer, WebSocket } from 'ws';
import Docker from 'dockerode';
import { PassThrough } from 'node:stream';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });
const wss = new WebSocketServer({ port: 4001 });

console.log('[WebSocket] Log streaming hub running on ws://localhost:4001');

wss.on('connection', async (ws: WebSocket, req) => {
  // Extract containerId from URL: ws://localhost:4001?containerId=xxx
  const url = new URL(req.url || '', 'http://localhost');
  const containerId = url.searchParams.get('containerId');

  if (!containerId) {
    ws.send('\x1b[31mError: No containerId provided\x1b[0m\r\n');
    return ws.close();
  }

  try {
    const container = docker.getContainer(containerId);
    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
      tail: 100,
    });

    const passThrough = new PassThrough();
    passThrough.on('data', (chunk: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(chunk.toString('utf8'));
      }
    });

    // Demultiplex Docker 8-byte frame header
    docker.modem.demuxStream(logStream, passThrough, passThrough);

    ws.on('close', () => {
      logStream.destroy();
      passThrough.destroy();
    });
  } catch (err: any) {
    ws.send(`\x1b[31mFailed to attach to container logs: ${err.message}\x1b[0m\r\n`);
    ws.close();
  }
});
```

---

## 3. Interactive React Flow Canvas Component

```tsx
// src/components/RailwayCanvas.tsx
'use client';

import React, { useState, useCallback } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ServiceNode } from '@/components/canvas/nodes/ServiceNode';
import { DatabaseNode } from '@/components/canvas/nodes/DatabaseNode';
import { TerminalDrawer } from '@/components/terminal/TerminalDrawer';
import { NeonDatabaseStudio } from '@/components/NeonDatabaseStudio';
import { Plus, Play, Sparkles } from 'lucide-react';

const nodeTypes = {
  serviceNode: ServiceNode,
  databaseNode: DatabaseNode,
};

const initialNodes: Node[] = [
  {
    id: 'db-1',
    type: 'databaseNode',
    position: { x: 100, y: 150 },
    data: {
      name: 'postgres-main',
      status: 'healthy',
      engine: 'PostgreSQL 16',
      diskUsage: '1.2GB',
      activeConnections: 3,
      connectionUrl: 'postgresql://postgres:pass@localhost:5432/railway',
    },
  },
  {
    id: 'api-1',
    type: 'serviceNode',
    position: { x: 500, y: 150 },
    data: {
      name: 'api-backend',
      status: 'running',
      branch: 'main',
      cpuPercent: '0.8%',
      memoryUsage: '94MB',
      containerId: 'test-container-id',
    },
  },
];

const initialEdges: Edge[] = [
  {
    id: 'e-db1-api1',
    source: 'db-1',
    target: 'api-1',
    animated: true,
    style: { stroke: '#6366f1', strokeWidth: 2 },
  },
];

export function RailwayCanvas() {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Studio and Terminal state
  const [activeStudioDbUrl, setActiveStudioDbUrl] = useState<string | null>(null);
  const [activeTerminalContainerId, setActiveTerminalContainerId] = useState<string | null>(null);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges((eds) => addEdge({ ...params, animated: true, style: { stroke: '#6366f1', strokeWidth: 2 } }, eds));
      alert(`Linked! Injected DATABASE_URL into target service.`);
    },
    [setEdges]
  );

  return (
    <div className="relative w-screen h-screen bg-[#09090b] overflow-hidden flex flex-col">
      {/* Top Controls Bar */}
      <div className="h-12 border-b border-zinc-800 bg-zinc-900/60 backdrop-blur-md px-4 flex items-center justify-between z-10">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-100 font-semibold text-sm">
            <Sparkles className="w-4 h-4 text-emerald-400" />
            <span>Railway PaaS Canvas</span>
          </div>
          <span className="text-zinc-600">/</span>
          <span className="text-xs text-zinc-400 font-mono">env: production</span>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTerminalContainerId('test-container-id')}
            className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-medium rounded-lg transition-colors"
          >
            Open Logs
          </button>
          <button
            onClick={() => setActiveStudioDbUrl('postgresql://postgres:pass@localhost:5432/railway')}
            className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 transition-colors shadow-lg shadow-indigo-600/20"
          >
            <span>Open Neon Studio</span>
          </button>
        </div>
      </div>

      {/* React Flow Canvas */}
      <div className="flex-1 w-full h-full">
        <ReactFlow
          nodes={nodes.map((node) => ({
            ...node,
            data: {
              ...node.data,
              onOpenStudio: () => setActiveStudioDbUrl((node.data as any).connectionUrl),
            },
          }))}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
          <Controls className="!bg-zinc-900 !border-zinc-800 !fill-zinc-400" />
          <MiniMap
            className="!bg-zinc-950 !border-zinc-800"
            nodeColor={(node) => (node.type === 'databaseNode' ? '#818cf8' : '#34d399')}
          />
        </ReactFlow>
      </div>

      {/* Embedded Neon Studio Slide-Over Modal */}
      {activeStudioDbUrl && (
        <div className="fixed inset-y-4 right-4 w-[760px] z-50 shadow-2xl rounded-2xl overflow-hidden border border-zinc-700 bg-zinc-950 flex flex-col">
          <div className="flex items-center justify-between p-3 bg-zinc-900 border-b border-zinc-800">
            <span className="text-xs font-semibold text-zinc-300">Neon Database Explorer</span>
            <button
              onClick={() => setActiveStudioDbUrl(null)}
              className="text-xs text-zinc-400 hover:text-zinc-100 px-2 py-1 rounded bg-zinc-800"
            >
              Close
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            <NeonDatabaseStudio connectionUrl={activeStudioDbUrl} />
          </div>
        </div>
      )}

      {/* Terminal Drawer for Container Logs */}
      {activeTerminalContainerId && (
        <TerminalDrawer
          deploymentId={activeTerminalContainerId}
          isOpen={true}
          onToggle={() => setActiveTerminalContainerId(null)}
        />
      )}
    </div>
  );
}
```
