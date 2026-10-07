'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as TerminalIcon, Minimize2, Trash2 } from 'lucide-react';

interface TerminalDrawerProps {
  serviceName: string;
  serviceId?: string;
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'build' | 'runtime';
}

export function TerminalDrawer({ serviceName, serviceId, isOpen, onClose, initialTab = 'runtime' }: TerminalDrawerProps) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermInstance = useRef<Terminal | null>(null);
  const [activeTab, setActiveTab] = useState<'build' | 'runtime'>(initialTab);

  // Follow the caller's requested tab (e.g. opening a building service should
  // land on Build Logs) without fighting the user's manual tab choices.
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, serviceId]);

  useEffect(() => {
    if (!isOpen || !terminalRef.current) return;

    const term = new Terminal({
      theme: {
        background: '#09090b',
        foreground: '#e4e4e7',
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
    term.open(terminalRef.current);
    fit.fit();
    xtermInstance.current = term;

    // Initial greeting / log header
    const modeLabel = activeTab === 'build' ? 'Build Compilation Stream' : 'Runtime Container Logs';
    term.write(`\x1b[36m[PaaS Live Stream]\x1b[0m Connected to \x1b[1m${modeLabel}\x1b[0m for \x1b[1m${serviceName}\x1b[0m\r\n`);
    term.write(`\x1b[90m------------------------------------------------------------\x1b[0m\r\n`);

    let eventSource: EventSource | null = null;

    if (serviceId && serviceId !== 'api-backend') {
      const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
      const streamUrl = activeTab === 'build'
        ? `${apiBase}/github/build-logs/stream/${encodeURIComponent(serviceId)}`
        : `${apiBase}/services/${encodeURIComponent(serviceId)}/logs/stream`;

      eventSource = new EventSource(streamUrl);
      
      eventSource.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data);
          if (parsed.log) {
            term.write(parsed.log.replace(/\r?\n/g, '\r\n'));
          }
        } catch {
          term.write(event.data + '\r\n');
        }
      };

      eventSource.onerror = () => {
        term.write(`\r\n\x1b[33m[Stream]\x1b[0m ${activeTab === 'build' ? 'Build log stream ended or disconnected.' : 'Runtime log stream disconnected.'}\r\n`);
        eventSource?.close();
      };
    } else {
      if (activeTab === 'runtime') {
        term.write(`\x1b[32m✔ Container initialized in paas-internal-network\x1b[0m\r\n`);
        term.write(`\x1b[34m[HTTP]\x1b[0m Server listening on port 3000\r\n`);
        term.write(`\x1b[90m[${new Date().toISOString()}] GET /health 200 OK (2ms)\x1b[0m\r\n`);
        term.write(`\x1b[90m[${new Date().toISOString()}] GET /api/v1/status 200 OK (4ms)\x1b[0m\r\n`);
      } else {
        term.write(`\x1b[35m[Nixpacks]\x1b[0m Detected Node.js (package.json)\r\n`);
        term.write(`\x1b[35m[Nixpacks]\x1b[0m Running npm install --production\r\n`);
        term.write(`\x1b[32m✔ Built OCI image in 4.2s\x1b[0m\r\n`);
      }
    }

    const handleResize = () => fit.fit();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      eventSource?.close();
      term.dispose();
    };
  }, [isOpen, serviceName, serviceId, activeTab]);

  if (!isOpen) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 h-72 bg-zinc-950 border-t border-zinc-800 z-50 flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-200">
      <div className="h-10 border-b border-zinc-800/80 px-4 flex items-center justify-between bg-zinc-900/60">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 font-mono text-xs">
            <TerminalIcon className="w-4 h-4 text-emerald-400" />
            <span className="font-semibold text-zinc-200">{serviceName}</span>
          </div>

          <div className="flex items-center gap-1 bg-zinc-950 p-0.5 rounded-lg border border-zinc-800 text-xs">
            <button
              onClick={() => setActiveTab('runtime')}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'runtime'
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Runtime Logs
            </button>
            <button
              onClick={() => setActiveTab('build')}
              className={`px-3 py-1 rounded-md transition-colors cursor-pointer ${
                activeTab === 'build'
                  ? 'bg-zinc-800 text-zinc-100 font-medium'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              Build Logs
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => xtermInstance.current?.clear()}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Clear logs"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors cursor-pointer"
            title="Close drawer"
          >
            <Minimize2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div ref={terminalRef} className="flex-1 w-full p-2 overflow-hidden" />
    </div>
  );
}
