import React, { useState, useEffect } from 'react';
import { Handle, Position } from '@xyflow/react';
import { HardDrive, Activity, ExternalLink, Copy, Check, Sliders } from 'lucide-react';
import { PostgresLogo, RedisLogo } from '../../icons/DatabaseLogos';
import { fetchDatabaseMetrics, ContainerMetrics } from '@/lib/api';

export function DatabaseNode({ data, selected }: { data: any; selected: boolean }) {
  const isHealthy = data.status === 'healthy' || data.status === 'running';
  const isRedis = data.engine === 'redis' || data.name?.toLowerCase().includes('redis');
  const [copied, setCopied] = useState(false);
  const [metrics, setMetrics] = useState<ContainerMetrics | null>(null);

  useEffect(() => {
    if (!data.id) return;
    fetchDatabaseMetrics(data.id)
      .then((m) => setMetrics(m))
      .catch(() => {});
  }, [data.id]);

  function handleCopyUrl(e: React.MouseEvent) {
    e.stopPropagation();
    if (data.connectionUrl) {
      navigator.clipboard?.writeText(data.connectionUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div
      onClick={() => data.onOpenSettings?.()}
      className={`w-72 rounded-xl border bg-zinc-900/95 p-4 shadow-2xl backdrop-blur-md transition-all duration-200 select-none cursor-pointer ${
        selected
          ? isRedis
            ? 'border-rose-500 ring-2 ring-rose-500/20'
            : 'border-indigo-500 ring-2 ring-indigo-500/20'
          : 'border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className={`!w-3 !h-3 ${isRedis ? '!bg-rose-500' : '!bg-indigo-500'} !border-2 !border-zinc-950 transition-transform hover:scale-125`}
      />

      {/* Header */}
      <div className="flex items-center justify-between pb-3 border-b border-zinc-800/80">
        <div className="flex items-center gap-2.5">
          <div
            className={`p-1.5 rounded-lg border ${
              isRedis
                ? 'bg-rose-500/10 border-rose-500/20'
                : 'bg-indigo-500/10 border-indigo-500/20'
            }`}
          >
            {isRedis ? <RedisLogo className="w-4 h-4" /> : <PostgresLogo className="w-4 h-4" />}
          </div>
          <div>
            <h4 className="font-semibold text-sm text-zinc-100">{data.name}</h4>
            <span className="text-[10px] text-zinc-500 uppercase tracking-wider font-mono">
              {isRedis ? 'Redis 7 Cache' : data.engine || 'PostgreSQL 16'}
            </span>
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
        <div className="flex items-center gap-1.5 bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40" title="Live RAM usage">
          <HardDrive className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
          <span className="truncate">{metrics ? metrics.memUsage.split(' / ')[0] : (isRedis ? '11 MiB' : '32 MiB')} RAM</span>
        </div>
        <div className="flex items-center justify-between bg-zinc-950/60 p-2 rounded-md border border-zinc-800/40" title="Live CPU %">
          <span className="text-zinc-500 flex items-center gap-1">
            <Activity className="w-3 h-3 text-zinc-500" />
            <span>CPU:</span>
          </span>
          <span className="text-zinc-200 font-mono">{metrics ? metrics.cpuPercent : '0.1%'}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="mt-3 flex items-center gap-1.5">
        {isRedis ? (
          <button
            onClick={handleCopyUrl}
            className="flex-1 py-1.5 px-2 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copied ? 'Copied URL' : 'Copy URL'}</span>
          </button>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              data.onOpenStudio?.();
            }}
            className="flex-1 py-1.5 px-2 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 rounded-lg text-xs font-medium flex items-center justify-center gap-1 transition-colors cursor-pointer"
          >
            <span>Neon Studio</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        )}

        <button
          onClick={(e) => {
            e.stopPropagation();
            data.onOpenSettings?.();
          }}
          className="flex-1 py-1.5 px-2.5 bg-zinc-950/80 hover:bg-zinc-800 text-zinc-300 hover:text-white border border-zinc-800 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
          title="Database Settings, Backups & Danger Zone"
        >
          <Sliders className="w-3 h-3 text-zinc-400" />
          <span>Settings</span>
        </button>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className={`!w-3 !h-3 ${isRedis ? '!bg-rose-500' : '!bg-indigo-500'} !border-2 !border-zinc-950 transition-transform hover:scale-125`}
      />
    </div>
  );
}
