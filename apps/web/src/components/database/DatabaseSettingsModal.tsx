'use client';

import React, { useState, useEffect } from 'react';
import {
  Sliders,
  Cloud,
  Database,
  Flame,
  X,
  Check,
  RotateCw,
  Copy,
  ExternalLink,
  ShieldCheck,
  Calendar,
  Clock,
  HardDrive,
  Eye,
  EyeOff,
  AlertCircle,
  Download,
  RotateCcw,
  Sparkles,
  Server,
  Trash2,
  Key,
  ShieldAlert,
  Radio,
  CheckCircle2,
} from 'lucide-react';
import {
  fetchDatabaseBackupConfig,
  updateDatabaseBackupConfig,
  fetchDatabaseBackups,
  triggerDatabaseBackup,
  restoreDatabaseBackup,
  deleteDatabase,
  S3BackupConfig,
  BackupSnapshot,
} from '@/lib/api';
import { DeleteDatabaseModal } from './DeleteDatabaseModal';
import { PostgresLogo, RedisLogo } from '../icons/DatabaseLogos';

export interface DatabaseSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  databaseId: string;
  databaseName: string;
  engine?: 'postgres' | 'redis' | string;
  connectionUrl?: string;
  onDatabaseDeleted?: (databaseId: string) => void;
  onOpenStudio?: () => void;
}

export function DatabaseSettingsModal({
  isOpen,
  onClose,
  databaseId,
  databaseName,
  engine = 'postgres',
  connectionUrl,
  onDatabaseDeleted,
  onOpenStudio,
}: DatabaseSettingsModalProps) {
  const isRedis = engine === 'redis' || databaseName.toLowerCase().includes('redis');
  const [activeTab, setActiveTab] = useState<'overview' | 'backups' | 'danger'>('overview');

  // Connection Info
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // S3 Form State
  const [backupSubTab, setBackupSubTab] = useState<'config' | 'snapshots'>('config');
  const [enabled, setEnabled] = useState(true);
  const [endpoint, setEndpoint] = useState('https://s3.us-east-1.amazonaws.com');
  const [bucket, setBucket] = useState('railway-db-backups');
  const [region, setRegion] = useState('us-east-1');
  const [accessKeyId, setAccessKeyId] = useState('AKIAIOSFODNN7EXAMPLE');
  const [secretAccessKey, setSecretAccessKey] = useState('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  const [showSecret, setShowSecret] = useState(false);
  const [prefix, setPrefix] = useState(`databases/${databaseName}`);
  const [cronSchedule, setCronSchedule] = useState('0 2 * * *');
  const [retentionDays, setRetentionDays] = useState(7);

  // Status & Snapshots State
  const [snapshots, setSnapshots] = useState<BackupSnapshot[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isRestoringId, setIsRestoringId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Delete Modal State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Restore confirmation inline
  const [confirmRestoreSnap, setConfirmRestoreSnap] = useState<BackupSnapshot | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadData();
  }, [isOpen, databaseId]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [config, snaps] = await Promise.all([
        fetchDatabaseBackupConfig(databaseId).catch(() => null),
        fetchDatabaseBackups(databaseId).catch(() => []),
      ]);

      if (config) {
        setEnabled(config.enabled ?? true);
        setEndpoint(config.endpoint || 'https://s3.us-east-1.amazonaws.com');
        setBucket(config.bucket || 'railway-db-backups');
        setRegion(config.region || 'us-east-1');
        setAccessKeyId(config.accessKeyId || 'AKIAIOSFODNN7EXAMPLE');
        setSecretAccessKey(config.secretAccessKey || 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
        setPrefix(config.prefix || `databases/${databaseName}`);
        setCronSchedule(config.cronSchedule || '0 2 * * *');
        setRetentionDays(config.retentionDays || 7);
      }
      setSnapshots(snaps || []);
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setNotice(null);

    try {
      await updateDatabaseBackupConfig(databaseId, {
        enabled,
        endpoint,
        bucket,
        region,
        accessKeyId,
        secretAccessKey,
        prefix,
        cronSchedule,
        retentionDays,
      });
      setNotice('✨ S3 backup settings saved successfully!');
      setTimeout(() => setNotice(null), 3000);
    } catch (err: any) {
      setNotice(`Error saving: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleTriggerBackup() {
    setIsBackingUp(true);
    setNotice(null);

    try {
      const newSnap = await triggerDatabaseBackup(databaseId);
      setSnapshots([newSnap, ...snapshots]);
      setNotice(`🚀 Backup completed & uploaded to s3://${bucket}/${prefix}/${newSnap.filename}`);
      setBackupSubTab('snapshots');
      setTimeout(() => setNotice(null), 4000);
    } catch (err: any) {
      setNotice(`Backup error: ${err.message}`);
    } finally {
      setIsBackingUp(false);
    }
  }

  async function handleExecuteRestore(snapshot: BackupSnapshot) {
    setIsRestoringId(snapshot.id);
    setConfirmRestoreSnap(null);
    try {
      const res = await restoreDatabaseBackup(databaseId, snapshot.id);
      setNotice(`✅ ${res.message}`);
      setTimeout(() => setNotice(null), 5000);
    } catch (err: any) {
      setNotice(`Restore failed: ${err.message}`);
    } finally {
      setIsRestoringId(null);
    }
  }

  async function handleConfirmDelete() {
    setIsDeleting(true);
    try {
      await deleteDatabase(databaseId);
      setIsDeleteModalOpen(false);
      onDatabaseDeleted?.(databaseId);
      onClose();
    } catch (err: any) {
      setNotice(`Delete error: ${err.message}`);
    } finally {
      setIsDeleting(false);
    }
  }

  function handleCopyConnUrl() {
    if (connectionUrl) {
      navigator.clipboard?.writeText(connectionUrl);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  }

  if (!isOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 font-sans text-zinc-100">
        <div className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Modal Header */}
          <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-10 h-10 rounded-xl flex items-center justify-center border shadow-lg p-2 ${
                  isRedis
                    ? 'border-rose-500/30 bg-rose-500/10 text-rose-400'
                    : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-400'
                }`}
              >
                {isRedis ? <RedisLogo className="w-6 h-6" /> : <PostgresLogo className="w-6 h-6" />}
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-zinc-100">{databaseName}</h3>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-mono border inline-flex items-center gap-1.5 ${
                      isRedis
                        ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                        : 'border-indigo-500/30 bg-indigo-500/10 text-indigo-300'
                    }`}
                  >
                    {isRedis ? <RedisLogo className="w-3 h-3" /> : <PostgresLogo className="w-3 h-3" />}
                    <span>{isRedis ? 'Redis 7' : 'PostgreSQL 16'}</span>
                  </span>
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Healthy</span>
                  </span>
                </div>
                <p className="text-xs text-zinc-400 mt-0.5">
                  ID: <code className="text-zinc-300 font-mono">{databaseId}</code> • Managed Container
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Notice Banner */}
          {notice && (
            <div className="px-6 py-2.5 bg-indigo-950/60 border-b border-indigo-500/40 text-xs font-mono text-indigo-300 flex items-center gap-2 animate-in fade-in">
              <Check className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="truncate">{notice}</span>
            </div>
          )}

          {/* Navigation Tabs */}
          <div className="px-6 border-b border-zinc-800 bg-zinc-950 flex items-center gap-1 text-xs">
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2.5 border-b-2 font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'overview'
                  ? 'border-indigo-500 text-indigo-300 bg-zinc-900/30'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Settings & Connect</span>
            </button>

            <button
              onClick={() => setActiveTab('backups')}
              className={`px-4 py-2.5 border-b-2 font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'backups'
                  ? 'border-indigo-500 text-indigo-300 bg-zinc-900/30'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Cloud className="w-3.5 h-3.5" />
              <span>S3 Backups ({snapshots.length})</span>
            </button>

            <button
              onClick={() => setActiveTab('danger')}
              className={`px-4 py-2.5 border-b-2 font-medium flex items-center gap-2 transition-colors cursor-pointer ${
                activeTab === 'danger'
                  ? 'border-red-500 text-red-400 bg-red-950/20'
                  : 'border-transparent text-zinc-400 hover:text-red-400'
              }`}
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Danger Zone</span>
            </button>
          </div>

          {/* Tab Content Body */}
          <div className="flex-1 overflow-y-auto p-6 bg-zinc-950 space-y-6">
            {/* ======================================================== */}
            {/* TAB 1: OVERVIEW & CONNECTION SETTINGS */}
            {/* ======================================================== */}
            {activeTab === 'overview' && (
              <div className="space-y-5">
                {/* Connection String Box */}
                <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                      <Key className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Direct Connection URI</span>
                    </span>
                    <button
                      onClick={handleCopyConnUrl}
                      className="px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-mono text-[11px] flex items-center gap-1 transition-colors cursor-pointer"
                    >
                      {copiedUrl ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                      <span>{copiedUrl ? 'Copied' : 'Copy URI'}</span>
                    </button>
                  </div>
                  <div className="p-2.5 bg-zinc-950 border border-zinc-800/80 rounded-lg font-mono text-xs text-zinc-300 break-all select-all">
                    {connectionUrl ||
                      (isRedis
                        ? `redis://default:secret@paas-redis:6379`
                        : `postgresql://postgres:secret@paas-pg:5432/railway`)}
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Use this URL inside services on the same Docker bridge network or via internal DNS.
                  </p>
                </div>

                {/* Connection Parameters Grid */}
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-1">
                    <span className="text-[11px] text-zinc-500 block uppercase font-mono">Port</span>
                    <span className="font-mono text-zinc-200">{isRedis ? '6379' : '5432'}</span>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-1">
                    <span className="text-[11px] text-zinc-500 block uppercase font-mono">Database / Keyspace</span>
                    <span className="font-mono text-zinc-200">{isRedis ? '0 (Default)' : 'railway'}</span>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-1">
                    <span className="text-[11px] text-zinc-500 block uppercase font-mono">User</span>
                    <span className="font-mono text-zinc-200">{isRedis ? 'default' : 'postgres'}</span>
                  </div>
                  <div className="p-3 bg-zinc-900/40 border border-zinc-800 rounded-xl space-y-1">
                    <span className="text-[11px] text-zinc-500 block uppercase font-mono">Engine Version</span>
                    <span className="font-mono text-zinc-200">{isRedis ? 'Redis 7.2 Alpine' : 'PostgreSQL 16.2 Alpine'}</span>
                  </div>
                </div>

                {/* Quick Action: Neon Studio */}
                {!isRedis && onOpenStudio && (
                  <div className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-950/10 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-indigo-500/15 border border-indigo-500/30 flex items-center justify-center p-1.5 shrink-0">
                        <PostgresLogo className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-indigo-300">Neon Interactive Database Studio</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                          Browse tables, edit live records, inspect schemas, and run raw SQL queries
                        </div>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        onClose();
                        onOpenStudio();
                      }}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer shadow-md shadow-indigo-600/20"
                    >
                      <span>Open Studio</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* Quick Link to Backups or Danger */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <button
                    onClick={() => setActiveTab('backups')}
                    className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/20 hover:bg-zinc-900/40 text-left transition-colors cursor-pointer group"
                  >
                    <div className="flex items-center gap-2 text-zinc-300 group-hover:text-indigo-400 font-semibold text-xs">
                      <Cloud className="w-4 h-4 text-amber-400" />
                      <span>S3 Automated Backups</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Configure daily S3 snapshots, retention policies, and one-click restores.
                    </p>
                  </button>

                  <button
                    onClick={() => setActiveTab('danger')}
                    className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/20 hover:bg-red-950/20 text-left transition-colors cursor-pointer group hover:border-red-500/30"
                  >
                    <div className="flex items-center gap-2 text-zinc-300 group-hover:text-red-400 font-semibold text-xs">
                      <Trash2 className="w-4 h-4 text-red-400" />
                      <span>Danger Zone</span>
                    </div>
                    <p className="text-[11px] text-zinc-500 mt-1">
                      Permanently terminate container, delete persistent volume, and detach.
                    </p>
                  </button>
                </div>
              </div>
            )}

            {/* ======================================================== */}
            {/* TAB 2: S3 BUCKET SETTINGS & SNAPSHOTS */}
            {/* ======================================================== */}
            {activeTab === 'backups' && (
              <div className="space-y-5">
                {/* Sub Tab Switcher */}
                <div className="flex items-center gap-2 border-b border-zinc-800/80 pb-3 text-xs">
                  <button
                    type="button"
                    onClick={() => setBackupSubTab('config')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      backupSubTab === 'config'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    S3 Bucket Configuration
                  </button>
                  <button
                    type="button"
                    onClick={() => setBackupSubTab('snapshots')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      backupSubTab === 'snapshots'
                        ? 'bg-zinc-800 text-zinc-100'
                        : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    Snapshots & History ({snapshots.length})
                  </button>
                </div>

                {/* Sub Tab 1: Config */}
                {backupSubTab === 'config' && (
                  <form onSubmit={handleSaveConfig} className="space-y-4">
                    {/* Automated Backups Toggle */}
                    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">Enable Automated S3 Backups</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                          Cron worker executes database dump, compresses, and streams directly to your bucket
                        </div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => setEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      </label>
                    </div>

                    {/* Endpoint & Bucket Inputs */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">S3 Endpoint URL</label>
                        <input
                          type="text"
                          required
                          value={endpoint}
                          onChange={(e) => setEndpoint(e.target.value)}
                          placeholder="https://s3.us-east-1.amazonaws.com"
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">S3 Bucket Name</label>
                        <input
                          type="text"
                          required
                          value={bucket}
                          onChange={(e) => setBucket(e.target.value)}
                          placeholder="my-production-backups"
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Region & Key Inputs */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">AWS / Cloud Region</label>
                        <input
                          type="text"
                          required
                          value={region}
                          onChange={(e) => setRegion(e.target.value)}
                          placeholder="us-east-1"
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">Access Key ID</label>
                        <input
                          type="text"
                          required
                          value={accessKeyId}
                          onChange={(e) => setAccessKeyId(e.target.value)}
                          placeholder="AKIA..."
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                    </div>

                    {/* Secret Access Key */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="text-xs font-mono text-zinc-400">Secret Access Key</label>
                        <button
                          type="button"
                          onClick={() => setShowSecret(!showSecret)}
                          className="text-[11px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 cursor-pointer"
                        >
                          {showSecret ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                          <span>{showSecret ? 'Hide' : 'Show'}</span>
                        </button>
                      </div>
                      <input
                        type={showSecret ? 'text' : 'password'}
                        required
                        value={secretAccessKey}
                        onChange={(e) => setSecretAccessKey(e.target.value)}
                        placeholder="••••••••••••••••••••••••••••••••••••••••"
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                      />
                    </div>

                    {/* Schedule & Retention */}
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">Cron Schedule</label>
                        <input
                          type="text"
                          value={cronSchedule}
                          onChange={(e) => setCronSchedule(e.target.value)}
                          placeholder="0 2 * * *"
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-mono text-zinc-400 block mb-1.5">Retention Period</label>
                        <select
                          value={retentionDays}
                          onChange={(e) => setRetentionDays(Number(e.target.value))}
                          className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                        >
                          <option value={7}>Keep last 7 Days</option>
                          <option value={14}>Keep last 14 Days</option>
                          <option value={30}>Keep last 30 Days</option>
                          <option value={90}>Keep last 90 Days</option>
                        </select>
                      </div>
                    </div>

                    {/* Save Button Row */}
                    <div className="pt-3 border-t border-zinc-800 flex items-center justify-between">
                      <button
                        type="button"
                        onClick={handleTriggerBackup}
                        disabled={isBackingUp}
                        className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-xl text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                        <span>{isBackingUp ? 'Dumping & Uploading...' : 'Backup to S3 Now'}</span>
                      </button>

                      <button
                        type="submit"
                        disabled={isSaving}
                        className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                      >
                        {isSaving ? 'Saving S3 Settings...' : 'Save Configuration'}
                      </button>
                    </div>
                  </form>
                )}

                {/* Sub Tab 2: Snapshots List */}
                {backupSubTab === 'snapshots' && (
                  <div className="space-y-4">
                    {/* Top Trigger Banner */}
                    <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-900/30 flex items-center justify-between">
                      <div>
                        <div className="text-xs font-semibold text-zinc-200">Manual S3 Snapshot</div>
                        <div className="text-[11px] text-zinc-400 mt-0.5">
                          Target: <code className="text-indigo-400 font-mono">s3://{bucket}/{prefix}/</code>
                        </div>
                      </div>

                      <button
                        onClick={handleTriggerBackup}
                        disabled={isBackingUp}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                      >
                        <RotateCw className={`w-3.5 h-3.5 ${isBackingUp ? 'animate-spin' : ''}`} />
                        <span>{isBackingUp ? 'Capturing Snapshot...' : 'Backup to S3 Now'}</span>
                      </button>
                    </div>

                    {/* Restore Confirmation Inline Notice */}
                    {confirmRestoreSnap && (
                      <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-950/20 text-xs space-y-2 animate-in fade-in">
                        <div className="flex items-center gap-2 text-amber-300 font-semibold">
                          <AlertCircle className="w-4 h-4" />
                          <span>Confirm Database Restore</span>
                        </div>
                        <p className="text-[11px] text-zinc-300 leading-relaxed">
                          Are you sure you want to restore from snapshot <strong className="text-white font-mono">{confirmRestoreSnap.filename}</strong>? This will overwrite active table contents with this backup.
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          <button
                            onClick={() => handleExecuteRestore(confirmRestoreSnap)}
                            disabled={isRestoringId === confirmRestoreSnap.id}
                            className="px-3.5 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition-colors cursor-pointer"
                          >
                            {isRestoringId === confirmRestoreSnap.id ? 'Restoring...' : 'Yes, Restore Now'}
                          </button>
                          <button
                            onClick={() => setConfirmRestoreSnap(null)}
                            className="px-3.5 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 rounded-lg text-xs transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Snapshots Table / List */}
                    {snapshots.length === 0 ? (
                      <div className="p-8 border border-zinc-800 rounded-xl text-center text-xs text-zinc-500">
                        No S3 backups recorded yet. Click &quot;Backup to S3 Now&quot; to take your first snapshot.
                      </div>
                    ) : (
                      <div className="border border-zinc-800 rounded-xl overflow-hidden divide-y divide-zinc-800 bg-zinc-900/20 font-mono text-xs">
                        {snapshots.map((snap) => (
                          <div
                            key={snap.id}
                            className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-zinc-900/40 transition-colors"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-zinc-200">{snap.filename}</span>
                                <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px]">
                                  {snap.status.toUpperCase()}
                                </span>
                              </div>
                              <div className="text-[11px] text-zinc-500 flex items-center gap-2">
                                <span>{snap.sizeFormatted}</span>
                                <span>•</span>
                                <span>{new Date(snap.createdAt).toLocaleString()}</span>
                                <span>•</span>
                                <span className="text-indigo-400/80 truncate max-w-[260px]">
                                  {snap.s3Url}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                onClick={() => {
                                  navigator.clipboard?.writeText(snap.s3Url);
                                  setNotice(`Copied: ${snap.s3Url}`);
                                  setTimeout(() => setNotice(null), 2000);
                                }}
                                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
                                title="Copy S3 URI"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>

                              <button
                                onClick={() => setConfirmRestoreSnap(snap)}
                                disabled={isRestoringId === snap.id}
                                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <RotateCcw
                                  className={`w-3.5 h-3.5 text-amber-400 ${
                                    isRestoringId === snap.id ? 'animate-spin' : ''
                                  }`}
                                />
                                <span>{isRestoringId === snap.id ? 'Restoring...' : 'Restore'}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ======================================================== */}
            {/* TAB 3: DANGER ZONE */}
            {/* ======================================================== */}
            {activeTab === 'danger' && (
              <div className="space-y-4">
                <div className="p-5 rounded-xl border border-red-500/30 bg-red-950/15 space-y-4">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 shrink-0">
                      <Trash2 className="w-6 h-6" />
                    </div>
                    <div>
                      <h4 className="text-sm font-semibold text-red-200">Delete Database Instance</h4>
                      <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                        Permanently destroy the container for <strong className="text-zinc-200">{databaseName}</strong> (ID: <code className="text-zinc-300 font-mono">{databaseId}</code>). This permanently purges the Docker persistent volume, closes active connection pools, and disconnects all wired services.
                      </p>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-red-500/20 flex items-center justify-between">
                    <span className="text-[11px] text-zinc-500 font-mono">
                      ⚠️ Destructive action. Opens confirmation modal.
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsDeleteModalOpen(true)}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold shadow-lg shadow-red-600/30 transition-all cursor-pointer flex items-center gap-1.5"
                    >
                      <Trash2 className="w-4 h-4" />
                      <span>Delete Database...</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Modal Footer */}
          <div className="px-6 py-3 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between text-[11px] text-zinc-500 font-mono">
            <span>Encrypted with AES-256 before streaming over TLS</span>
            <span>Managed Service Bridge</span>
          </div>
        </div>
      </div>

      {/* Custom Delete Confirmation Modal */}
      <DeleteDatabaseModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        onConfirm={handleConfirmDelete}
        databaseName={databaseName}
        databaseId={databaseId}
        engine={engine}
        isDeleting={isDeleting}
      />
    </>
  );
}
