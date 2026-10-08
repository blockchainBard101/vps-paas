'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderKanban,
  Search,
  Plus,
  X,
  Check,
  Server,
  Database,
  ArrowRight,
  Shield,
  Layers,
  Sparkles,
  Calendar
} from 'lucide-react';
import {
  fetchProjects,
  createProject,
  ProjectRecord,
} from '@/lib/api';

interface ProjectSwitcherModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentProject: string;
  onSelectProject: (projectName: string) => void;
  onOpenDashboard?: () => void;
}

export function ProjectSwitcherModal({
  isOpen,
  onClose,
  currentProject,
  onSelectProject,
  onOpenDashboard,
}: ProjectSwitcherModalProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [search, setSearch] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    loadProjects();
  }, [isOpen]);

  async function loadProjects() {
    try {
      const projs = await fetchProjects();
      setProjects(projs);
    } catch {
      setProjects([]);
    }
  }

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const created = await createProject(newName.trim(), newDesc.trim(), 'production');
      setProjects([created, ...projects]);
      onSelectProject(created.name);
      setIsCreating(false);
      setNewName('');
      setNewDesc('');
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) return null;

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-150 font-sans text-zinc-100">
      <div className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-zinc-800/80 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-indigo-600/10 border border-indigo-500/20 rounded-xl flex items-center justify-center text-indigo-400">
              <FolderKanban className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-base text-zinc-100">Projects & Clusters</h3>
              <p className="text-xs text-zinc-400">Switch active project canvas or spin up a new environment</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action Bar: Search & New Project toggle */}
        <div className="p-4 border-b border-zinc-800/80 bg-zinc-900/30 flex items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects..."
              className="w-full pl-8 pr-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <button
            onClick={() => setIsCreating(!isCreating)}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isCreating ? 'Cancel' : 'New Project'}</span>
          </button>
        </div>

        {/* Create Project Inline Form */}
        {isCreating && (
          <form onSubmit={handleCreateProject} className="p-5 border-b border-indigo-500/30 bg-indigo-950/20 space-y-3 animate-in slide-in-from-top-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Initialize Project Space</span>
              </h4>
            </div>

            {error && (
              <div className="px-3 py-1.5 bg-red-950/60 border border-red-500/40 rounded text-xs text-red-300 font-mono">
                {error}
              </div>
            )}

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Project Name (Slug)</label>
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. mobile-api"
                required
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div>
              <label className="text-[11px] text-zinc-400 block mb-1">Description</label>
              <input
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="Brief summary of applications in this project"
                className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={loading || !newName.trim()}
                className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 cursor-pointer shadow-md shadow-indigo-600/20"
              >
                <span>Create & Switch</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </form>
        )}

        {/* Projects List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {filtered.map((proj) => {
            const isActive = currentProject.toLowerCase() === proj.name.toLowerCase();
            return (
              <button
                key={proj.id}
                onClick={() => {
                  onSelectProject(proj.name);
                  onClose();
                }}
                className={`w-full p-4 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between border ${
                  isActive
                    ? 'bg-indigo-600/15 border-indigo-500/50 text-indigo-100 shadow-md ring-1 ring-indigo-500/20'
                    : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-900/60 text-zinc-300'
                }`}
              >
                <div className="space-y-1 truncate pr-4">
                  <div className="flex items-center gap-2.5">
                    <span className="font-bold text-sm font-mono text-zinc-100">{proj.name}</span>
                    <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700/60 text-[10px] font-mono text-zinc-400 uppercase tracking-wider">
                      {proj.environment}
                    </span>
                    {isActive && (
                      <span className="px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-[10px] font-mono flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                        <span>Active</span>
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 font-sans line-clamp-1">{proj.description}</p>
                </div>

                <div className="flex items-center gap-3 shrink-0 text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-1 bg-zinc-950/60 px-2 py-1 rounded border border-zinc-800">
                    <Server className="w-3.5 h-3.5 text-emerald-400" />
                    <span>{proj.serviceCount || 2} services</span>
                  </div>
                  <div className="flex items-center gap-1 bg-zinc-950/60 px-2 py-1 rounded border border-zinc-800">
                    <Database className="w-3.5 h-3.5 text-indigo-400" />
                    <span>{proj.databaseCount || 1} dbs</span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-between text-xs font-mono text-zinc-400">
          {onOpenDashboard ? (
            <button
              onClick={() => {
                onClose();
                onOpenDashboard();
              }}
              className="text-indigo-400 hover:text-indigo-300 font-semibold flex items-center gap-1.5 cursor-pointer"
            >
              <FolderKanban className="w-3.5 h-3.5" />
              <span>Go to All Projects Dashboard →</span>
            </button>
          ) : (
            <span>Every project has an isolated Docker network & environment space</span>
          )}
          <span className="text-[11px] text-zinc-500">NoWay Multi-Tenancy</span>
        </div>
      </div>
    </div>
  );
}
