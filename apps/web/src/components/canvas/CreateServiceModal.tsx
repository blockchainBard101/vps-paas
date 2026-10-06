'use client';

import React, { useState } from 'react';
import {
  Package,
  X,
  ChevronRight,
  ChevronLeft,
  Database,
  Flame,
  Layers,
  ArrowRight,
  Plus,
  Loader2,
  Server,
  Zap,
} from 'lucide-react';
import { GitHubIcon } from '../github/GitHubRepoModal';
import { PostgresLogo, RedisLogo } from '../icons/DatabaseLogos';

export interface CreateServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectGit: () => void;
  onSelectDatabase: (engine: 'postgres' | 'redis', dbName?: string) => Promise<void> | void;
  onDeployDockerImage: (image: string, name?: string, port?: number) => Promise<void> | void;
  onDeployFunction?: (runtime: string, name?: string) => Promise<void> | void;
}

export function CreateServiceModal({
  isOpen,
  onClose,
  onSelectGit,
  onSelectDatabase,
  onDeployDockerImage,
  onDeployFunction,
}: CreateServiceModalProps) {
  const [view, setView] = useState<'root' | 'database' | 'docker' | 'function'>('root');

  // Database creation state
  const [selectedDbEngine, setSelectedDbEngine] = useState<'postgres' | 'redis'>('postgres');
  const [customDbName, setCustomDbName] = useState('postgres-db');
  const [isProvisioningDb, setIsProvisioningDb] = useState(false);

  // Docker Image state
  const [dockerImage, setDockerImage] = useState('');
  const [dockerServiceName, setDockerServiceName] = useState('');
  const [dockerPort, setDockerPort] = useState('80');
  const [isDeployingDocker, setIsDeployingDocker] = useState(false);

  // Function state
  const [functionRuntime, setFunctionRuntime] = useState('nodejs20');
  const [functionName, setFunctionName] = useState('');
  const [isDeployingFunction, setIsDeployingFunction] = useState(false);

  if (!isOpen) return null;

  function handleClose() {
    setView('root');
    setSelectedDbEngine('postgres');
    setCustomDbName('postgres-db');
    setIsProvisioningDb(false);
    setDockerImage('');
    setDockerServiceName('');
    setDockerPort('80');
    setIsDeployingDocker(false);
    setIsDeployingFunction(false);
    onClose();
  }

  async function handleCreateDatabaseForm(e: React.FormEvent) {
    e.preventDefault();
    if (!customDbName.trim()) return;
    setIsProvisioningDb(true);
    try {
      await onSelectDatabase(selectedDbEngine, customDbName.trim());
      handleClose();
    } finally {
      setIsProvisioningDb(false);
    }
  }

  async function handleSubmitDocker(e: React.FormEvent) {
    e.preventDefault();
    if (!dockerImage.trim()) return;
    setIsDeployingDocker(true);
    try {
      const portNum = parseInt(dockerPort, 10) || 80;
      await onDeployDockerImage(dockerImage.trim(), dockerServiceName.trim() || undefined, portNum);
      handleClose();
    } finally {
      setIsDeployingDocker(false);
    }
  }

  async function handleSubmitFunction(e: React.FormEvent) {
    e.preventDefault();
    setIsDeployingFunction(true);
    try {
      if (onDeployFunction) {
        await onDeployFunction(functionRuntime, functionName.trim() || undefined);
      } else {
        await onDeployDockerImage('node:20-alpine', functionName.trim() || 'serverless-fn', 3000);
      }
      handleClose();
    } finally {
      setIsDeployingFunction(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-sans text-zinc-100">
      <div
        className="w-full max-w-xl bg-[#09090b] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ======================================================== */}
        {/* VIEW 1: ROOT SERVICE TYPE CHOOSER (EXACT RAILWAY DESIGN) */}
        {/* ======================================================== */}
        {view === 'root' && (
          <div>
            {/* Header */}
            <div className="p-6 border-b border-zinc-800/80 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-zinc-300">
                  <Package className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-zinc-100 tracking-tight">Create a new service</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Choose a service type</p>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* 2x2 Grid of Service Types */}
            <div className="p-6">
              <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800 bg-zinc-950">
                {/* Top Row: Git Repository & Database */}
                <div className="grid grid-cols-2 divide-x divide-zinc-800">
                  {/* Git Repository */}
                  <div
                    onClick={() => {
                      handleClose();
                      onSelectGit();
                    }}
                    className="p-5 flex items-center justify-between hover:bg-zinc-900/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="text-zinc-100 group-hover:text-white transition-colors">
                        <GitHubIcon className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                        Git Repository
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                  </div>

                  {/* Database */}
                  <div
                    onClick={() => setView('database')}
                    className="p-5 flex items-center justify-between hover:bg-zinc-900/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5">
                      <div className="flex items-center -space-x-1 shrink-0">
                        <PostgresLogo className="w-5 h-5 drop-shadow" />
                        <RedisLogo className="w-4 h-4 drop-shadow" />
                      </div>
                      <div>
                        <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors block">
                          Database
                        </span>
                        <span className="text-[11px] text-zinc-500 font-mono">
                          Postgres &amp; Redis
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>

                {/* Bottom Row: Docker Image & Function */}
                <div className="grid grid-cols-2 divide-x divide-zinc-800">
                  {/* Docker Image */}
                  <div
                    onClick={() => setView('docker')}
                    className="p-5 flex items-center justify-between hover:bg-zinc-900/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5">
                      {/* Docker Whale Icon */}
                      <svg className="w-5 h-5 text-[#0db7ed] shrink-0" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M13.983 11.078h2.119a.186.186 0 00.186-.185V9.006a.186.186 0 00-.186-.186h-2.119a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185m-2.954-5.43h2.118a.186.186 0 00.186-.186V3.574a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m0 2.716h2.118a.187.187 0 00.186-.186V6.29a.186.186 0 00-.186-.185h-2.118a.185.185 0 00-.185.185v1.887c0 .102.082.186.185.186m-2.93 0h2.12a.186.186 0 00.184-.186V6.29a.185.185 0 00-.185-.185H8.1a.185.185 0 00-.185.185v1.887c0 .102.083.186.185.186m-2.964 0h2.119a.186.186 0 00.185-.186V6.29a.185.185 0 00-.185-.185H5.136a.186.186 0 00-.186.185v1.887c0 .102.084.186.186.186m5.893 2.715h2.118a.186.186 0 00.186-.186V9.006a.186.186 0 00-.186-.186h-2.118a.185.185 0 00-.185.185v1.888c0 .102.082.185.185.185m-2.93 0h2.12a.185.185 0 00.184-.185V9.006a.185.185 0 00-.184-.186h-2.12a.185.185 0 00-.184.185v1.888c0 .102.083.185.185.185m-2.964 0h2.119a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H2.172a.186.186 0 00-.186.185v1.888c0 .102.084.185.186.185m-2.928 0h2.12a.185.185 0 00.185-.185V9.006a.185.185 0 00-.185-.186H-.756a.185.185 0 00-.185.185v1.888c0 .102.083.185.185.185" />
                        <path d="M23.977 11.53c-.307-.22-1.398-.242-2.17-.076-.142-.71-.587-1.34-1.282-1.74l-.442-.258-.293.42c-.524.75-.764 1.63-.717 2.532-.693.424-1.674.526-2.583.33-1.077-.23-1.854-1.03-2.073-2.14l-.066-.34-.338.077a7.65 7.65 0 00-2.316.924H.184A.186.186 0 000 11.45c0 5.485 3.75 9.066 9.387 9.066 7.02 0 11.83-4.22 13.064-9.36.81-.37 1.48-.96 1.55-1.08l.38-.546-.404-.26z" />
                      </svg>
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                        Docker Image
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                  </div>

                  {/* Function */}
                  <div
                    onClick={() => setView('function')}
                    className="p-5 flex items-center justify-between hover:bg-zinc-900/60 transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-3.5">
                      <span className="font-serif italic text-lg font-bold text-zinc-200 w-5 h-5 flex items-center justify-center leading-none group-hover:text-emerald-400 transition-colors">
                        ƒ
                      </span>
                      <span className="text-sm font-medium text-zinc-200 group-hover:text-white transition-colors">
                        Function
                      </span>
                    </div>
                    <ChevronRight className="w-4 h-4 text-zinc-500 group-hover:text-zinc-300 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ======================================================== */}
        {/* VIEW 2: DATABASE ENGINE CHOOSER & NAMING */}
        {/* ======================================================== */}
        {view === 'database' && (
          <div>
            {/* Header */}
            <div className="p-6 border-b border-zinc-800/80 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setView('root')}
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer mr-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center p-1.5">
                  {selectedDbEngine === 'redis' ? (
                    <RedisLogo className="w-5 h-5" />
                  ) : (
                    <PostgresLogo className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-base text-zinc-100 tracking-tight">Add a Database</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Select an engine and give your database a name</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Database Engine Selector & Name Form */}
            <form onSubmit={handleCreateDatabaseForm} className="p-6 space-y-4">
              {/* Engine Selector */}
              <div>
                <label className="text-xs font-mono text-zinc-400 block mb-2">Select Engine</label>
                <div className="grid grid-cols-2 gap-3">
                  {/* PostgreSQL 16 */}
                  <div
                    onClick={() => {
                      setSelectedDbEngine('postgres');
                      if (customDbName === 'redis-db') setCustomDbName('postgres-db');
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      selectedDbEngine === 'postgres'
                        ? 'border-indigo-500 bg-indigo-500/10 ring-2 ring-indigo-500/20 text-indigo-100'
                        : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900/60 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-9 h-9 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center p-1.5">
                        <PostgresLogo className="w-6 h-6" />
                      </div>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          selectedDbEngine === 'postgres' ? 'bg-indigo-400 ring-4 ring-indigo-500/20' : 'border border-zinc-700'
                        }`}
                      />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-zinc-100">PostgreSQL 16</h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5">SQL Database • Neon Studio • Port 5432</p>
                    </div>
                  </div>

                  {/* Redis 7 */}
                  <div
                    onClick={() => {
                      setSelectedDbEngine('redis');
                      if (customDbName === 'postgres-db') setCustomDbName('redis-db');
                    }}
                    className={`p-4 rounded-xl border transition-all cursor-pointer flex flex-col justify-between ${
                      selectedDbEngine === 'redis'
                        ? 'border-rose-500 bg-rose-500/10 ring-2 ring-rose-500/20 text-rose-100'
                        : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-900/60 text-zinc-400'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center p-1.5">
                        <RedisLogo className="w-6 h-6" />
                      </div>
                      <span
                        className={`w-2.5 h-2.5 rounded-full ${
                          selectedDbEngine === 'redis' ? 'bg-rose-400 ring-4 ring-rose-500/20' : 'border border-zinc-700'
                        }`}
                      />
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-zinc-100">Redis 7</h4>
                      <p className="text-[11px] text-zinc-400 mt-0.5">In-Memory Cache & Key-Value • Port 6379</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Database Name Input */}
              <div className="pt-1">
                <label className="text-xs font-mono text-zinc-300 block mb-1.5">
                  Database Name *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={customDbName}
                  onChange={(e) => setCustomDbName(e.target.value)}
                  placeholder={
                    selectedDbEngine === 'postgres'
                      ? 'e.g. production-postgres, users-db'
                      : 'e.g. redis-cache, session-store'
                  }
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
                <p className="text-[11px] text-zinc-500 mt-1">
                  This custom name will identify your container and connection strings across the canvas.
                </p>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setView('root')}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={!customDbName.trim() || isProvisioningDb}
                  className={`px-5 py-2 text-white rounded-xl text-xs font-semibold shadow-lg transition-all cursor-pointer flex items-center gap-2 ${
                    selectedDbEngine === 'redis'
                      ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/30'
                      : 'bg-indigo-600 hover:bg-indigo-500 shadow-indigo-600/30'
                  }`}
                >
                  {isProvisioningDb ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Provisioning Database...</span>
                    </>
                  ) : (
                    <>
                      {selectedDbEngine === 'redis' ? (
                        <RedisLogo className="w-4 h-4" />
                      ) : (
                        <PostgresLogo className="w-4 h-4" />
                      )}
                      <span>Create {selectedDbEngine === 'postgres' ? 'PostgreSQL' : 'Redis'} Database</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ======================================================== */}
        {/* VIEW 3: DOCKER IMAGE DEPLOYMENT */}
        {/* ======================================================== */}
        {view === 'docker' && (
          <div>
            {/* Header */}
            <div className="p-6 border-b border-zinc-800/80 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView('root')}
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer mr-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-lg bg-[#0db7ed]/10 border border-[#0db7ed]/20 flex items-center justify-center text-[#0db7ed]">
                  <Server className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-zinc-100 tracking-tight">Deploy Docker Image</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Deploy any public image from Docker Hub or registry</p>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Docker Image Form */}
            <form onSubmit={handleSubmitDocker} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-mono text-zinc-400 block mb-1.5">Docker Image Tag *</label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={dockerImage}
                  onChange={(e) => setDockerImage(e.target.value)}
                  placeholder="e.g. nginx:alpine, redis:7, node:20-alpine"
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-mono text-zinc-400 block mb-1.5">Service Name (Optional)</label>
                  <input
                    type="text"
                    value={dockerServiceName}
                    onChange={(e) => setDockerServiceName(e.target.value)}
                    placeholder="my-custom-service"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
                <div>
                  <label className="text-xs font-mono text-zinc-400 block mb-1.5">Container Port</label>
                  <input
                    type="number"
                    value={dockerPort}
                    onChange={(e) => setDockerPort(e.target.value)}
                    placeholder="80"
                    className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setView('root')}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!dockerImage.trim() || isDeployingDocker}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer flex items-center gap-2"
                >
                  {isDeployingDocker ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Pulling & Deploying...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Deploy Container</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* ======================================================== */}
        {/* VIEW 4: FUNCTION / SERVERLESS */}
        {/* ======================================================== */}
        {view === 'function' && (
          <div>
            {/* Header */}
            <div className="p-6 border-b border-zinc-800/80 flex items-start justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView('root')}
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer mr-1"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
                  <Zap className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-semibold text-base text-zinc-100 tracking-tight">Create a Function</h3>
                  <p className="text-xs text-zinc-400 mt-0.5">Lightweight serverless background worker or micro-handler</p>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Function Form */}
            <form onSubmit={handleSubmitFunction} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-mono text-zinc-400 block mb-1.5">Runtime</label>
                <select
                  value={functionRuntime}
                  onChange={(e) => setFunctionRuntime(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500 transition-colors"
                >
                  <option value="nodejs20">Node.js 20 (Alpine)</option>
                  <option value="python311">Python 3.11</option>
                  <option value="go122">Go 1.22</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-mono text-zinc-400 block mb-1.5">Function Name</label>
                <input
                  type="text"
                  value={functionName}
                  onChange={(e) => setFunctionName(e.target.value)}
                  placeholder="e.g. email-sender, cron-cleanup"
                  className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                />
              </div>

              <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setView('root')}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDeployingFunction}
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white rounded-xl text-xs font-semibold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer flex items-center gap-2"
                >
                  {isDeployingFunction ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Creating Function...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="w-3.5 h-3.5" />
                      <span>Create Function</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
