'use client';

import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  GitBranch,
  Lock,
  Globe,
  Star,
  ExternalLink,
  X,
  KeyRound,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  RefreshCw,
  Unlink,
  FolderGit2,
  Settings2,
  ChevronDown,
  Check,
  Building2
} from 'lucide-react';

export function GitHubIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
    </svg>
  );
}

import {
  fetchGitHubStatus,
  fetchGitHubOAuthUrl,
  saveGitHubOAuthConfig,
  saveGitHubToken,
  disconnectGitHub,
  resetGitHubAppConfig,
  fetchGitHubRepos,
  fetchGitHubBranches,
  fetchPublicGitHubRepo,
  detectGitHubRepoBuild,
  fetchEnvSuggestions,
  deployGitHubRepo,
  GitHubRepo,
  GitHubStatus,
  DetectedSubfolder,
  BuildDetectionResult,
  EnvSuggestion,
} from '@/lib/api';

export interface PendingDeployInfo {
  tempId: string;
  name: string;
  repoName: string;
  cloneUrl: string;
  branch: string;
  subfolder?: string;
  port: number;
  buildStrategy: string;
}

interface GitHubRepoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeployStart?: (info: PendingDeployInfo) => void;
  onDeploySuccess: (service: any, gitInfo: any, tempId?: string) => void;
  onDeployError?: (tempId: string, error: string, name: string) => void;
}

export function GitHubRepoModal({
  isOpen,
  onClose,
  onDeployStart,
  onDeploySuccess,
  onDeployError,
}: GitHubRepoModalProps) {
  const [activeTab, setActiveTab] = useState<'account' | 'public'>('account');
  const [status, setStatus] = useState<GitHubStatus>({ connected: false, method: 'none' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Setup options
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showConfigOAuth, setShowConfigOAuth] = useState(false);
  const [oauthClientId, setOauthClientId] = useState('');
  const [oauthClientSecret, setOauthClientSecret] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('http://localhost:4000/api/github/oauth/callback');

  // Account Repos state
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState<string>('all');
  const [selectedRepo, setSelectedRepo] = useState<GitHubRepo | null>(null);

  // Public Repo URL state
  const [publicInput, setPublicInput] = useState('');
  const [isFetchingPublic, setIsFetchingPublic] = useState(false);

  // Deploy configuration state
  const [branches, setBranches] = useState<string[]>(['main']);
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [subfolders, setSubfolders] = useState<DetectedSubfolder[]>([]);
  const [selectedSubfolder, setSelectedSubfolder] = useState<string>('.');
  const [customSubfolder, setCustomSubfolder] = useState<string>('');
  const [isCustomMode, setIsCustomMode] = useState<boolean>(false);
  const [dockerfilePath, setDockerfilePath] = useState<string>('');
  const [buildMethod, setBuildMethod] = useState<'auto' | 'railpack' | 'dockerfile' | 'slim'>('auto');
  const [port, setPort] = useState(3000);
  const [portModifiedManually, setPortModifiedManually] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);
  const [detectedBuild, setDetectedBuild] = useState<BuildDetectionResult | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);

  // Pre-deploy environment variables
  const [deployEnvVars, setDeployEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvValue, setNewEnvValue] = useState('');
  const [envSuggestions, setEnvSuggestions] = useState<EnvSuggestion[]>([]);
  const [isScanningEnv, setIsScanningEnv] = useState(false);

  // Load initial status and repos on open
  useEffect(() => {
    if (!isOpen) return;
    setSelectedRepo(null); // Reset selection every time the modal opens
    loadStatusAndRepos();
  }, [isOpen]);

  // Auto-refresh when user returns to this window from GitHub configuration
  useEffect(() => {
    const handleFocus = () => {
      if (isOpen && status.connected) {
        loadStatusAndRepos();
      }
    };
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === 'GITHUB_AUTH_SUCCESS' && isOpen) {
        loadStatusAndRepos();
      }
    };
    window.addEventListener('focus', handleFocus);
    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('message', handleMessage);
    };
  }, [isOpen, status.connected]);

  async function loadStatusAndRepos() {
    setLoading(true);
    setError(null);
    try {
      const s = await fetchGitHubStatus();
      setStatus(s);
      const oauthInfo = await fetchGitHubOAuthUrl().catch(() => null);
      if (oauthInfo) {
        setCallbackUrl(oauthInfo.callbackUrl);
      }
      if (s.connected) {
        const r = await fetchGitHubRepos();
        setRepos(r);
        // Do not auto-select — let the user choose
      } else {
        setRepos([]);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // 1-Click Railway-style OAuth & Manifest connect
  async function handleConnectOAuth() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGitHubOAuthUrl();
      if (data.configured && data.url) {
        window.open(data.url, 'github_oauth', 'width=650,height=800,menubar=no,toolbar=no');
      } else if (data.manifest && data.postUrl) {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = data.postUrl;
        form.target = 'github_oauth';

        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = 'manifest';
        input.value = typeof data.manifest === 'string' ? data.manifest : JSON.stringify(data.manifest);
        form.appendChild(input);

        document.body.appendChild(form);
        window.open('', 'github_oauth', 'width=650,height=800,menubar=no,toolbar=no');
        form.submit();
        setTimeout(() => {
          if (document.body.contains(form)) {
            document.body.removeChild(form);
          }
        }, 500);
      } else {
        const targetUrl = data.manifestStartUrl || 'http://localhost:4000/api/github/manifest/start';
        window.open(targetUrl, 'github_oauth', 'width=650,height=800,menubar=no,toolbar=no');
      }

      const handleMessage = async (e: MessageEvent) => {
        if (e.data?.type === 'GITHUB_AUTH_SUCCESS') {
          window.removeEventListener('message', handleMessage);
          await loadStatusAndRepos();
        }
      };
      window.addEventListener('message', handleMessage);
    } catch (err: any) {
      setError(err.message || 'Failed to start GitHub authorization');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveOAuth(e: React.FormEvent) {
    e.preventDefault();
    if (!oauthClientId.trim() || !oauthClientSecret.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const updated = await saveGitHubOAuthConfig(oauthClientId.trim(), oauthClientSecret.trim());
      setStatus(updated);
      setShowConfigOAuth(false);
      // Immediately trigger connect
      const data = await fetchGitHubOAuthUrl();
      if (data.configured && data.url) {
        window.open(data.url, 'github_oauth', 'width=600,height=750,menubar=no,toolbar=no');
        const handleMessage = async (e: MessageEvent) => {
          if (e.data?.type === 'GITHUB_AUTH_SUCCESS') {
            window.removeEventListener('message', handleMessage);
            await loadStatusAndRepos();
          }
        };
        window.addEventListener('message', handleMessage);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to save OAuth credentials');
    } finally {
      setLoading(false);
    }
  }

  async function handleConnectToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenInput.trim()) return;

    setLoading(true);
    setError(null);
    try {
      const s = await saveGitHubToken(tokenInput.trim());
      setStatus(s);
      setTokenInput('');
      setShowTokenInput(false);
      const r = await fetchGitHubRepos();
      setRepos(r);
      // Do not auto-select — let the user choose
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDisconnect() {
    setLoading(true);
    setError(null);
    try {
      const s = await disconnectGitHub();
      setStatus(s);
      setRepos([]);
      setSelectedRepo(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function parseGitHubInput(input: string): { owner: string; repo: string } | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const urlMatch = trimmed.match(/github\.com\/([^/]+)\/([^/.]+)/);
    if (urlMatch) {
      return { owner: urlMatch[1], repo: urlMatch[2] };
    }

    const parts = trimmed.split('/');
    if (parts.length === 2 && parts[0] && parts[1]) {
      return { owner: parts[0].trim(), repo: parts[1].replace(/\.git$/, '').trim() };
    }

    return null;
  }

  async function handleFetchPublicRepo(e: React.FormEvent) {
    e.preventDefault();
    const parsed = parseGitHubInput(publicInput);
    if (!parsed) {
      setError('Please enter a valid GitHub URL (e.g. https://github.com/owner/repo) or owner/repo shorthand.');
      return;
    }

    setIsFetchingPublic(true);
    setError(null);

    try {
      const repo = await fetchPublicGitHubRepo(parsed.owner, parsed.repo);
      setSelectedRepo(repo);
      setSelectedBranch(repo.defaultBranch || 'main');
      const bList = await fetchGitHubBranches(repo.owner, repo.name).catch(() => [repo.defaultBranch || 'main']);
      setBranches(bList.length > 0 ? bList : ['main']);
    } catch (err: any) {
      setError(err.message || `Could not find public repository "${parsed.owner}/${parsed.repo}".`);
    } finally {
      setIsFetchingPublic(false);
    }
  }

  // Load branches and reset subfolders when selectedRepo changes
  useEffect(() => {
    if (!selectedRepo) return;
    setSelectedBranch(selectedRepo.defaultBranch || 'main');
    setSelectedSubfolder('.');
    setCustomSubfolder('');
    setIsCustomMode(false);
    setDockerfilePath('');
    setBuildMethod('auto');
    setPortModifiedManually(false);
    fetchGitHubBranches(selectedRepo.owner, selectedRepo.name)
      .then((b) => {
        if (b && b.length > 0) setBranches(b);
      })
      .catch(() => {
        setBranches([selectedRepo.defaultBranch || 'main']);
      });
  }, [selectedRepo]);

  const activeSubfolderPath = isCustomMode ? customSubfolder.trim() : selectedSubfolder;

  // Inspect repository for subfolders, Dockerfile vs Nixpacks whenever repo, branch, or target subfolder changes
  useEffect(() => {
    if (!selectedRepo) {
      setDetectedBuild(null);
      setSubfolders([]);
      return;
    }
    setIsDetecting(true);
    detectGitHubRepoBuild(
      selectedRepo.owner,
      selectedRepo.name,
      selectedBranch,
      activeSubfolderPath || undefined,
      dockerfilePath.trim() || undefined
    )
      .then((data) => {
        setDetectedBuild(data);
        if (data.subfolders && data.subfolders.length > 0) {
          setSubfolders(data.subfolders);
        }
        if (!portModifiedManually && data.suggestedPort) {
          setPort(data.suggestedPort);
        }
      })
      .catch(() => setDetectedBuild(null))
      .finally(() => setIsDetecting(false));
  }, [selectedRepo, selectedBranch, activeSubfolderPath, dockerfilePath, portModifiedManually]);

  // Scan the repo for env vars the project uses — only when the user clicks.
  async function scanEnvSuggestions() {
    if (!selectedRepo || isScanningEnv) return;
    setIsScanningEnv(true);
    try {
      const sug = await fetchEnvSuggestions(
        selectedRepo.owner,
        selectedRepo.name,
        selectedBranch,
        activeSubfolderPath || undefined
      );
      // Only surface vars the user hasn't already added.
      const existing = new Set(deployEnvVars.map((v) => v.key));
      setEnvSuggestions(sug.filter((s) => !existing.has(s.key)));
    } catch {
      setEnvSuggestions([]);
    } finally {
      setIsScanningEnv(false);
    }
  }

  function acceptSuggestion(s: EnvSuggestion) {
    setDeployEnvVars((prev) =>
      prev.some((v) => v.key === s.key) ? prev : [...prev, { key: s.key, value: '' }]
    );
    setEnvSuggestions((prev) => prev.filter((x) => x.key !== s.key));
  }

  function rejectSuggestion(key: string) {
    setEnvSuggestions((prev) => prev.filter((x) => x.key !== key));
  }

  // Auto-scan for suggested variables when a repo/branch/subfolder is chosen.
  useEffect(() => {
    if (!isOpen || !selectedRepo) {
      setEnvSuggestions([]);
      return;
    }
    let cancelled = false;
    setIsScanningEnv(true);
    fetchEnvSuggestions(selectedRepo.owner, selectedRepo.name, selectedBranch, activeSubfolderPath || undefined)
      .then((sug) => {
        if (cancelled) return;
        const existing = new Set(deployEnvVars.map((v) => v.key));
        setEnvSuggestions(sug.filter((s) => !existing.has(s.key)));
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsScanningEnv(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, selectedRepo?.id, selectedBranch, activeSubfolderPath]);

  function handleSubfolderSelect(path: string) {
    if (path === '__custom__') {
      setIsCustomMode(true);
      return;
    }
    setIsCustomMode(false);
    setSelectedSubfolder(path);
    setPortModifiedManually(false);
    const sf = subfolders.find((s) => s.path === path);
    if (sf && sf.suggestedPort) {
      setPort(sf.suggestedPort);
    }
  }

  async function handleDeploy() {
    if (!selectedRepo) return;
    setError(null);

    const targetSubfolder = isCustomMode
      ? customSubfolder.trim() || undefined
      : selectedSubfolder !== '.'
      ? selectedSubfolder
      : undefined;

    const cleanSubfolder = (targetSubfolder || '').trim().replace(/^\/+|\/+$/g, '');
    const subName = cleanSubfolder && cleanSubfolder !== '.'
      ? `${selectedRepo.name}-${cleanSubfolder.split('/').pop()}`
      : selectedRepo.name;

    const tempId = 'deploying-' + Date.now();
    const strategy =
      buildMethod === 'slim'
        ? 'slim'
        : buildMethod === 'dockerfile'
        ? 'dockerfile'
        : buildMethod === 'railpack'
        ? 'nixpacks'
        : detectedBuild?.hasDockerfile
        ? 'dockerfile'
        : 'nixpacks';

    // Collect pre-deploy environment variables (ignore blank keys)
    const envRecord: Record<string, string> = {};
    for (const { key, value } of deployEnvVars) {
      const k = key.trim();
      if (k) envRecord[k] = value;
    }

    // 1. Notify parent that deployment has started so it can show the service on the canvas immediately!
    onDeployStart?.({
      tempId,
      name: subName,
      repoName: selectedRepo.name,
      cloneUrl: selectedRepo.cloneUrl || `https://github.com/${selectedRepo.owner || 'blockchainbard'}/${selectedRepo.name}.git`,
      branch: selectedBranch,
      subfolder: targetSubfolder,
      port,
      buildStrategy: strategy,
    });

    // 2. Immediately close modal as requested:
    // "when its deploying close the modal, then show the services, then show building/deploying on that particular service"
    onClose();

    // 3. Perform build and deploy asynchronously in background
    try {
      const res = await deployGitHubRepo(
        selectedRepo.name,
        selectedBranch,
        selectedRepo.cloneUrl,
        port,
        envRecord,
        targetSubfolder,
        dockerfilePath.trim() || undefined,
        buildMethod,
        'web',
        undefined,
        undefined,
        undefined,
        tempId
      );
      onDeploySuccess(res.service, res.git, tempId);
    } catch (err: any) {
      onDeployError?.(tempId, err.message || 'Build and deploy failed', subName);
    }
  }

  const availableOwners = useMemo(() => {
    const set = new Set<string>();
    repos.forEach((r) => {
      if (r.owner) set.add(r.owner);
    });
    return Array.from(set);
  }, [repos]);

  const filteredRepos = useMemo(() => {
    return repos.filter(
      (r) =>
        (ownerFilter === 'all' || r.owner.toLowerCase() === ownerFilter.toLowerCase()) &&
        (r.name.toLowerCase().includes(search.toLowerCase()) ||
          r.fullName.toLowerCase().includes(search.toLowerCase()) ||
          (r.description && r.description.toLowerCase().includes(search.toLowerCase())))
    );
  }, [repos, ownerFilter, search]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-4xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] text-zinc-100 font-sans">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-zinc-900 rounded-xl border border-zinc-700/60 flex items-center justify-center text-zinc-100 shadow-md">
              <GitHubIcon className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-zinc-100 flex items-center gap-2">
                <span>Deploy from GitHub</span>
                {status.connected ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                    <span>Connected (@{status.user?.login})</span>
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-[10px] font-mono">
                    Ready to Connect
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400">
                Deploy repositories as live containers with automatic rebuilds on git push
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {status.connected && (
              <button
                onClick={handleDisconnect}
                disabled={loading}
                className="px-2.5 py-1 text-zinc-400 hover:text-red-400 hover:bg-zinc-800 rounded-lg text-xs font-mono transition-colors flex items-center gap-1 cursor-pointer"
                title="Disconnect GitHub account"
              >
                <Unlink className="w-3.5 h-3.5" />
                <span>Disconnect</span>
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center px-6 border-b border-zinc-800/80 bg-zinc-900/30 gap-6 text-xs font-medium">
          <button
            onClick={() => setActiveTab('account')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'account'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <FolderGit2 className="w-4 h-4" />
            <span>My Repositories</span>
            {status.connected && repos.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-zinc-800 text-zinc-400 text-[10px] font-mono">
                {repos.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('public')}
            className={`py-3 flex items-center gap-2 border-b-2 transition-all cursor-pointer ${
              activeTab === 'public'
                ? 'border-indigo-500 text-indigo-400 font-semibold'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Globe className="w-4 h-4" />
            <span>Public Repository</span>
          </button>
        </div>

        {/* Error notice banner */}
        {error && (
          <div className="mx-6 mt-3 px-3 py-2 bg-red-950/40 border border-red-500/30 rounded-lg text-xs text-red-300 font-mono flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-zinc-400 hover:text-zinc-200">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Main Content: Split View (Repos List/Public Input on Left, Config on Right) */}
        <div className="flex-1 flex overflow-hidden p-6 gap-6 min-h-[400px]">
          {/* Left Column */}
          <div className="flex-1 flex flex-col border border-zinc-800 rounded-xl bg-zinc-900/20 overflow-hidden">
            {activeTab === 'account' ? (
              !status.connected ? (
                /* Railway-style 1-Click Connect Screen */
                <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-5 overflow-y-auto">
                  <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-xl">
                    <GitHubIcon className="w-8 h-8 text-zinc-100" />
                  </div>

                  <div className="max-w-md">
                    <h4 className="font-semibold text-base text-zinc-100">Connect your GitHub Account</h4>
                    <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">
                      Link your GitHub account to import repositories and enable automated deployments on every git push.
                    </p>
                  </div>

                  {/* Primary Railway Connect Button */}
                  <div className="flex flex-col items-center gap-3 w-full max-w-xs">
                    <button
                      onClick={handleConnectOAuth}
                      disabled={loading}
                      className="w-full py-3 px-5 bg-white hover:bg-zinc-200 text-zinc-950 font-semibold rounded-xl text-xs flex items-center justify-center gap-2.5 transition-all shadow-lg hover:shadow-white/10 cursor-pointer disabled:opacity-50"
                    >
                      <GitHubIcon className="w-4 h-4 fill-current" />
                      <span>{loading ? 'Connecting...' : 'Connect GitHub Account'}</span>
                    </button>

                    <div className="flex items-center gap-3 text-[11px] text-zinc-500 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setShowTokenInput(!showTokenInput);
                          setShowConfigOAuth(false);
                        }}
                        className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer underline"
                      >
                        {showTokenInput ? 'Hide token field' : 'Use Personal Access Token'}
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => {
                          setShowConfigOAuth(!showConfigOAuth);
                          setShowTokenInput(false);
                        }}
                        className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        {showConfigOAuth ? 'Hide App config' : 'OAuth App settings'}
                      </button>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setActiveTab('public')}
                        className="text-zinc-400 hover:text-zinc-200 transition-colors cursor-pointer"
                      >
                        Deploy public repo &rarr;
                      </button>
                    </div>
                  </div>

                  {/* Optional PAT inline form */}
                  {showTokenInput && (
                    <form onSubmit={handleConnectToken} className="w-full max-w-sm pt-4 border-t border-zinc-800/80 space-y-2.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <label className="font-mono text-zinc-400">Personal Access Token</label>
                        <a
                          href="https://github.com/settings/tokens/new?scopes=repo,admin:repo_hook&description=PaaS-Control-Plane"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-indigo-400 hover:text-indigo-300 underline"
                        >
                          Create token on GitHub
                        </a>
                      </div>
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          value={tokenInput}
                          onChange={(e) => setTokenInput(e.target.value)}
                          placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                          className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700/80 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                        <button
                          type="submit"
                          disabled={loading || !tokenInput.trim()}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer shrink-0"
                        >
                          Connect
                        </button>
                      </div>
                    </form>
                  )}

                  {/* Optional OAuth App Server Config Form */}
                  {showConfigOAuth && (
                    <div className="w-full max-w-md pt-4 border-t border-zinc-800/80 text-left space-y-3 p-4 rounded-xl bg-zinc-900/60 border border-zinc-800">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <Settings2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>Configure GitHub OAuth App</span>
                        </span>
                        <button onClick={() => setShowConfigOAuth(false)} className="text-zinc-500 hover:text-zinc-300">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[11px] text-zinc-400 leading-relaxed">
                        To enable 1-click "Connect GitHub" on this server, register a free OAuth app in your GitHub settings:
                      </p>
                      <div className="p-2 rounded bg-zinc-950 font-mono text-[10px] text-zinc-300 space-y-1">
                        <div><span className="text-zinc-500">Authorization callback URL:</span> {callbackUrl}</div>
                      </div>
                      <form onSubmit={handleSaveOAuth} className="space-y-2">
                        <input
                          type="text"
                          value={oauthClientId}
                          onChange={(e) => setOauthClientId(e.target.value)}
                          placeholder="GitHub Client ID"
                          className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200"
                        />
                        <input
                          type="password"
                          value={oauthClientSecret}
                          onChange={(e) => setOauthClientSecret(e.target.value)}
                          placeholder="GitHub Client Secret"
                          className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200"
                        />
                        <button
                          type="submit"
                          disabled={loading || !oauthClientId.trim() || !oauthClientSecret.trim()}
                          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold cursor-pointer"
                        >
                          Save &amp; Connect
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            if (!confirm('Reset current GitHub App and OAuth configuration on this server?')) return;
                            setLoading(true);
                            try {
                              const s = await resetGitHubAppConfig();
                              setStatus(s);
                              setShowConfigOAuth(false);
                              setOauthClientId('');
                              setOauthClientSecret('');
                            } catch (err: any) {
                              setError(err.message);
                            } finally {
                              setLoading(false);
                            }
                          }}
                          disabled={loading}
                          className="w-full py-1.5 bg-zinc-800 hover:bg-rose-950/60 hover:text-rose-300 text-zinc-400 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                        >
                          Reset / Re-create App
                        </button>
                      </form>
                    </div>
                  )}
                </div>
              ) : (
                /* Connected: Repos list */
                <>
                  <div className="p-3 border-b border-zinc-800 bg-zinc-900/40 flex items-center justify-between gap-2">
                    <div className="relative flex-1">
                      <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
                      <input
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search your repositories..."
                        className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 font-mono"
                      />
                    </div>

                    <button
                      onClick={loadStatusAndRepos}
                      disabled={loading}
                      className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                      title="Refresh Repositories"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  {/* Account / Organization Filter Pills */}
                  {availableOwners.length > 1 && (
                    <div className="px-3 py-1.5 border-b border-zinc-800/80 bg-zinc-900/30 flex items-center gap-1.5 overflow-x-auto text-[11px] font-mono scrollbar-none">
                      <span className="text-zinc-500 text-[10px] uppercase font-sans mr-1">Owner:</span>
                      <button
                        onClick={() => setOwnerFilter('all')}
                        className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                          ownerFilter === 'all'
                            ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                        }`}
                      >
                        All ({repos.length})
                      </button>
                      {availableOwners.map((owner) => {
                        const count = repos.filter((r) => r.owner.toLowerCase() === owner.toLowerCase()).length;
                        const isOrg = status.user?.login?.toLowerCase() !== owner.toLowerCase();
                        return (
                          <button
                            key={owner}
                            onClick={() => setOwnerFilter(owner)}
                            className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors flex items-center gap-1 ${
                              ownerFilter.toLowerCase() === owner.toLowerCase()
                                ? 'bg-indigo-600/30 text-indigo-300 border border-indigo-500/40'
                                : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800'
                            }`}
                          >
                            {isOrg && <Building2 className="w-3 h-3 text-indigo-400" />}
                            <span>{owner}</span>
                            <span className="text-zinc-500 text-[10px]">({count})</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  {/* Organization & Repo Access Banner */}
                  <div className="px-3.5 py-2 border-b border-zinc-800/60 bg-zinc-900/30 flex items-center justify-between text-xs gap-3">
                    <div className="flex items-center gap-2 text-zinc-400 text-[11px] truncate">
                      <Building2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <span className="truncate">Need repos from an organization or want to select specific repos?</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <a
                        href={
                          status.appInstallUrl ||
                          (status.appSlug
                            ? `https://github.com/apps/${status.appSlug}/installations/select_target`
                            : status.clientId
                            ? `https://github.com/settings/connections/applications/${status.clientId}`
                            : 'https://github.com/settings/applications')
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 border border-indigo-500/30 text-indigo-300 text-[11px] font-mono transition-colors flex items-center gap-1.5"
                        title="Configure repository and organization permissions on GitHub"
                      >
                        <span>Configure Access &rarr;</span>
                      </a>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y divide-zinc-900 p-2 space-y-1">
                    {filteredRepos.length > 0 ? (
                      filteredRepos.map((repo) => {
                        const isSelected = selectedRepo?.id === repo.id;
                        return (
                          <button
                            key={repo.id}
                            onClick={() => setSelectedRepo(repo)}
                            className={`w-full p-3 rounded-xl text-left transition-all cursor-pointer flex flex-col gap-1.5 border ${
                              isSelected
                                ? 'bg-indigo-600/15 border-indigo-500/40 text-indigo-100 shadow-sm'
                                : 'border-transparent hover:bg-zinc-900/60 text-zinc-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 truncate">
                                {repo.private ? (
                                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                                ) : (
                                  <Globe className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                                )}
                                <span className="font-semibold text-xs font-mono truncate">{repo.fullName}</span>
                              </div>

                              {repo.language && (
                                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 border border-zinc-700/50">
                                  {repo.language}
                                </span>
                              )}
                            </div>

                            {repo.description && (
                              <p className="text-[11px] text-zinc-400 line-clamp-1 font-sans">{repo.description}</p>
                            )}

                            <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono mt-0.5">
                              <span className="flex items-center gap-1">
                                <GitBranch className="w-3 h-3 text-zinc-500" />
                                <span>{repo.defaultBranch}</span>
                              </span>
                              <span>•</span>
                              <span className="flex items-center gap-1">
                                <Star className="w-3 h-3 text-amber-500/80" />
                                <span>{repo.stars}</span>
                              </span>
                            </div>
                          </button>
                        );
                      })
                    ) : (
                      <div className="p-8 text-center text-zinc-500 text-xs">
                        {search ? `No repositories match "${search}"` : 'No repositories found in your account.'}
                      </div>
                    )}
                  </div>
                </>
              )
            ) : (
              /* Public Repository Mode */
              <div className="flex-1 flex flex-col p-6 space-y-5 justify-center">
                <div className="space-y-1">
                  <h4 className="font-semibold text-sm text-zinc-100 flex items-center gap-2">
                    <Globe className="w-4 h-4 text-indigo-400" />
                    <span>Deploy Any Public Repository</span>
                  </h4>
                  <p className="text-xs text-zinc-400 leading-relaxed">
                    Paste any open-source GitHub repository URL or shorthand (<code className="text-zinc-300 font-mono">owner/repo</code>) to build and deploy without needing a Personal Access Token.
                  </p>
                </div>

                <form onSubmit={handleFetchPublicRepo} className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={publicInput}
                      onChange={(e) => setPublicInput(e.target.value)}
                      placeholder="https://github.com/facebook/react or vercel/next.js"
                      className="w-full px-4 py-2.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isFetchingPublic || !publicInput.trim()}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {isFetchingPublic ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        <span>Inspecting Repository...</span>
                      </>
                    ) : (
                      <>
                        <Search className="w-3.5 h-3.5" />
                        <span>Fetch &amp; Configure Repository</span>
                      </>
                    )}
                  </button>
                </form>

                {selectedRepo && activeTab === 'public' && (
                  <div className="p-4 rounded-xl bg-indigo-600/10 border border-indigo-500/30 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Globe className="w-4 h-4 text-indigo-400" />
                        <span className="font-mono text-xs font-semibold text-indigo-200">
                          {selectedRepo.fullName}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-900/50 text-indigo-300 border border-indigo-500/30">
                        {selectedRepo.defaultBranch}
                      </span>
                    </div>
                    {selectedRepo.description && (
                      <p className="text-[11px] text-zinc-300 font-sans line-clamp-2">
                        {selectedRepo.description}
                      </p>
                    )}
                    <div className="text-[10px] text-zinc-400 font-mono flex items-center gap-3">
                      <span>★ {selectedRepo.stars}</span>
                      {selectedRepo.language && <span>Language: {selectedRepo.language}</span>}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Right Column: Deployment Configuration */}
          <div className="w-80 flex flex-col border border-zinc-800/80 rounded-xl bg-zinc-900/20 overflow-hidden">
            {selectedRepo ? (
              <>
                {/* Repo identity header */}
                <div className="px-4 py-3 bg-zinc-900/60 border-b border-zinc-800/60">
                  <p className="text-[10px] font-semibold text-zinc-500 uppercase tracking-widest mb-0.5">Target Repository</p>
                  <h4 className="text-sm font-bold text-zinc-100 font-mono truncate">{selectedRepo.name}</h4>
                  <p className="text-[11px] text-zinc-500 font-mono">{selectedRepo.owner}</p>
                </div>

                {/* Scrollable config fields */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-5 scrollbar-thin scrollbar-thumb-zinc-800">

                  {/* Branch */}
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1.5">
                      Deploy Branch
                    </label>
                    <select
                      value={selectedBranch}
                      onChange={(e) => setSelectedBranch(e.target.value)}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60 cursor-pointer"
                    >
                      {branches.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>

                  {/* Root Directory */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                        <FolderGit2 className="w-3 h-3 text-indigo-400" />
                        Root Directory
                      </label>
                      {subfolders.length > 1 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-mono">
                          {subfolders.length} apps
                        </span>
                      )}
                    </div>

                    {!isCustomMode ? (
                      <div className="space-y-2">
                        <select
                          value={selectedSubfolder}
                          onChange={(e) => handleSubfolderSelect(e.target.value)}
                          className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60 cursor-pointer"
                        >
                          {subfolders.length > 0 ? (
                            subfolders.map((sf) => (
                              <option key={sf.path} value={sf.path}>{sf.name}</option>
                            ))
                          ) : (
                            <option value=".">Root (/) — Whole Repository</option>
                          )}
                          <option value="__custom__">+ Custom path…</option>
                        </select>

                        {subfolders.length > 1 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {subfolders.map((sf) => {
                              const chosen = selectedSubfolder === sf.path;
                              const dot = sf.framework?.includes('Next.js')
                                ? 'bg-cyan-400'
                                : sf.framework?.includes('NestJS')
                                ? 'bg-red-400'
                                : 'bg-indigo-400';
                              return (
                                <button
                                  key={sf.path}
                                  type="button"
                                  onClick={() => handleSubfolderSelect(sf.path)}
                                  className={`px-2 py-1 rounded-md text-[10px] font-mono border flex items-center gap-1.5 cursor-pointer transition-all ${
                                    chosen
                                      ? 'bg-indigo-600/20 border-indigo-500/50 text-indigo-200'
                                      : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200'
                                  }`}
                                >
                                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                                  {sf.path === '.' ? 'root' : sf.path}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            value={customSubfolder}
                            onChange={(e) => setCustomSubfolder(e.target.value)}
                            placeholder="apps/web"
                            className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60 placeholder:text-zinc-700"
                          />
                          <button
                            type="button"
                            onClick={() => { setIsCustomMode(false); setSelectedSubfolder('.'); }}
                            className="px-2.5 py-2 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-400 rounded-lg text-xs font-mono transition-colors cursor-pointer"
                          >
                            ✕
                          </button>
                        </div>
                        <p className="text-[10px] text-zinc-600">Relative path with package.json or Dockerfile</p>
                      </div>
                    )}
                  </div>

                  {/* Build Method */}
                  <div>
                    <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider block mb-1.5">
                      Build Method
                    </label>
                    <div className="grid grid-cols-4 gap-1 p-1 bg-zinc-950/80 border border-zinc-800 rounded-lg">
                      {(['auto', 'railpack', 'dockerfile', 'slim'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setBuildMethod(m)}
                          className={`py-1.5 rounded-md text-[11px] font-medium transition-all cursor-pointer ${
                            buildMethod === m
                              ? 'bg-indigo-600 text-white shadow shadow-indigo-600/30'
                              : 'text-zinc-500 hover:text-zinc-300'
                          }`}
                        >
                          {m === 'auto'
                            ? 'Auto'
                            : m === 'railpack'
                            ? 'Nixpacks'
                            : m === 'dockerfile'
                            ? 'Dockerfile'
                            : 'Fast ⚡'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dockerfile Path */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                        Dockerfile Path
                      </label>
                      <span className="text-[10px] text-zinc-700 italic">optional</span>
                    </div>
                    <input
                      type="text"
                      value={dockerfilePath}
                      onChange={(e) => setDockerfilePath(e.target.value)}
                      placeholder="Dockerfile.prod"
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-300 focus:outline-none focus:border-indigo-500/60 placeholder:text-zinc-700"
                    />
                    {detectedBuild?.dockerfilePaths && detectedBuild.dockerfilePaths.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <span className="text-[10px] text-zinc-600">Found:</span>
                        {detectedBuild.dockerfilePaths.slice(0, 3).map((df) => (
                          <button
                            key={df}
                            type="button"
                            onClick={() => { setDockerfilePath(df); setBuildMethod('dockerfile'); }}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 border border-cyan-500/20 transition-colors cursor-pointer"
                          >
                            {df}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Port */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                        Container Port
                      </label>
                      {detectedBuild?.suggestedPort && (
                        <span className="text-[10px] text-zinc-600 font-mono">
                          auto: {detectedBuild.suggestedPort}
                        </span>
                      )}
                    </div>
                    <input
                      type="number"
                      value={port}
                      onChange={(e) => {
                        setPort(parseInt(e.target.value, 10) || 3000);
                        setPortModifiedManually(true);
                      }}
                      className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500/60"
                    />
                  </div>

                  {/* Environment Variables */}
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">
                        Environment Variables
                      </label>
                      <button
                        type="button"
                        onClick={scanEnvSuggestions}
                        disabled={!selectedRepo || isScanningEnv}
                        className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300 disabled:opacity-40 flex items-center gap-1 cursor-pointer"
                        title="Scan the repository for variables this project uses"
                      >
                        {isScanningEnv ? (
                          <>
                            <RefreshCw className="w-3 h-3 animate-spin" /> scanning…
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3" /> Scan repo for variables
                          </>
                        )}
                      </button>
                    </div>
                    {deployEnvVars.length > 0 && (
                      <div className="space-y-1.5 mb-2">
                        {deployEnvVars.map((v, i) => (
                          <div key={i} className="flex items-center gap-1.5">
                            <span className="w-1/3 text-[11px] font-mono text-indigo-300 truncate">{v.key}</span>
                            <input
                              value={v.value}
                              onChange={(e) =>
                                setDeployEnvVars(
                                  deployEnvVars.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x))
                                )
                              }
                              placeholder="value"
                              className="flex-1 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-indigo-500/60"
                            />
                            <button
                              type="button"
                              onClick={() => setDeployEnvVars(deployEnvVars.filter((_, idx) => idx !== i))}
                              className="p-1 text-red-400 hover:text-red-300 hover:bg-red-950/40 rounded cursor-pointer"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5">
                      <input
                        value={newEnvKey}
                        onChange={(e) => setNewEnvKey(e.target.value)}
                        placeholder="KEY"
                        className="w-1/3 px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-indigo-500/60"
                      />
                      <input
                        value={newEnvValue}
                        onChange={(e) => setNewEnvValue(e.target.value)}
                        placeholder="value"
                        className="flex-1 px-2 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-[11px] font-mono text-zinc-200 placeholder:text-zinc-700 focus:outline-none focus:border-indigo-500/60"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (!newEnvKey.trim()) return;
                          setDeployEnvVars([...deployEnvVars, { key: newEnvKey.trim(), value: newEnvValue }]);
                          setNewEnvKey('');
                          setNewEnvValue('');
                        }}
                        disabled={!newEnvKey.trim()}
                        className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 text-zinc-200 rounded-lg text-[11px] transition-colors cursor-pointer"
                      >
                        Add
                      </button>
                    </div>

                    {/* Suggested variables — accept or reject (no auto-fill) */}
                    {envSuggestions.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-zinc-800/60">
                        <div className="text-[10px] text-zinc-500 mb-1.5">
                          Suggested from repo — click ✓ to add:
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {envSuggestions.map((s) => (
                            <span
                              key={s.key}
                              title={s.sources?.join(', ')}
                              className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30 text-indigo-300 text-[10px] font-mono"
                            >
                              <span>{s.key}</span>
                              {s.client && (
                                <span className="text-[8px] px-1 rounded bg-cyan-500/15 text-cyan-400">public</span>
                              )}
                              <button
                                type="button"
                                onClick={() => acceptSuggestion(s)}
                                className="p-0.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 rounded cursor-pointer"
                                title="Accept"
                              >
                                <Check className="w-3 h-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => rejectSuggestion(s.key)}
                                className="p-0.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded cursor-pointer"
                                title="Reject"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Summary strip */}
                  <div className="rounded-lg bg-zinc-950/60 border border-zinc-800/50 divide-y divide-zinc-800/50 text-[11px]">
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-zinc-500">Directory</span>
                      <span className="text-zinc-200 font-mono">
                        {activeSubfolderPath === '.' || !activeSubfolderPath ? '/ (Root)' : activeSubfolderPath}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-zinc-500">Framework</span>
                      <span className="text-indigo-300 font-mono">
                        {detectedBuild?.framework || detectedBuild?.language || 'Auto-detect'}
                      </span>
                    </div>
                    <div className="px-3 py-2 flex items-center justify-between">
                      <span className="text-zinc-500">Strategy</span>
                      {isDetecting ? (
                        <span className="text-zinc-500 font-mono flex items-center gap-1">
                          <RefreshCw className="w-3 h-3 animate-spin" /> detecting…
                        </span>
                      ) : detectedBuild?.hasDockerfile ? (
                        <span className="text-cyan-400 font-mono flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" /> Docker
                        </span>
                      ) : (
                        <span className="text-indigo-400 font-mono flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" /> Nixpacks
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center text-zinc-600 px-6 py-10">
                <GitHubIcon className="w-10 h-10 mb-3 opacity-20" />
                <p className="text-xs leading-relaxed">
                  {activeTab === 'account'
                    ? 'Select a repository on the left to configure and deploy it'
                    : 'Fetch a public repository to configure deployment'}
                </p>
              </div>
            )}

            {/* Deploy button pinned at bottom */}
            <div className="px-4 py-4 border-t border-zinc-800/60 bg-zinc-900/40 mt-auto">
              <button
                onClick={handleDeploy}
                disabled={!selectedRepo || isDeploying}
                className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 active:scale-[0.98] disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-2 shadow-lg shadow-indigo-600/20 transition-all cursor-pointer"
              >
                {isDeploying ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Queuing build…</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Deploy Project</span>
                    <ArrowRight className="w-3.5 h-3.5 ml-auto" />
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-2.5 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between text-[11px] text-zinc-600 font-mono">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span>Webhooks verified via HMAC SHA-256</span>
          </div>
          <span>Dockerfile &amp; Nixpacks pipeline</span>
        </div>
      </div>
    </div>
  );
}
