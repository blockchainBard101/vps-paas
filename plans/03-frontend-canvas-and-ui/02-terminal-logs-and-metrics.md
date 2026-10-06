# 02. Real-Time Terminal Logs & Live Resource Metrics

A signature element of modern PaaS platforms is real-time observability: watching build containers compile line-by-line in a crisp terminal and inspecting live memory/CPU consumption. This document specifies the terminal architecture using `@xterm/xterm` and Docker stats streaming.

---

## 1. Terminal Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│ Client Browser: @xterm/xterm in Collapsible Bottom Drawer              │
│ - ANSI 256 Color Rendering                                             │
│ - FitAddon (Auto-resizing to container width)                          │
│ - SearchAddon & WebLinksAddon                                          │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Binary WebSocket Stream
                                    │ ws://paas.domain/ws/logs/:deploymentId
┌───────────────────────────────────┴────────────────────────────────────┐
│ Control Plane WebSocket Hub (Fastify / ws)                             │
│ - Demultiplexes Docker stdout / stderr streams                         │
│ - Replays historical backlog buffer (last 500 lines)                   │
│ - Broadcasts real-time chunks to all connected clients                 │
└───────────────────────────────────▲────────────────────────────────────┘
                                    │ Unix Socket Stream
                                    │ container.logs({ follow: true })
┌───────────────────────────────────┴────────────────────────────────────┐
│ Docker Daemon Container Engine                                         │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Frontend Terminal Component (`TerminalDrawer.tsx`)

```tsx
// components/terminal/TerminalDrawer.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { Terminal as TerminalIcon, Maximize2, Minimize2, Trash2 } from 'lucide-react';

interface TerminalDrawerProps {
  deploymentId: string;
  isOpen: boolean;
  onToggle: () => void;
}

export function TerminalDrawer({ deploymentId, isOpen, onToggle }: TerminalDrawerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [activeTab, setActiveTab] = useState<'build' | 'runtime'>('build');

  useEffect(() => {
    if (!isOpen || !terminalRef.current) return;

    // 1. Initialize xterm instance with sleek dark palette
    const term = new Terminal({
      theme: {
        background: '#09090b', // Zinc 950
        foreground: '#e4e4e7', // Zinc 200
        cursor: '#a1a1aa',
        black: '#18181b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#8b5cf6',
        cyan: '#06b6d4',
        white: '#f4f4f5',
      },
      fontFamily: 'JetBrains Mono, Menlo, monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      convertEol: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());

    term.open(terminalRef.current);
    fit.fit();

    xtermInstance.current = term;
    fitAddon.current = fit;

    // 2. Connect to WebSocket Log Stream
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(
      `${protocol}//${window.location.host}/ws/logs/${deploymentId}?type=${activeTab}`
    );

    socket.onmessage = (event) => {
      term.write(event.data);
    };

    socket.onerror = () => {
      term.write('\r\n\x1b[31m[WebSocket Error: Log stream disconnected]\x1b[0m\r\n');
    };

    const handleResize = () => fit.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      socket.close();
      term.dispose();
    };
  }, [isOpen, deploymentId, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-80 bg-zinc-950 border-t border-zinc-800 z-50 flex flex-col shadow-2xl">
      {/* Drawer Header & Tabs */}
      <div className="h-10 border-b border-zinc-800/80 px-4 flex items-center justify-between bg-zinc-900/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-zinc-400 font-mono text-xs">
            <TerminalIcon className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-zinc-200">Logs</span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
            <button
              onClick={() => setActiveTab('build')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'build' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Build Logs
            </button>
            <button
              onClick={() => setActiveTab('runtime')}
              className={`px-3 py-1 rounded-md transition-colors ${
                activeTab === 'runtime' ? 'bg-zinc-800 text-zinc-100 font-medium' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Runtime Logs
            </button>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => xtermInstance.current?.clear()}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors"
            title="Clear Terminal"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onToggle}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Terminal Viewport */}
      <div ref={terminalRef} className="flex-1 w-full p-2 overflow-hidden" />
    </div>
  );
}
```

---

## 3. Real-Time Resource Metrics Streaming

To display live CPU% and RAM usage on each node and dashboard header:
1. The Control Plane attaches to Docker's streaming stats API:
   ```typescript
   const statsStream = await container.stats({ stream: true });
   ```
2. The orchestrator computes standard Docker metrics:
   ```typescript
   export function calculateCpuPercent(stats: any): number {
     const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
     const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
     const cpuCount = stats.cpu_stats.online_cpus || 1;

     if (systemDelta > 0 && cpuDelta > 0) {
       return Math.round(((cpuDelta / systemDelta) * cpuCount * 100) * 10) / 10;
     }
     return 0;
   }

   export function calculateMemoryUsage(stats: any): { usedMb: number; limitMb: number } {
     const used = stats.memory_stats.usage - (stats.memory_stats.stats?.cache || 0);
     return {
       usedMb: Math.round(used / (1024 * 1024)),
       limitMb: Math.round(stats.memory_stats.limit / (1024 * 1024)),
     };
   }
   ```
3. The metrics are throttled to 1 message/second and pushed via WebSocket to update node sparklines in real-time.
