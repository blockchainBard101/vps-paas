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
  Pencil,
  ExternalLink,
  ShieldCheck,
  Clock,
  RotateCw,
  Server,
  FolderGit2,
  Workflow,
  Sparkles,
  Box,
  Zap,
  Download,
  ChevronDown,
  ArrowDown,
  Activity,
} from 'lucide-react';
import {
  fetchServiceLogs,
  fetchBuildLogs,
  fetchDeployHistory,
  updateServiceEnv,
  restartService,
  deleteService,
  updateServiceSettings,
  redeployGitHubService,
  deployGitHubRepo,
  addServiceDomain,
  removeServiceDomain,
  verifyServiceDomains,
  fetchDomainStatus,
  ServiceRecord,
  getApiBase,
} from '@/lib/api';
import { DeleteServiceModal } from './DeleteServiceModal';
import { GitHubIcon } from '../github/GitHubRepoModal';

interface ServiceDetailDrawerProps {
  service: {
    id: string;
    name: string;
    status?: string;
    phase?: string;
    branch?: string;
    port?: number;
    internalPort?: number;
    gitRepo?: string;
    gitBranch?: string;
    subfolder?: string;
    dockerfilePath?: string;
    buildMethod?: 'auto' | 'railpack' | 'dockerfile' | 'slim';
    runtimeMode?: 'web' | 'worker';
    installCommand?: string;
    buildCommand?: string;
    startCommand?: string;
    systemPackages?: string;
    nodeVersion?: string;
    domains?: string[];
    domainStatus?: Record<
      string,
      {
        status: 'pending' | 'verified';
        targetIp?: string;
        verifiedAt?: string;
        lastCheckedAt?: string;
        lastError?: string;
        createdAt: string;
      }
    >;
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

// Container/system environment variables (injected by Nixpacks/Docker/the PaaS)
// that should not be presented as the user's own configuration.
const SYSTEM_ENV_PREFIXES = ['NIX', 'NPM_', 'YARN_', 'RV_', 'PKG_', 'LD_', 'GEM_', 'PIP_', 'NGINX', 'NJS_', 'ACME_', 'DYNPKG_'];
const SYSTEM_ENV_KEYS = new Set([
  'PATH', 'HOME', 'PWD', 'OLDPWD', 'SHLVL', '_', 'USER', 'LOGNAME', 'TERM', 'ENV', 'CI', 'HOSTNAME',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'QTDIR', 'CPATH', 'LIBRARY_PATH', 'LD_LIBRARY_PATH',
  'GIT_SSL_CAINFO', 'NIX_SSL_CERT_FILE', 'SOURCE_DATE_EPOCH',
  'NODE_ENV', 'NODE_VERSION', 'YARN_VERSION', 'NPM_CONFIG_PRODUCTION',
  'NIXPACKS_METADATA', 'NIXPACKS_PATH', 'NIXPACKS_NODE_VERSION',
  'GIT_REPO', 'GIT_BRANCH', 'GIT_SUBFOLDER', 'GIT_DOCKERFILE_PATH', 'DOCKERFILE_PATH',
  'BUILD_METHOD', 'RUNTIME_MODE', 'INSTALL_COMMAND', 'BUILD_COMMAND', 'START_COMMAND',
  'PREBUILD_COMMAND', 'STATIC_OUTPUT', 'SYSTEM_PACKAGES', 'PORT',
]);

function isSystemEnvKey(key: string): boolean {
  const u = (key || '').toUpperCase();
  if (SYSTEM_ENV_KEYS.has(u)) return true;
  return SYSTEM_ENV_PREFIXES.some((p) => u.startsWith(p));
}

function isMaskedKey(key: string): boolean {
  const k = (key || '').toLowerCase();
  return k.includes('secret') || k.includes('pass') || k.includes('token') || k.includes('key');
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
  const phaseLabel = (() => {
    const p = String(service.phase || '').toLowerCase();
    if (p === 'queued') return 'QUEUED';
    if (p === 'importing') return 'IMPORTING';
    if (p === 'building') return 'BUILDING';
    if (p === 'deploying') return 'DEPLOYING';
    if (p === 'running') return 'STARTING';
    return service.status?.toUpperCase() ?? 'BUILDING';
  })();
  const [activeTab, setActiveTab] = useState<'deployments' | 'variables' | 'domains' | 'logs' | 'settings'>('variables');

  // Variables state
  const [envVars, setEnvVars] = useState<{ key: string; value: string; masked: boolean }[]>([]);
  const [systemEnvVars, setSystemEnvVars] = useState<{ key: string; value: string; masked: boolean }[]>([]);
  const [showSystemVars, setShowSystemVars] = useState(false);
  const [envViewMode, setEnvViewMode] = useState<'table' | 'raw'>('table');
  const [rawEnvText, setRawEnvText] = useState('');
  const [isSavingRaw, setIsSavingRaw] = useState(false);
  const [showRedeployToast, setShowRedeployToast] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editKey, setEditKey] = useState('');
  const [editValue, setEditValue] = useState('');
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [isSavingEnv, setIsSavingEnv] = useState(false);
  const [saveEnvNotice, setSaveEnvNotice] = useState<string | null>(null);

  // Domains state
  const domainsKey = `${service.id}:${(service.domains || []).join(',')}`;
  const [domains, setDomains] = useState<string[]>(service.domains || []);
  const [syncedDomainsKey, setSyncedDomainsKey] = useState(domainsKey);
  const [domainStatusMap, setDomainStatusMap] = useState<NonNullable<ServiceRecord['domainStatus']>>(
    service.domainStatus || {},
  );
  const statusKey = `${service.id}:${JSON.stringify(service.domainStatus || {})}`;
  const [syncedStatusKey, setSyncedStatusKey] = useState(statusKey);
  const [newDomain, setNewDomain] = useState('');
  const [isSavingDomain, setIsSavingDomain] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [serverIp, setServerIp] = useState('');

  // Re-sync displayed state when the underlying service changes. Done during
  // render (not in an effect) to avoid a cascading render.
  if (syncedDomainsKey !== domainsKey) {
    setSyncedDomainsKey(domainsKey);
    setDomains(service.domains || []);
  }
  if (syncedStatusKey !== statusKey) {
    setSyncedStatusKey(statusKey);
    setDomainStatusMap(service.domainStatus || {});
  }

  // Fetch the server IP that custom domains must point at (shown as the DNS target).
  useEffect(() => {
    if (!isOpen || activeTab !== 'domains' || serverIp) return;
    fetchDomainStatus()
      .then((s) => setServerIp(s.serverIp || ''))
      .catch(() => {});
  }, [isOpen, activeTab, serverIp]);

  // Auto-verify this service's domains every 5s while the Domains tab is open,
  // so a domain flips to "verified" shortly after DNS propagates.
  useEffect(() => {
    if (!isOpen || activeTab !== 'domains') return;
    if ((service.domains || []).length === 0) return;
    let cancelled = false;
    const run = async () => {
      try {
        const updated = await verifyServiceDomains(service.id);
        if (cancelled) return;
        setDomainStatusMap(updated.domainStatus || {});
        onServiceUpdated?.(updated);
      } catch {}
    };
    const timer = setInterval(run, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, activeTab, service.id, domainsKey]);

  const handleAddDomain = async () => {
    const value = newDomain.trim();
    if (!value) return;
    setIsSavingDomain(true);
    setDomainError(null);
    try {
      const updated = await addServiceDomain(service.id, value);
      setDomains(updated.domains || []);
      setDomainStatusMap(updated.domainStatus || {});
      setNewDomain('');
      onServiceUpdated?.(updated);
    } catch (e: any) {
      setDomainError(e?.message || 'Failed to add domain');
    } finally {
      setIsSavingDomain(false);
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    setDomainError(null);
    try {
      const updated = await removeServiceDomain(service.id, domain);
      setDomains(updated.domains || []);
      setDomainStatusMap(updated.domainStatus || {});
      onServiceUpdated?.(updated);
    } catch (e: any) {
      setDomainError(e?.message || 'Failed to remove domain');
    }
  };

  const handleVerifyDomains = async () => {
    setIsVerifying(true);
    setDomainError(null);
    try {
      const updated = await verifyServiceDomains(service.id);
      setDomainStatusMap(updated.domainStatus || {});
      onServiceUpdated?.(updated);
    } catch (e: any) {
      setDomainError(e?.message || 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  // Settings state (matching modern PaaS build & runtime config)
  const [serviceName, setServiceName] = useState(service.name);
  const [runtimeMode, setRuntimeMode] = useState<'web' | 'worker'>(service.runtimeMode || 'web');
  const [appPort, setAppPort] = useState<number>(
    service.port || service.internalPort || (service.env?.PORT ? parseInt(service.env.PORT, 10) : 3000)
  );
  const [buildMethod, setBuildMethod] = useState<'auto' | 'railpack' | 'dockerfile' | 'slim'>(
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
  const [systemPackages, setSystemPackages] = useState<string>(
    service.systemPackages || service.env?.SYSTEM_PACKAGES || ''
  );
  const [nodeVersion, setNodeVersion] = useState<string>(
    service.nodeVersion || service.env?.NODE_VERSION || ''
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
  const autoScrollRef = useRef<boolean>(true);
  const logsBottomRef = useRef<HTMLDivElement>(null);

  // Keep a ref in sync so toggling auto-scroll never re-subscribes the stream.
  useEffect(() => {
    autoScrollRef.current = autoScroll;
  }, [autoScroll]);

  // Persisted deployment history (past & in-flight builds)
  const [deployHistory, setDeployHistory] = useState<
    Array<{ id: string; status: 'building' | 'success' | 'failed'; createdAt: string; branch: string; repoName: string; logsCount: number }>
  >([]);

  // When a service is actively building, surface the live Build Logs immediately
  // so selecting a building node always shows real-time compilation output.
  useEffect(() => {
    if (isBuilding || service.id.startsWith('deploying-')) {
      setLogSubTab('build');
      setActiveTab('logs');
    }
  }, [service.id, isBuilding]);

  // Initialize env vars from service, separating user vars from container/system internals
  useEffect(() => {
    const all = Object.entries(service.env || {});
    const userVars: { key: string; value: string; masked: boolean }[] = [];
    const sysVars: { key: string; value: string; masked: boolean }[] = [];
    for (const [k, v] of all) {
      const entry = { key: k, value: v, masked: isMaskedKey(k) };
      if (isSystemEnvKey(k)) sysVars.push(entry);
      else userVars.push(entry);
    }
    setEnvVars(userVars);
    setSystemEnvVars(sysVars);
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
    setSystemPackages(service.systemPackages || service.env?.SYSTEM_PACKAGES || '');
    setNodeVersion(service.nodeVersion || service.env?.NODE_VERSION || '');
  }, [service]);

  // Log streaming via EventSource (Live Build Logs or Live Container Logs)
  useEffect(() => {
    if (!isOpen || activeTab !== 'logs') return;

    setStreamStatus('connecting');
    setLogs(`[PaaS LogStream] Connecting to live ${logSubTab === 'build' ? 'Build Compilation' : 'Runtime Container'} stream...\n------------------------------------------------------------\n`);

    const apiBase = getApiBase();
    const streamUrl = logSubTab === 'build'
      ? `${apiBase}/github/build-logs/stream/${encodeURIComponent(service.id)}`
      : `${apiBase}/services/${encodeURIComponent(service.id)}/logs/stream`;

    let receivedChunks = false;
    if (logSubTab === 'build') {
      fetchBuildLogs(service.id)
        .then((data) => {
          if (data.logs && data.logs.length > 0) {
            receivedChunks = true;
            setLogs(data.logs.join(''));
          }
        })
        .catch(() => {});
    }

    const es = new EventSource(streamUrl);

    es.onopen = () => {
      setStreamStatus('connected');
    };

    es.onmessage = (e) => {
      try {
        const parsed = JSON.parse(e.data);
        if (parsed.log) {
          receivedChunks = true;
          setLogs((prev) => prev + parsed.log);
          if (autoScrollRef.current) {
            logsBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
          }
        }
      } catch {
        receivedChunks = true;
        setLogs((prev) => prev + e.data + '\n');
        if (autoScrollRef.current) {
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
        fetchBuildLogs(service.id)
          .then((data) => {
            if (data.logs && data.logs.length > 0) {
              setLogs(data.logs.join(''));
            } else if (!receivedChunks) {
              setLogs((prev) => prev + '\n[PaaS LogStream] Build log stream ended.\n');
            }
          })
          .catch(() => {
            if (!receivedChunks) {
              setLogs((prev) => prev + '\n[PaaS LogStream] Build log stream ended.\n');
            }
          });
      }
      setStreamStatus('completed');
      es.close();
    };

    return () => {
      es.close();
    };
  }, [isOpen, activeTab, logSubTab, service.id]);

  // Fetch deployment history when the drawer is open (and refresh it while a
  // build is running so the timeline reflects live status transitions).
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    const load = async () => {
      try {
        const history = await fetchDeployHistory(service.id);
        if (!cancelled) setDeployHistory(history);
      } catch {
        // Backend temporarily unavailable
      }
    };

    load();
    const interval = setInterval(() => {
      const hasBuilding = deployHistory.some((h) => h.status === 'building');
      if (activeTab === 'deployments' || hasBuilding) load();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [isOpen, service.id, activeTab, deployHistory.length]);

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

  /** Parse a `.env`-style text block into env var entries. */
  function parseEnvText(text: string) {
    const out: { key: string; value: string; masked: boolean }[] = [];
    const seen = new Set<string>();
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let value = t.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({ key, value, masked: isMaskedKey(key) });
    }
    return out;
  }

  function openRawEditor() {
    setRawEnvText(envVars.map((v) => `${v.key}=${v.value}`).join('\n'));
    setEnvViewMode('raw');
  }

  async function saveRawEnv() {
    const parsed = parseEnvText(rawEnvText);
    setIsSavingRaw(true);
    setEnvVars(parsed);
    await persistEnvVars(parsed);
    setIsSavingRaw(false);
    setEnvViewMode('table');
  }

  function startEditVariable(idx: number, v: { key: string; value: string }) {
    setEditingIndex(idx);
    setEditKey(v.key);
    setEditValue(v.value);
  }

  async function saveEditVariable(idx: number) {
    const k = editKey.trim();
    if (!k) return;
    const updated = envVars.map((x, i) =>
      i === idx ? { ...x, key: k, value: editValue, masked: isMaskedKey(k) } : x
    );
    setEnvVars(updated);
    setEditingIndex(null);
    await persistEnvVars(updated);
  }

  async function persistEnvVars(varsList: typeof envVars) {
    setIsSavingEnv(true);
    setSaveEnvNotice(null);

    const envMap: Record<string, string> = {};
    // Send only the user's variables; the server preserves platform-managed keys.
    for (const item of varsList) {
      if (item.key) envMap[item.key] = item.value;
    }

    try {
      await updateServiceEnv(service.id, envMap);
      setSaveEnvNotice('Variables updated & committed');
      setTimeout(() => setSaveEnvNotice(null), 3000);
      setShowRedeployToast(true);
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
    // Optimistically reflect the building state immediately on the canvas node
    // (the background poll confirms within a few seconds).
    onServiceUpdated?.({ ...service, status: 'building', phase: 'queued' });
    // Jump straight to the live Build Logs view so compilation streams in real time
    // while the (long-running) rebuild request is still in flight on the server.
    setActiveTab('logs');
    setLogSubTab('build');
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
          systemPackages,
          nodeVersion,
        });
        setSaveEnvNotice('Redeployment complete! Container is live.');
        onServiceUpdated?.(result.service);
      } else {
        // Regular non-Git container: Restart container
        await restartService(service.id);
        setSaveEnvNotice('Container restarted successfully');
      }
    } catch (err: any) {
      setSettingsNotice({ type: 'error', msg: `Redeploy error: ${err.message}` });
      setSaveEnvNotice(`Redeploy error: ${err.message}`);
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
    <>
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
                        ? phaseLabel
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
                {deployHistory.length === 0 ? (
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
                ) : (
                  deployHistory.map((entry, idx) => {
                    const entryFailed = entry.status === 'failed';
                    const entryBuilding = entry.status === 'building';
                    return (
                      <div
                        key={`${entry.id}-${idx}`}
                        className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/40 flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`w-2 h-2 rounded-full ${
                            entryFailed ? 'bg-red-400' : entryBuilding ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'
                          }`} />
                          <div>
                            <div className="font-semibold text-zinc-200">
                              {entry.repoName} ({entry.branch})
                            </div>
                            <div className="text-[11px] text-zinc-500 font-sans mt-0.5">
                              {entryBuilding
                                ? 'Build in progress — streaming logs…'
                                : entryFailed
                                ? 'Compilation or process launch failed'
                                : `Deployed successfully • ${entry.logsCount} log events`}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold ${
                            entryFailed
                              ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                              : entryBuilding
                              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          }`}>
                            {entryBuilding ? 'Building' : entryFailed ? 'Failed' : 'Success'}
                          </span>
                          <span className="block text-[10px] text-zinc-500 mt-1 font-sans">
                            {entry.createdAt ? timeAgo(entry.createdAt) : 'Just now'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
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

              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-lg bg-zinc-950 p-0.5 border border-zinc-800 text-[11px] font-mono">
                  <button
                    type="button"
                    onClick={() => setEnvViewMode('table')}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      envViewMode === 'table' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    Editor
                  </button>
                  <button
                    type="button"
                    onClick={openRawEditor}
                    className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                      envViewMode === 'raw' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
                    }`}
                  >
                    .env
                  </button>
                </div>
                {saveEnvNotice && (
                  <div className="px-2.5 py-1 rounded bg-indigo-950/60 border border-indigo-500/40 text-[11px] font-mono text-indigo-300 flex items-center gap-1.5 animate-in fade-in">
                    <Check className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{saveEnvNotice}</span>
                  </div>
                )}
              </div>
            </div>

            {envViewMode === 'raw' ? (
              <div className="space-y-3">
                <textarea
                  value={rawEnvText}
                  onChange={(e) => setRawEnvText(e.target.value)}
                  spellCheck={false}
                  rows={14}
                  placeholder={'# One variable per line\nKEY=value'}
                  className="w-full font-mono text-xs bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500/60 resize-y"
                />
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-zinc-500 font-mono">
                    Edit as a .env file — one <span className="text-zinc-300">KEY=value</span> per line. Lines starting with # are ignored.
                  </p>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEnvViewMode('table')}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-medium cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveRawEnv}
                      disabled={isSavingRaw}
                      className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                    >
                      <Check className="w-3.5 h-3.5" />
                      <span>{isSavingRaw ? 'Saving…' : 'Save variables'}</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
            {/* Variables List */}
            <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30 divide-y divide-zinc-800">
              {envVars.length === 0 ? (
                <div className="p-6 text-center text-zinc-500 font-mono text-xs">
                  No custom environment variables configured. Add your first variable below.
                </div>
              ) : (
                envVars.map((v, idx) =>
                  editingIndex === idx ? (
                    <div key={idx} className="p-3 flex items-center gap-2 text-xs font-mono bg-zinc-900/40">
                      <input
                        value={editKey}
                        onChange={(e) => setEditKey(e.target.value)}
                        placeholder="KEY"
                        className="w-1/3 px-2 py-1 bg-zinc-950 border border-indigo-500/40 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                      />
                      <input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        placeholder="value"
                        className="flex-1 px-2 py-1 bg-zinc-950 border border-indigo-500/40 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                      />
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => saveEditVariable(idx)}
                          disabled={!editKey.trim() || isSavingEnv}
                          className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-950/40 disabled:opacity-40 rounded cursor-pointer"
                          title="Save changes"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setEditingIndex(null)}
                          className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded cursor-pointer"
                          title="Cancel"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div key={v.key || idx} className="p-3 flex items-center justify-between gap-3 text-xs font-mono">
                      <div className="w-1/3 font-semibold text-indigo-300 truncate">{v.key}</div>
                      <div className="flex-1 text-zinc-300 truncate bg-zinc-950/80 px-2.5 py-1 rounded border border-zinc-800">
                        {v.masked ? '••••••••••••••••••••••••' : v.value}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => startEditVariable(idx, v)}
                          className="p-1.5 text-zinc-400 hover:text-indigo-300 hover:bg-indigo-950/40 rounded cursor-pointer"
                          title="Edit variable"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
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
                  )
                )
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

              {/* System / container variables — hidden by default */}
              {systemEnvVars.length > 0 && (
                <div className="p-3 bg-zinc-950/40">
                  <button
                    type="button"
                    onClick={() => setShowSystemVars((s) => !s)}
                    className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 flex items-center gap-1.5 cursor-pointer"
                  >
                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showSystemVars ? 'rotate-180' : ''}`} />
                    {showSystemVars ? 'Hide' : 'Show'} {systemEnvVars.length} container system variable
                    {systemEnvVars.length === 1 ? '' : 's'}
                  </button>
                  {showSystemVars && (
                    <div className="mt-2 space-y-1">
                      {systemEnvVars.map((v, idx) => (
                        <div
                          key={v.key || idx}
                          className="flex items-center justify-between gap-3 text-[11px] font-mono text-zinc-500"
                        >
                          <span className="w-1/3 truncate">{v.key}</span>
                          <span className="flex-1 truncate text-zinc-600 bg-zinc-950/60 px-2 py-0.5 rounded border border-zinc-900">
                            {v.value}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Variable Referencing Tip */}
            <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 font-mono flex items-center justify-between">
              <span>Reference in other services via: <code className="text-indigo-400">${`{`}{`{`} {serviceName}.PORT {`}`}{`}`}</code></span>
              <span className="text-zinc-500">Auto-linking enabled</span>
            </div>
              </>
            )}
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
                Edge routing via Caddy with automatic Let&apos;s Encrypt TLS certificates. Point a DNS record at this server and Caddy issues the certificate automatically.
              </p>

              {/* Internal Bridge Host */}
              <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex items-center justify-between mb-4">
                <div>
                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Internal Bridge Host</div>
                  <div className="font-mono text-xs font-semibold text-zinc-200 mt-0.5">
                    {service.name}.paas-internal-network:{service.internalPort || service.port || 3000}
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

              {/* DNS target (server IP) */}
              {serverIp && (
                <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[10px] text-indigo-300 font-mono uppercase">DNS Target · point your domain here</div>
                    <div className="font-mono text-sm font-semibold text-zinc-100 mt-0.5">{serverIp}</div>
                    <div className="text-[11px] text-zinc-400 font-mono mt-1">
                      Create an <span className="text-zinc-200">A</span> record → {serverIp} (or a CNAME for subdomains).
                    </div>
                  </div>
                  <button
                    onClick={() => { try { navigator.clipboard.writeText(serverIp); } catch {} }}
                    className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded-lg text-xs font-mono flex items-center gap-1.5 cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy IP</span>
                  </button>
                </div>
              )}

              {/* Public Domains List */}
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-semibold text-zinc-300">Public Domains ({domains.length})</h4>
                {domains.length > 0 && (
                  <button
                    onClick={handleVerifyDomains}
                    disabled={isVerifying}
                    className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-200 border border-zinc-700 rounded-lg text-[11px] font-mono flex items-center gap-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3 h-3 ${isVerifying ? 'animate-spin' : ''}`} />
                    <span>Verify DNS</span>
                  </button>
                )}
              </div>
              {domains.length === 0 ? (
                <div className="p-3 rounded-lg border border-dashed border-zinc-800 text-[11px] text-zinc-500 font-mono">
                  No domains assigned yet. Set a base server domain in Settings → Domains to auto-assign{' '}
                  <code className="text-indigo-400">{'<service>.yourdomain.com'}</code>, or add a custom domain below.
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800 bg-zinc-950/60">
                  {domains.map((d) => {
                    const st = domainStatusMap[d];
                    const verified = st?.status === 'verified';
                    return (
                      <div key={d} className="p-3 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Globe className={`w-3.5 h-3.5 shrink-0 ${verified ? 'text-emerald-400' : 'text-amber-400'}`} />
                          <div className="min-w-0">
                            <a
                              href={`https://${d}`}
                              target="_blank"
                              rel="noreferrer"
                              className="font-mono text-xs text-zinc-200 hover:text-indigo-300 truncate block"
                            >
                              {d}
                            </a>
                            <div className="text-[10px] font-mono mt-0.5">
                              {verified ? (
                                <span className="text-emerald-400">Verified</span>
                              ) : (
                                <span className="text-amber-400">
                                  Pending{st?.lastError ? ` · ${st.lastError}` : ''}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${
                              verified
                                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                                : 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                            }`}
                          >
                            {verified ? 'verified' : 'pending'}
                          </span>
                          <a
                            href={`https://${d}`}
                            target="_blank"
                            rel="noreferrer"
                            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-md hover:bg-zinc-800"
                            title="Open"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </a>
                          <button
                            onClick={() => handleRemoveDomain(d)}
                            className="p-1.5 text-zinc-400 hover:text-red-400 rounded-md hover:bg-zinc-800 cursor-pointer"
                            title="Remove domain"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Add Custom Domain */}
            <div className="space-y-3">
              <h4 className="text-xs font-semibold text-zinc-300">Add Custom Domain</h4>
              <div className="flex items-center gap-2">
                <input
                  value={newDomain}
                  onChange={(e) => setNewDomain(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleAddDomain(); }}
                  placeholder="api.yourdomain.com"
                  className="flex-1 px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={handleAddDomain}
                  disabled={isSavingDomain || !newDomain.trim()}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  {isSavingDomain ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                  <span>Add Domain</span>
                </button>
              </div>

              {domainError && (
                <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-xs font-mono text-red-300 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400" />
                  <span>{domainError}</span>
                </div>
              )}

              <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800 text-[11px] text-zinc-400 font-mono">
                Add a <span className="text-zinc-200">CNAME</span> (or <span className="text-zinc-200">A</span> for apex) record pointing this host at the server, then Caddy auto-issues the TLS certificate on first request.
              </div>
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
                  <button
                    type="button"
                    onClick={() => setBuildMethod('slim')}
                    className={`px-4 py-1.5 rounded-md text-xs font-medium flex items-center gap-1.5 transition-all cursor-pointer ${
                      buildMethod === 'slim'
                        ? 'bg-amber-400 text-zinc-950 shadow-sm font-semibold'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    <span>Fast ⚡</span>
                  </button>
                </div>
                <p className="text-[11px] text-zinc-500">
                  Auto uses your repo's Dockerfile when present, else Railpack/Nixpacks. <strong className="text-amber-300/90">Fast</strong> generates a slim Node/Python/Go Dockerfile for quick cold builds &amp; smaller images.
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

                {/* NODE VERSION */}
                <div>
                  <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider block mb-1.5 font-mono">
                    Node Version
                  </label>
                  <input
                    value={nodeVersion}
                    onChange={(e) => setNodeVersion(e.target.value)}
                    placeholder="auto (defaults to 20)"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-500"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                    e.g. 20, 22. Used for Nixpacks &amp; the Fast preset. Leave blank to auto (repo pin, else 20).
                  </p>
                </div>

                {/* SYSTEM PACKAGES */}
                <div className="col-span-2">
                  <label className="text-[10px] font-semibold text-amber-300/90 uppercase tracking-wider block mb-1.5 font-mono flex items-center gap-1.5">
                    <Zap className="w-3 h-3" />
                    System Packages (Fast ⚡ preset)
                  </label>
                  <input
                    value={systemPackages}
                    onChange={(e) => setSystemPackages(e.target.value)}
                    placeholder="e.g. libpq-dev imagemagick git"
                    className="w-full px-3 py-2 bg-zinc-900/90 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
                  />
                  <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                    OS packages (apt on Debian bases) installed into the slim Fast image — use only with the Fast build method.
                  </p>
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
                        systemPackages: systemPackages.trim() || undefined,
                        nodeVersion: nodeVersion.trim() || undefined,
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
                      // Optimistically mark the canvas node as building right away.
                      onServiceUpdated?.({ ...service, status: 'building', phase: 'queued' });
                      // Stream live build logs immediately while the rebuild runs.
                      setActiveTab('logs');
                      setLogSubTab('build');
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
                          systemPackages: systemPackages.trim() || undefined,
                          nodeVersion: nodeVersion.trim() || undefined,
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

      {/* Bottom-right toast prompting a redeploy to apply variable changes */}
      {showRedeployToast && (
        <div className="fixed bottom-4 right-4 z-[70] w-80 rounded-xl border border-indigo-500/40 bg-zinc-900/95 backdrop-blur-md shadow-2xl p-3.5 animate-in slide-in-from-bottom-2 fade-in">
          <div className="flex items-start gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-zinc-100">Environment variables updated</div>
              <div className="text-[11px] text-zinc-400 mt-0.5">
                Redeploy to apply the changes to the running container.
              </div>
              <div className="flex items-center gap-2 mt-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setShowRedeployToast(false);
                    handleRedeployService();
                  }}
                  disabled={isRedeploying || isBuilding}
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <RotateCw className={`w-3.5 h-3.5 ${isRedeploying ? 'animate-spin' : ''}`} />
                  <span>{isRedeploying ? 'Redeploying…' : 'Redeploy'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRedeployToast(false)}
                  className="px-2.5 py-1.5 text-zinc-400 hover:text-zinc-200 text-xs font-medium cursor-pointer"
                >
                  Later
                </button>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowRedeployToast(false)}
              className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded cursor-pointer shrink-0"
              title="Dismiss"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </>
  );
}
