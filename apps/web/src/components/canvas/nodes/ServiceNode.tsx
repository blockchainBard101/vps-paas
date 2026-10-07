'use client';

import React from 'react';
import { Handle, Position } from '@xyflow/react';
import { Globe, GitBranch, Cpu, MemoryStick, Terminal, Sliders, RefreshCw, AlertCircle, Sparkles } from 'lucide-react';

const PHASES = ['queued', 'importing', 'building', 'deploying'];
const PHASE_STEPS = [
  { key: 'queued', label: 'Queued' },
  { key: 'importing', label: 'Import' },
  { key: 'building', label: 'Build' },
  { key: 'deploying', label: 'Deploy' },
];

export function ServiceNode({ data, selected }: { data: any; selected: boolean }) {
  const isHealthy = data.status === 'running' || data.status === 'active';
  const isBuilding = data.status === 'building' || data.status === 'deploying';
  const isFailed = data.status === 'failed' || data.status === 'error';

  // Granular lifecycle label driven by the server-reported build phase.
  const phase = String(data.phase || '').toLowerCase();
  const buildLabel =
    phase === 'queued'
      ? 'Queued'
      : phase === 'importing'
      ? 'Importing'
      : phase === 'building'
      ? 'Building'
      : phase === 'deploying'
      ? 'Deploying'
      : phase === 'running'
      ? 'Starting'
      : data.status === 'deploying'
      ? 'Deploying'
      : 'Building';

  const buildDetail =
    phase === 'queued'
      ? 'Preparing deployment…'
      : phase === 'importing'
      ? 'Cloning repository & resolving dependencies'
      : phase === 'building'
      ? 'Compiling OCI container image'
      : phase === 'deploying' || phase === 'running'
      ? 'Starting container & routing traffic'
      : 'Compiling & deploying';

  return (
    <div
      onClick={() => data.onOpenDetails?.()}
      className={`w-72 rounded-xl border bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md transition-all duration-200 select-none cursor-pointer ${
        isBuilding
          ? 'border-amber-500/80 ring-2 ring-amber-500/30 shadow-amber-500/10 animate-pulse'
          : isFailed
          ? 'border-red-500/80 ring-2 ring-red-500/20'
          : selected
          ? 'border-emerald-500 ring-2 ring-emerald-500/20'
          : 'border-zinc-800 hover:border-zinc-700'
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
          <div
            className={`p-1.5 rounded-lg border ${
              isBuilding
                ? 'bg-amber-500/10 border-amber-500/30'
                : isFailed
                ? 'bg-red-500/10 border-red-500/30'
                : 'bg-emerald-500/10 border-emerald-500/20'
            }`}
          >
            {isBuilding ? (
              <RefreshCw className="w-4 h-4 text-amber-400 animate-spin" />
            ) : isFailed ? (
              <AlertCircle className="w-4 h-4 text-red-400" />
            ) : (
              <Globe className="w-4 h-4 text-emerald-400" />
            )}
          </div>
          <div>
            <h4 className="font-semibold text-sm text-zinc-100 truncate max-w-[130px]">{data.name}</h4>
            <div className="flex items-center gap-1 text-[11px] text-zinc-500">
              <GitBranch className="w-3 h-3" />
              <span>{data.branch || 'main'}</span>
              {data.subfolder && (
                <span className="text-[10px] text-amber-400/80 truncate max-w-[65px]">({data.subfolder})</span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {isBuilding ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[10px] font-mono font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping mr-0.5" />
              <span>{buildLabel}</span>
            </span>
          ) : isFailed ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-[10px] font-mono font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400 mr-0.5" />
              <span>Failed</span>
            </span>
          ) : (
            <>
              <span
                className={`w-2 h-2 rounded-full ${
                  isHealthy ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-500'
                }`}
              />
              <span className="text-xs text-zinc-400 capitalize">{data.status}</span>
            </>
          )}
        </div>
      </div>

      {/* Live Resource Gauges or Building Status */}
      {isBuilding ? (
        <div className="mt-3 p-2.5 bg-zinc-950/70 rounded-lg border border-amber-500/20 text-xs font-mono space-y-2">
          <div className="flex items-center justify-between text-amber-300">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>{buildLabel}</span>
            </span>
            <span className="text-[10px] text-zinc-500 font-sans">Port {data.port || 3000}</span>
          </div>

          <div className="text-[10px] text-zinc-400 leading-snug">{buildDetail}</div>

          {/* Lifecycle phase stepper */}
          <div className="flex items-center gap-1 pt-0.5">
            {PHASE_STEPS.map((step, i) => {
              const activeIdx = PHASES.indexOf(phase === 'running' ? 'deploying' : phase);
              const isDone = activeIdx >= 0 && i < activeIdx;
              const isActive = i === activeIdx;
              return (
                <div key={step.key} className="flex-1 flex items-center gap-1">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isDone ? 'bg-emerald-400' : isActive ? 'bg-amber-400 animate-pulse' : 'bg-zinc-700'
                    }`}
                  />
                  <span
                    className={`text-[9px] ${
                      isDone ? 'text-emerald-400' : isActive ? 'text-amber-300 font-semibold' : 'text-zinc-600'
                    }`}
                  >
                    {step.label}
                  </span>
                  {i < PHASE_STEPS.length - 1 && <span className="flex-1 h-px bg-zinc-800" />}
                </div>
              );
            })}
          </div>

          <div className="text-[10px] text-zinc-400 flex items-center justify-between">
            <span>Strategy:</span>
            <span className="text-zinc-300 truncate max-w-[150px]">
              {data.buildStrategy === 'dockerfile'
                ? 'Dockerfile builder'
                : data.buildStrategy === 'slim'
                ? 'Fast slim builder ⚡'
                : 'Nixpacks OCI compiler'}
            </span>
          </div>
        </div>
      ) : isFailed ? (
        <div className="mt-3 p-2.5 bg-red-950/20 rounded-lg border border-red-500/30 text-xs font-mono">
          <div className="text-red-300 font-semibold text-[11px] flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400" />
            <span>Deployment Failed</span>
          </div>
          {data.errorMessage && (
            <p className="text-[10px] text-red-400 mt-1 line-clamp-2">{data.errorMessage}</p>
          )}
        </div>
      ) : (
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
      )}

      {/* Action Buttons: Inspect Variables & View Logs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOpenDetails?.();
          }}
          className="py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Sliders className="w-3 h-3" />
          <span>Settings</span>
        </button>

        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOpenLogs?.();
          }}
          className="py-1.5 px-2 bg-zinc-800/60 hover:bg-zinc-800 text-zinc-300 border border-zinc-700/50 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          <Terminal className="w-3 h-3 text-emerald-400" />
          <span>{isBuilding ? 'Build Logs' : 'Logs'}</span>
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-emerald-500 !border-2 !border-zinc-950 transition-transform hover:scale-125"
      />
    </div>
  );
}

