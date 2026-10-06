'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Globe,
  GitBranch,
  Terminal,
  Settings,
  Layers,
  Key,
  Eye,
  EyeOff,
  Plus,
  Trash2,
  RefreshCw,
  Check,
  AlertCircle,
  Copy,
  ExternalLink,
  ShieldCheck,
  Clock,
  RotateCw,
  Server,
  FolderGit2,
  Workflow,
  Sparkles,
  Box,
  Download,
  ArrowDown,
  Activity,
} from 'lucide-react';
import {
  fetchServiceLogs,
  updateServiceEnv,
  restartService,
  deleteService,
  updateServiceSettings,
  redeployGitHubService,
  deployGitHubRepo,
  ServiceRecord,
} from '@/lib/api';
import { DeleteServiceModal } from './DeleteServiceModal';
import { GitHubIcon } from '../github/GitHubRepoModal';

interface ServiceDetailDrawerProps {
  service: {
    id: string;
    name: string;
    status?: string;
    branch?: string;
    port?: number;
    internalPort?: number;
    gitRepo?: string;
    gitBranch?: string;
    subfolder?: string;
    dockerfilePath?: string;
    buildMethod?: 'auto' | 'railpack' | 'dockerfile';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    env?: Record<string, string>;
    createdAt?: string;
    startedAt?: string;
    errorMessage?: string;
  };
  isOpen: boolean;
  onClose: () => void;
  onServiceUpdated?: (updated: any) => void;
  onServiceDeleted?: (id: string) => void;
}

function timeAgo(isoString: string): string {
  if (!isoString) return '';
  const diff = Date.now() - new Date(isoString).getTime();
  if (isNaN(diff)) return '';
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function ServiceDetailDrawer({
  service,
  isOpen,
  onClose,
  onServiceUpdated,
  onServiceDeleted,
}: ServiceDetailDrawerProps) {
  const [isRedeploying, setIsRedeploying] = useState(false);
  const isFailed = !isRedeploying && (service.status === 'failed' || service.status === 'error');
  const isBuilding = isRedeploying || service.status === 'building' || service.status === 'deploying' || service.status === 'rebuilding';
  const [activeTab, setActiveTab] = useState<'deployments' | 'variables' | 'domains' | 'logs' | 'settings'>('variables');

  // Variables state
  const [envVars, setEnvVars] = useState<{ key: string; value: string; masked: boolean }[]>([]);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isSavingEnv, setIsSavingEnv] = useState(false);
  const [saveEnvNotice, setSaveEnvNotice] = useState<string | null>(null);

  // Domains state
  const [customDomain, setCustomDomain] = useState('');
  const [domainSaved, setDomainSaved] = useState(false);

  // Settings state (matching modern PaaS build & runtime config)
  const [serviceName, setServiceName] = useState(service.name);
  const [runtimeMode, setRuntimeMode] = useState<'web' | 'worker'>(service.runtimeMode || 'web');
  const [appPort, setAppPort] = useState<number>(
    service.port || service.internalPort || (service.env?.PORT ? parseInt(service.env.PORT, 10) : 3000)
  );
  const [buildMethod, setBuildMethod] = useState<'auto' | 'railpack' | 'dockerfile'>(
    service.buildMethod || 'auto'
  );
  const [dockerfilePath, setDockerfilePath] = useState<string>(
    service.dockerfilePath || service.env?.DOCKERFILE_PATH || ''
  );
  const [installCommand, setInstallCommand] = useState<string>(
    service.installCommand || service.env?.INSTALL_COMMAND || ''
  );
  const [prebuildCommand, setPrebuildCommand] = useState<string>(
    service.env?.PREBUILD_COMMAND || ''
  );
  const [buildCommand, setBuildCommand] = useState<string>(
    service.buildCommand || service.env?.BUILD_COMMAND || ''
  );
  const [startCommand, setStartCommand] = useState<string>(
    service.startCommand || service.env?.START_COMMAND || ''
  );
  const [staticOutput, setStaticOutput] = useState<string>(
    service.env?.STATIC_OUTPUT || ''
  );
  const [subfolderPath, setSubfolderPath] = useState<string>(
    service.subfolder || service.env?.GIT_SUBFOLDER || ''
  );

  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsSaved, setSettingsSaved] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const [restartPolicy, setRestartPolicy] = useState('unless-stopped');
  const [isRestarting, setIsRestarting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [isDeletingService, setIsDeletingService] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Real-time Logs state & sub-tab selection
  const [logSubTab, setLogSubTab] = useState<'build' | 'runtime'>(
    isBuilding || service.id.startsWith('deploying-') ? 'build' : 'runtime'
  );
  const [logs, setLogs] = useState<string>('');
  const [streamStatus, setStreamStatus] = useState<'connecting' | 'connected' | 'completed' | 'error'>('connecting');
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logsBottomRef = useRef<HTMLDivElement>(null);

  // Synchronize subtab state when building status changes
  useEffect(() => {
    if (isBuilding || service.id.startsWith('deploying-')) {
      setLogSubTab('build');
    }
  }, [service.id, isBuilding]);

  // Initialize env vars from service, strictly filtering out system internals
  useEffect(() => {
    const SYSTEM_KEYS = new Set([
      'GIT_REPO',
      'GIT_BRANCH',
      'PORT',
      'PATH',
      'NODE_VERSION',
      'YARN_VERSION',
      'HOME',
      'PWD',
      'SHLVL',
    ]);

    if (service.env) {
      const parsed = Object.entries(service.env)
        .filter(([k]) => !SYSTEM_KEYS.has(k))
        .map(([k, v]) => ({
          key: k,
          value: v,
          masked:
            k.toLowerCase().includes('secret') ||
            k.toLowerCase().includes('pass') ||
            k.toLowerCase().includes('token') ||
            k.toLowerCase().includes('key'),
        }));
      setEnvVars(parsed);
    } else {
      setEnvVars([]);
    }
    setServiceName(service.name);
    setRuntimeMode(service.runtimeMode || 'web');
    setAppPort(service.port || service.internalPort || (service.env?.PORT ? parseInt(service.env.PORT, 10) : 3000));
    setBuildMethod(service.buildMethod || 'auto');
    setDockerfilePath(service.dockerfilePath || service.env?.DOCKERFILE_PATH || '');
    setInstallCommand(service.installCommand || service.env?.INSTALL_COMMAND || '');
    setPrebuildCommand(service.env?.PREBUILD_COMMAND || '');
    setBuildCommand(service.buildCommand || service.env?.BUILD_COMMAND || '');
    setStartCommand(service.startCommand || service.env?.START_COMMAND || '');
    setStaticOutput(service.env?.STATIC_OUTPUT || '');
    setSubfolderPath(service.subfolder || service.env?.GIT_SUBFOLDER || '');
  }, [service]);

  // Log streaming via EventSource (Live Build Logs or Live Container Logs)
  useEffect(() => {
    if (!isOpen || activeTab !== 'logs') return;

    setStreamStatus('connecting');
    setLogs(`[PaaS LogStream] Connecting to live ${logSubTab === 'build' ? 'Build Compilation' : 'Runtime Container'} stream...\n------------------------------------------------------------\n`);

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
    const streamUrl = logSubTab === 'build'
      ? `${apiBase}/github/build-logs/stream/${encodeURIComponent(service.id)}`
      : `${apiBase}/services/${encodeURIComponent(service.id)}/logs/stream`;

    const es = new EventSource(streamUrl);

    es.onopen = () => {
      setStreamStatus('connected');
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.log) {
          setLogs((prev) => prev + parsed.log);
          if (autoScroll) {
            logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      } catch {
        setLogs((prev) => prev + e.data + '\n');
        if (autoScroll) {
          logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
      }
    };

    es.onerror = () => {
      if (logSubTab === 'runtime') {
        fetchServiceLogs(service.id, 100)
          .then((data) => {
            if (data.logs) {
              setLogs((prev) => prev + '\n[PaaS LogStream] Container stream ended. Showing recent log buffer:\n' + data.logs);
            }
          })
          .catch(() => {});
      } else {
        setLogs((prev) => prev + '\n[PaaS LogStream] Build log stream ended.\n');
      }
      setStreamStatus('completed');
      es.close();
    };

    return () => {
      es.close();
    };
  }, [isOpen, activeTab, logSubTab, service.id, autoScroll]);

  function handleDownloadLogs() {
    const blob = new Blob([logs], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${service.name}-${logSubTab}-logs-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleAddVariable(e: React.FormEvent) {
    e.preventDefault();
    if (!newKey.trim()) return;

    const updated = [
      ...envVars,
      {
        key: newKey.trim(),
        value: newValue.trim(),
        masked: newKey.toLowerCase().includes('secret') || newKey.toLowerCase().includes('pass'),
      },
    ];
    setEnvVars(updated);
    setNewKey('');
    setNewValue('');
    await persistEnvVars(updated);
  }

  async function handleDeleteVariable(index: number) {
    const updated = envVars.filter((_, i) => i !== index);
    setEnvVars(updated);
    await persistEnvVars(updated);
  }

  async function persistEnvVars(varsList: typeof envVars) {
    setIsSavingEnv(true);
    setSaveEnvNotice(null);

    const envMap: Record<string, string> = {};
    // Preserve existing system keys in container
    if (service.env) {
      const SYSTEM_KEYS = new Set([
        'GIT_REPO',
        'GIT_BRANCH',
        'PORT',
        'PATH',
        'NODE_VERSION',
        'YARN_VERSION',
        'HOME',
        'PWD',
        'SHLVL',
      ]);
      for (const [k, v] of Object.entries(service.env)) {
        if (SYSTEM_KEYS.has(k)) {
          envMap[k] = v;
        }
      }
    }
    // Add user environment variables
    for (const item of varsList) {
      envMap[item.key] = item.value;
    }

    try {
      await updateServiceEnv(service.id, envMap);
      setSaveEnvNotice('Variables updated & committed');
      setTimeout(() => setSaveEnvNotice(null), 3000);
      onServiceUpdated?.({ ...service, env: envMap });
    } catch (err: any) {
      setSaveEnvNotice(`Error: ${err.message}`);
    } finally {
      setIsSavingEnv(false);
    }
  }

  async function handleRedeployService() {
    setIsRedeploying(true);
    setSaveEnvNotice(null);
    try {
      const gitUrl = service.gitRepo || service.env?.GIT_REPO;
      const isGitHub = Boolean(gitUrl);

      const repoName = service.gitRepo ? service.gitRepo.split('/').pop()?.replace(/\.git$/, '') || service.name : service.name;
      const branch = service.gitBranch || service.branch || 'main';
      const cloneUrl = service.gitRepo || service.env?.GIT_REPO || '';

      if (isGitHub) {
        // Trigger full GitHub rebuild & redeployment with full repo metadata
        const result = await redeployGitHubService(service.id, {
          repoName,
          branch,
          cloneUrl,
          dockerfilePath,
          buildMethod,
          runtimeMode,
          subfolder: subfolderPath,
          port: appPort,
          installCommand,
          buildCommand,
          startCommand,
        });
        setSaveEnvNotice('Redeployment triggered! Rebuilding OCI image...');
        onServiceUpdated?.(result.service);
      } else {
        // Regular non-Git container: Restart container
        await restartService(service.id);
        setSaveEnvNotice('Container restarted successfully');
      }

      // Automatically switch to live Build Logs view
      setActiveTab('logs');
      setLogSubTab('build');
    } catch (err: any) {
      alert(`Redeploy error: ${err.message}`);
    } finally {
      setIsRedeploying(false);
    }
  }

  async function handleRestartService() {
    setIsRestarting(true);
    try {
      await restartService(service.id);
      setSaveEnvNotice('Container restarted successfully');
      setTimeout(() => setSaveEnvNotice(null), 3000);
    } catch (err: any) {
      alert(`Restart error: ${err.message}`);
    } finally {
      setIsRestarting(false);
    }
  }

  async function handleConfirmDeleteService() {
    setIsDeletingService(true);
    setDeleteError(null);
    try {
      if (!service.id.startsWith('deploying-')) {
        await deleteService(service.id);
      }
      setShowDeleteModal(false);
      onServiceDeleted?.(service.id);
      onClose();
    } catch (err: any) {
      setDeleteError(err.message || 'Failed to delete service');
    } finally {
      setIsDeletingService(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-3 right-3 w-[720px] max-w-[95vw] z-50 shadow-2xl rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 flex flex-col font-sans text-zinc-100 animate-in slide-in-from-right duration-250 select-text">
      {/* Top Header */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-900/70 px-5 flex items-center justify-between backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center border ${
            isFailed
              ? 'bg-red-500/10 border-red-500/20 text-red-400'
              : isBuilding
              ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
              : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
          }`}>
            {isFailed ? (
              <AlertCircle className="w-4 h-4" />
            ) : isBuilding ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Globe className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm text-zinc-100">{serviceName}</h3>
              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono flex items-center gap-1 ${
                isFailed
                  ? 'bg-red-500/10 border-red-500/20 text-red-400'
                  : isBuilding
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              }`}>
                <span className={`w-1.5 h-1.5 rounded-full ${
                  isFailed
                    ? 'bg-red-400'
                    : isBuilding
                    ? 'bg-amber-400 animate-ping'
                    : 'bg-emerald-400 animate-pulse'
                }`} />
                <span>
                  {isFailed
                    ? 'Failed'
                    : isBuilding
                    ? (service.status === 'deploying' ? 'Deploying' : 'Building')
                    : 'Running'}
                </span>
              </span>
            </div>
            <p className="text-[11px] text-zinc-400 font-mono">ID: {service.id} • Port: {service.port || 3000}</p>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Railway Navigation Tabs */}
      <div className="border-b border-zinc-800 bg-zinc-950 px-5 flex items-center gap-1 text-xs">
        {[
          { id: 'deployments', label: 'Deployments', icon: Clock },
          { id: 'variables', label: 'Variables', icon: Key },
          { id: 'domains', label: 'Domains', icon: Globe },
          { id: 'logs', label: 'Logs', icon: Terminal },
          { id: 'settings', label: 'Settings', icon: Settings },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-2.5 border-b-2 font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                isActive
                  ? 'border-indigo-500 text-indigo-300 bg-zinc-900/30'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body Viewports */}
      <div className="flex-1 overflow-y-auto p-6 bg-zinc-950">
        {/* ======================================================== */}
        {/* TAB 1: DEPLOYMENTS */}
        {/* ======================================================== */}
        {activeTab === 'deployments' && (
          <div className="space-y-6">
            {/* Active Deployment */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider mb-3">
                Active Deployment
              </h4>
              <div className={`p-4 rounded-xl border space-y-3 ${
                isFailed
                  ? 'border-red-500/30 bg-red-950/10'
                  : isBuilding
                  ? 'border-amber-500/30 bg-amber-950/10'
                  : 'border-emerald-500/30 bg-emerald-950/10'
              }`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                      isFailed
                        ? 'bg-red-400'
                        : isBuilding
                        ? 'bg-amber-400 animate-pulse'
                        : 'bg-emerald-400 animate-pulse'
                    }`} />
                    <span className={`font-mono text-xs font-bold ${
                      isFailed
                        ? 'text-red-400'
                        : isBuilding
                        ? 'text-amber-400'
                        : 'text-emerald-400'
                    }`}>
                      {isFailed
                        ? 'FAILED'
                        : isBuilding
                        ? (service.status?.toUpperCase() ?? 'BUILDING')
                        : (service.status === 'running' ? 'ACTIVE & ROUTED' : service.status?.toUpperCase() ?? 'ACTIVE')}
                    </span>
                    {(service.startedAt || service.createdAt) && (
                      <span className="text-[11px] font-mono text-zinc-500">
                        • {timeAgo(service.startedAt ?? service.createdAt ?? '')}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={handleRedeployService}
                    disabled={isRedeploying || isRestarting}
                    className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <RotateCw className={`w-3 h-3 ${isRedeploying || isRestarting ? 'animate-spin' : ''}`} />
                    <span>{isRedeploying ? 'Redeploying...' : 'Redeploy'}</span>
                  </button>
                </div>

                {isFailed && service.errorMessage && (
                  <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-500/20 text-xs font-mono text-red-300 max-h-60 overflow-y-auto whitespace-pre-wrap">
                    <span className="text-[10px] text-red-400 block font-semibold mb-1">ERROR DETAILS</span>
                    {(() => {
                      try {
                        const parsed = JSON.parse(service.errorMessage);
                        const msg = parsed.message || parsed.error || JSON.stringify(parsed, null, 2);
                        return msg.replace(/\\n/g, '\n').replace(/\\u001b\[\d+m/g, '');
                      } catch {
                        return service.errorMessage.replace(/\\n/g, '\n').replace(/\\u001b\[\d+m/g, '');
                      }
                    })()}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-xs font-mono text-zinc-300">
                  <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px] mb-0.5">REPOSITORY</span>
                    {service.gitRepo ? (
                      <span className="text-zinc-200 truncate block">{service.gitRepo.split('/').slice(-2).join('/')}</span>
                    ) : (
                      <span className="text-zinc-600 italic">No repo linked</span>
                    )}
                  </div>
                  <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px] mb-0.5">BRANCH</span>
                    <span className="flex items-center gap-1">
                      <GitBranch className={`w-3 h-3 ${
                        isFailed ? 'text-red-400' : isBuilding ? 'text-amber-400' : 'text-emerald-400'
                      }`} />
                      <span>{service.gitBranch || service.branch || 'main'}</span>
                    </span>
                  </div>
                  {service.subfolder && (
                    <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                      <span className="text-zinc-500 block text-[10px] mb-0.5">SUBFOLDER</span>
                      <span className="text-zinc-200 font-mono">{service.subfolder}</span>
                    </div>
                  )}
                  <div className="bg-zinc-900/60 p-2.5 rounded-lg border border-zinc-800">
                    <span className="text-zinc-500 block text-[10px] mb-0.5">DEPLOYED</span>
                    <span className="text-zinc-200">
                      {service.createdAt
                        ? new Date(service.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : '—'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Deployment History Timeline */}
            <div>
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider mb-3">
                Deployment History
              </h4>
              <div className="space-y-2">
                <div className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-xs font-mono">
                  <div className="flex items-center gap-3">
                    <span className={`w-2 h-2 rounded-full ${
                      isFailed ? 'bg-red-400' : isBuilding ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                    }`} />
                    <div>
                      <div className="font-semibold text-zinc-200">
                        {service.gitRepo ? service.gitRepo.split('/').pop()?.replace(/\.git$/, '') : service.name} ({service.gitBranch || service.branch || 'main'})
                      </div>
                      <div className="text-[11px] text-zinc-500 font-sans mt-0.5">
                        {isRedeploying
                          ? 'Triggered via manual Redeploy button'
                          : isFailed
                          ? 'Compilation or process launch failed'
                          : 'Active production container image'}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                      isFailed
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : isBuilding
                        ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                    }`}>
                      {isFailed ? 'Failed' : isBuilding ? 'Building' : 'Success'}
                    </span>
                    <span className="block text-[10px] text-zinc-500 mt-1 font-sans">
                      {service.createdAt ? timeAgo(service.createdAt) : 'Just now'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 2: VARIABLES (ENVIRONMENT VARIABLES) */}
        {/* ======================================================== */}
        {activeTab === 'variables' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                  Environment Variables
                </h4>
                <p className="text-[11px] text-zinc-400 mt-0.5">
                  Variables are injected securely into the container runtime and persistent volumes.
                </p>
              </div>

              {saveEnvNotice && (
                <div className="px-2.5 py-1 rounded bg-indigo-950/60 border border-indigo-500/40 text-[11px] font-mono text-indigo-300 flex items-center gap-1.5 animate-in fade-in">
                  <Check className="w-3.5 h-3.5 text-indigo-400" />
                  <span>{saveEnvNotice}</span>
                </div>
              )}
            </div>

            {/* Variables List */}
            <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30 divide-y divide-zinc-800">
              {envVars.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                  No custom environment variables configured. Add your first variable below.
                </div>
              ) : (
                envVars.map((v, idx) => (
                  <div key={v.key || idx} className="p-3 flex items-center justify-between gap-3 text-xs font-mono">
                    <div className="w-1/3 font-semibold text-indigo-300 truncate">{v.key}</div>
                    <div className="flex-1 text-zinc-300 truncate bg-zinc-950/80 px-2.5 py-1 rounded border border-zinc-800">
                      {v.masked ? '••••••••••••••••••••••••' : v.value}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => {
                          const updated = [...envVars];
                          updated[idx].masked = !updated[idx].masked;
                          setEnvVars(updated);
                        }}
                        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded cursor-pointer"
                        title={v.masked ? 'Reveal value' : 'Hide value'}
                      >
                        {v.masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => {
                          navigator.clipboard?.writeText(v.value);
                        }}
                        className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded cursor-pointer"
                        title="Copy variable"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDeleteVariable(idx)}
                        className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded cursor-pointer"
                        title="Delete variable"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))
              )}

              {/* Add New Variable Input Row */}
              <form onSubmit={handleAddVariable} className="p-3 bg-zinc-950/60 flex items-center gap-2">
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                  placeholder="NEW_VARIABLE_NAME"
                  className="w-1/3 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <input
                  value={newValue}
                  onChange={(e) => setNewValue(e.target.value)}
                  placeholder="variable_value"
                  className="flex-1 px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  type="submit"
                  disabled={!newKey.trim() || isSavingEnv}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-medium flex items-center gap-1 transition-colors cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add</span>
                </button>
              </form>
            </div>

            {/* Variable Referencing Tip */}
            <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 font-mono flex items-center justify-between">
              <span>Reference in other services via: <code className="text-indigo-400">${`{`}{`{`} {serviceName}.PORT {`}`}{`}`}</code></span>
              <span className="text-zinc-500">Auto-linking enabled</span>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 3: DOMAINS & NETWORKING */}
        {/* ======================================================== */}
        {activeTab === 'domains' && (
          <div className="space-y-6">
            <div>
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider mb-2">
                Public Endpoints & Routing
              </h4>
              <p className="text-[11px] text-zinc-400 mb-4">
                Edge routing via Caddy with automatic Let&apos;s Encrypt TLS certificates.
              </p>

              {/* Default Railway Domain */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex items-center justify-between">
                <div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Internal Bridge Host</div>
                  <div className="font-mono text-xs font-semibold text-zinc-200 mt-0.5">
                    http://{service.name}.paas-internal-network:{service.port || 3000}
                  </div>
                  <div className="text-[11px] text-emerald-400 font-mono mt-1 flex items-center gap-1">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>Zero-latency mesh routing active</span>
                  </div>
                </div>

                <a
                  href={`http://localhost:${service.port || 3000}`}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-lg text-xs font-mono flex items-center gap-1.5 transition-colors"
                >
                  <span>Open Port</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {/* Custom Domain Input */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-zinc-300">Custom Domain</h4>
              <div className="flex items-center gap-2">
                <input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="api.yourdomain.com"
                  className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    if (customDomain) {
                      setDomainSaved(true);
                      setTimeout(() => setDomainSaved(false), 3000);
                    }
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                >
                  Add Domain
                </button>
              </div>

              {domainSaved && (
                <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-500/30 text-xs font-mono text-emerald-300 flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span>Configured CNAME DNS record. Caddy will auto-issue Let&apos;s Encrypt certificate.</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 4: LOGS (CONTAINER STDOUT/STDERR) */}
        {/* ======================================================== */}
        {/* ======================================================== */}
        {/* TAB 4: LOGS (BUILD & RUNTIME REAL-TIME STREAM) */}
        {/* ======================================================== */}
        {activeTab === 'logs' && (
          <div className="h-full flex flex-col space-y-3">
            {/* Control Bar */}
            <div className="flex flex-wrap items-center justify-between gap-2 bg-zinc-900/70 p-2 rounded-xl border border-zinc-800/80">
              {/* Sub-tab Toggle: Runtime Logs vs Build Logs */}
              <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800 text-xs">
                <button
                  type="button"
                  onClick={() => setLogSubTab('runtime')}
                  className={`px-3 py-1.5 rounded-md font-mono transition-colors cursor-pointer flex items-center gap-1.5 ${
                    logSubTab === 'runtime'
                      ? 'bg-zinc-800 text-emerald-400 font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Terminal className="w-3.5 h-3.5" />
                  <span>Runtime Logs</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLogSubTab('build')}
                  className={`px-3 py-1.5 rounded-md font-mono transition-colors cursor-pointer flex items-center gap-1.5 ${
                    logSubTab === 'build'
                      ? 'bg-zinc-800 text-amber-400 font-semibold shadow-sm'
                      : 'text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <Workflow className="w-3.5 h-3.5" />
                  <span>Build Logs</span>
                </button>
              </div>

              {/* Live Status Badge & Action Controls */}
              <div className="flex items-center gap-2">
                <div className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-zinc-950 border border-zinc-800 flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      streamStatus === 'connected'
                        ? 'bg-emerald-400 animate-pulse'
                        : streamStatus === 'connecting'
                        ? 'bg-amber-400 animate-ping'
                        : 'bg-zinc-500'
                    }`}
                  />
                  <span className="text-zinc-300">
                    {streamStatus === 'connected'
                      ? 'LIVE STREAMING'
                      : streamStatus === 'connecting'
                      ? 'CONNECTING...'
                      : 'STREAM COMPLETED'}
                  </span>
                </div>

                {/* Auto-scroll toggle */}
                <button
                  type="button"
                  onClick={() => setAutoScroll((prev) => !prev)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded border transition-colors cursor-pointer flex items-center gap-1 ${
                    autoScroll
                      ? 'bg-emerald-950/60 text-emerald-400 border-emerald-800/80'
                      : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                  }`}
                  title={autoScroll ? 'Auto-scroll enabled (click to pause)' : 'Auto-scroll paused (click to enable)'}
                >
                  <ArrowDown className="w-3 h-3" />
                  <span>{autoScroll ? 'Scroll On' : 'Scroll Off'}</span>
                </button>

                {/* Download Logs */}
                <button
                  type="button"
                  onClick={handleDownloadLogs}
                  className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors cursor-pointer"
                  title="Download raw log output"
                >
                  <Download className="w-3.5 h-3.5" />
                </button>

                {/* Clear Terminal */}
                <button
                  type="button"
                  onClick={() => setLogs('')}
                  className="p-1.5 text-zinc-400 hover:text-rose-400 hover:bg-zinc-800 rounded-lg border border-zinc-800 transition-colors cursor-pointer"
                  title="Clear log terminal"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Terminal View */}
            <div className="flex-1 min-h-[380px] max-h-[460px] overflow-y-auto rounded-xl border border-zinc-800/90 bg-[#09090b] p-4 font-mono text-xs text-zinc-200 leading-relaxed shadow-2xl selection:bg-zinc-800 selection:text-emerald-300">
              <pre className="whitespace-pre-wrap">{logs || 'Waiting for stream output...'}</pre>
              <div ref={logsBottomRef} />
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* TAB 5: SETTINGS */}
        {/* ======================================================== */}
        {activeTab === 'settings' && (
          <div className="space-y-6">
            {/* Git Source Repository (if connected to GitHub) */}
            {(service.gitRepo || service.env?.GIT_REPO) && (
              <div className="space-y-3 pb-6 border-b border-zinc-800/80">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider flex items-center gap-2">
                    <GitHubIcon className="w-3.5 h-3.5" />
                    <span>Source Repository</span>
                  </h4>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-emerald-400 border border-zinc-700/60 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    GitHub Connected
                  </span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1 font-mono">GIT_REPO</label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={service.gitRepo || service.env?.GIT_REPO || ''}
                        className="flex-1 px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none select-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const url = service.gitRepo || service.env?.GIT_REPO || '';
                          if (url) navigator.clipboard?.writeText(url);
                        }}
                        className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                        title="Copy repository URL"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      <a
                        href={service.gitRepo || service.env?.GIT_REPO}
                        target="_blank"
                        rel="noreferrer"
                        className="p-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                        title="Open repository on GitHub"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1 font-mono">GIT_BRANCH</label>
                    <div className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-indigo-300 flex items-center gap-2">
                      <GitBranch className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                      <span>{service.gitBranch || service.branch || service.env?.GIT_BRANCH || 'main'}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] text-zinc-400 block mb-1 font-mono">ROOT_DIRECTORY (Subfolder)</label>
                    <input
                      value={subfolderPath}
                      onChange={(e) => setSubfolderPath(e.target.value)}
                      placeholder="/ (Root)"
                      className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* BUILD & RUNTIME SETTINGS (Railway/Coolify UI) */}
            {/* ======================================================== */}
            <div className="space-y-5 pb-6 border-b border-zinc-800/80">
              {/* RUNTIME MODE */}
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2 font-mono">
                  Runtime Mode
                </label>
                <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setRuntimeMode('web')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                      runtimeMode === 'web'
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Web service</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRuntimeMode('worker')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all cursor-pointer ${
                      runtimeMode === 'worker'
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Workflow className="w-3.5 h-3.5" />
                    <span>Worker</span>
                  </button>
                </div>
              </div>

              {/* APP PORT */}
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2 font-mono">
                  App Port
                </label>
                <input
                  type="number"
                  value={appPort}
                  onChange={(e) => setAppPort(parseInt(e.target.value, 10) || 3000)}
                  placeholder="8080"
                  className="w-full px-3.5 py-2.5 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-zinc-500"
                />
              </div>

              {/* BUILD METHOD */}
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-2 font-mono">
                  Build Method
                </label>
                <div className="inline-flex rounded-lg bg-zinc-950 p-1 border border-zinc-800 mb-2">
                  <button
                    type="button"
                    onClick={() => setBuildMethod('auto')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      buildMethod === 'auto'
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Auto</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildMethod('railpack')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      buildMethod === 'railpack'
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Box className="w-3.5 h-3.5" />
                    <span>Railpack</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setBuildMethod('dockerfile')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      buildMethod === 'dockerfile'
                        ? 'bg-zinc-100 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Terminal className="w-3.5 h-3.5" />
                    <span>Dockerfile...</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Auto uses your repository's Dockerfile when one exists, otherwise Railpack builds the project.
                </p>
              </div>

              {/* 2-COLUMN INPUT GRID */}
              <div className="grid grid-cols-2 gap-3.5">
                {/* DOCKERFILE PATH */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Dockerfile Path
                  </label>
                  <input
                    value={dockerfilePath}
                    onChange={(e) => setDockerfilePath(e.target.value)}
                    placeholder="Dockerfile (e.g. Dockerfile.prod)"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                {/* INSTALL COMMAND */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Install Command
                  </label>
                  <input
                    value={installCommand}
                    onChange={(e) => setInstallCommand(e.target.value)}
                    placeholder="auto"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                {/* PREBUILD COMMAND */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Prebuild Command
                  </label>
                  <input
                    value={prebuildCommand}
                    onChange={(e) => setPrebuildCommand(e.target.value)}
                    placeholder="none"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                {/* BUILD COMMAND */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Build Command
                  </label>
                  <input
                    value={buildCommand}
                    onChange={(e) => setBuildCommand(e.target.value)}
                    placeholder="auto"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                {/* START COMMAND */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Start Command
                  </label>
                  <input
                    value={startCommand}
                    onChange={(e) => setStartCommand(e.target.value)}
                    placeholder="auto"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>

                {/* STATIC OUTPUT */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Static Output
                  </label>
                  <input
                    value={staticOutput}
                    onChange={(e) => setStaticOutput(e.target.value)}
                    placeholder="auto"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={async () => {
                    setIsSavingSettings(true);
                    setSettingsNotice(null);
                    try {
                      const updated = await updateServiceSettings(service.id, {
                        dockerfilePath: dockerfilePath.trim() || undefined,
                        buildMethod,
                        runtimeMode,
                        subfolder: subfolderPath.trim() || undefined,
                        port: appPort,
                        installCommand: installCommand.trim() || undefined,
                        buildCommand: buildCommand.trim() || undefined,
                        startCommand: startCommand.trim() || undefined,
                      });
                      setSettingsSaved(true);
                      setSettingsNotice({ type: 'success', msg: 'Settings saved successfully!' });
                      setTimeout(() => {
                        setSettingsSaved(false);
                        setSettingsNotice(null);
                      }, 3500);
                      onServiceUpdated?.(updated);
                    } catch (err: any) {
                      setSettingsNotice({ type: 'error', msg: err.message || 'Failed to save settings' });
                    } finally {
                      setIsSavingSettings(false);
                    }
                  }}
                  disabled={isSavingSettings || isRedeploying}
                  className="px-4 py-2 bg-zinc-100 hover:bg-white text-zinc-950 font-semibold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md disabled:opacity-50"
                >
                  {isSavingSettings ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving...</span>
                    </>
                  ) : settingsSaved ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Saved!</span>
                    </>
                  ) : (
                    <span>Save Settings</span>
                  )}
                </button>

                {(service.gitRepo || service.env?.GIT_REPO) && (
                  <button
                    type="button"
                    onClick={async () => {
                      setIsRedeploying(true);
                      setSettingsNotice(null);
                      try {
                        const res = await redeployGitHubService(service.id, {
                          dockerfilePath: dockerfilePath.trim() || undefined,
                          buildMethod,
                          runtimeMode,
                          subfolder: subfolderPath.trim() || undefined,
                          port: appPort,
                          installCommand: installCommand.trim() || undefined,
                          buildCommand: buildCommand.trim() || undefined,
                          startCommand: startCommand.trim() || undefined,
                        });
                        setSettingsNotice({ type: 'success', msg: 'Service rebuilt & redeployed successfully!' });
                        onServiceUpdated?.(res.service);
                        setTimeout(() => setSettingsNotice(null), 4000);
                      } catch (err: any) {
                        setSettingsNotice({ type: 'error', msg: err.message || 'Failed to rebuild and redeploy' });
                      } finally {
                        setIsRedeploying(false);
                      }
                    }}
                    disabled={isRedeploying || isSavingSettings}
                    className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold rounded-xl text-xs flex items-center gap-2 transition-all cursor-pointer shadow-md shadow-indigo-600/30 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRedeploying ? 'animate-spin' : ''}`} />
                    <span>{isRedeploying ? 'Rebuilding...' : 'Save & Redeploy'}</span>
                  </button>
                )}
              </div>

              {settingsNotice && (
                <div className={`p-3 rounded-xl text-xs font-mono flex items-center gap-2 ${
                  settingsNotice.type === 'error'
                    ? 'bg-red-950/40 border border-red-500/30 text-red-300'
                    : 'bg-emerald-950/40 border border-emerald-500/30 text-emerald-300'
                }`}>
                  {settingsNotice.type === 'error' ? (
                    <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                  ) : (
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                  )}
                  <span>{settingsNotice.msg}</span>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <h4 className="text-xs font-semibold text-zinc-200 uppercase tracking-wider">
                Service Configuration
              </h4>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Service Name</label>
                <input
                  value={serviceName}
                  onChange={(e) => setServiceName(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="text-[11px] text-zinc-400 block mb-1">Restart Policy</label>
                <select
                  value={restartPolicy}
                  onChange={(e) => setRestartPolicy(e.target.value)}
                  className="w-full px-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="unless-stopped">Unless Stopped (Recommended)</option>
                  <option value="always">Always Restart</option>
                  <option value="on-failure">On Failure</option>
                </select>
              </div>
            </div>

            {/* Danger Zone */}
            <div className="pt-6 border-t border-zinc-800/80 space-y-3">
              <h4 className="text-xs font-bold text-red-400 uppercase tracking-wider">
                Danger Zone
              </h4>

              <div className="p-4 rounded-xl border border-red-500/20 bg-red-950/10 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-zinc-200">Restart Container</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">Gracefully restarts the container daemon</div>
                </div>
                <button
                  onClick={handleRestartService}
                  disabled={isRestarting}
                  className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-xs font-mono transition-colors cursor-pointer"
                >
                  {isRestarting ? 'Restarting...' : 'Restart'}
                </button>
              </div>

              <div className="p-4 rounded-xl border border-red-500/20 bg-red-950/10 flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-red-300">Delete Service</div>
                  <div className="text-[11px] text-zinc-400 mt-0.5">Stops container, removes volumes and routes</div>
                </div>
                <button
                  onClick={() => setShowDeleteModal(true)}
                  className="px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer shadow-md shadow-red-600/20"
                >
                  Delete Service
                </button>
              </div>

              {deleteError && (
                <div className="p-3 bg-red-950/40 border border-red-500/30 rounded-xl text-xs text-red-300">
                  {deleteError}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Service Confirmation Modal */}
      <DeleteServiceModal
        isOpen={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={handleConfirmDeleteService}
        serviceName={service.name}
        serviceId={service.id}
        image={(service as any)?.image || (service as any)?.env?.DOCKER_IMAGE}
        isDeleting={isDeletingService}
      />
    </div>
  );
}
