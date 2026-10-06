'use client';

import React, { useState, useEffect } from 'react';
import {
  FolderKanban,
  Search,
  Plus,
  ArrowRight,
  Database,
  Server,
  Layers,
  Flame,
  Globe,
  GitBranch,
  Calendar,
  Sparkles,
  Trash2,
  ExternalLink,
  ShieldCheck,
  Check,
  Users,
  ChevronDown,
  RefreshCw,
  X,
  Sliders
} from 'lucide-react';
import {
  fetchProjects,
  createProject,
  deleteProject,
  ProjectRecord,
} from '@/lib/api';
import { PostgresLogo, RedisLogo } from '../icons/DatabaseLogos';
import { DeleteProjectModal } from './DeleteProjectModal';

interface ProjectsDashboardProps {
  onOpenProject: (projectName: string) => void;
  onOpenSettings?: () => void;
  currentOrg?: string;
  onOpenTeamModal?: () => void;
}

export function ProjectsDashboard({
  onOpenProject,
  onOpenSettings,
  currentOrg = 'Acme Corp',
  onOpenTeamModal,
}: ProjectsDashboardProps) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [projectToDelete, setProjectToDelete] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  useEffect(() => {
    loadProjects();
  }, []);

  async function loadProjects() {
    setLoading(true);
    try {
      const data = await fetchProjects();
      setProjects(data);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;

    setIsSubmitting(true);
    setErrorNotice(null);

    try {
      const created = await createProject(newName.trim(), newDesc.trim(), 'production');
      setProjects([created, ...projects]);
      setIsCreateModalOpen(false);
      setNewName('');
      setNewDesc('');
      onOpenProject(created.name);
    } catch (err: any) {
      setErrorNotice(err.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleDelete(e: React.MouseEvent, id: string, name: string) {
    e.stopPropagation();
    setProjectToDelete({ id, name });
  }

  async function handleConfirmDeleteProject() {
    if (!projectToDelete) return;
    setIsDeletingProject(true);
    try {
      await deleteProject(projectToDelete.id);
      setProjects(projects.filter((p) => p.id !== projectToDelete.id && p.name !== projectToDelete.name));
      setProjectToDelete(null);
    } catch (err: any) {
      setErrorNotice(err.message || 'Failed to delete project');
    } finally {
      setIsDeletingProject(false);
    }
  }

  const filtered = projects.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-screen h-screen bg-[#09090b] text-zinc-100 flex flex-col font-sans select-none overflow-hidden">
      {/* Top Navbar */}
      <header className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl px-6 flex items-center justify-between z-20 shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5 text-zinc-100 font-bold tracking-tight text-sm">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span>RAILWAY PAAS</span>
          </div>

          <span className="text-zinc-700">/</span>

          <button
            onClick={onOpenTeamModal}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-zinc-400" />
            <span>{currentOrg}</span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>

          <span className="text-zinc-700">/</span>

          <div className="flex items-center gap-1.5 bg-zinc-900/60 p-1 rounded-xl border border-zinc-800">
            <span className="px-2.5 py-1 text-xs font-semibold text-zinc-100 bg-zinc-800 rounded-lg shadow-sm">
              Projects
            </span>
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/60 rounded-lg transition-colors cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5 text-zinc-400" />
                <span>System Settings</span>
              </button>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-600/25 transition-all cursor-pointer hover:scale-[1.02]"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Project</span>
          </button>

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 pl-1.5 pr-2.5 py-1 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 rounded-xl transition-colors cursor-pointer group"
              title="Open System Settings"
            >
              <div className="w-6 h-6 bg-white text-black font-bold text-[10px] rounded flex items-center justify-center shadow-sm">
                GA
              </div>
              <div className="text-left hidden sm:block">
                <div className="text-[11px] font-semibold text-zinc-200 group-hover:text-white leading-tight">
                  George A.
                </div>
                <div className="text-[9px] font-mono text-zinc-500 uppercase leading-none">
                  OWNER
                </div>
              </div>
            </button>
          )}
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-8 max-w-7xl mx-auto w-full">
        {/* Banner / Title Row */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Projects</h1>
              <span className="px-2 py-0.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-mono">
                {projects.length} Environments
              </span>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Select a project to inspect its service canvas, live logs, variables, and mesh networking.
            </p>
          </div>

          {/* Search Bar */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search projects or services..."
              className="w-full pl-9 pr-3.5 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        </div>

        {/* Projects Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {/* New Project Prompt Card */}
          <div
            onClick={() => setIsCreateModalOpen(true)}
            className="border-2 border-dashed border-zinc-800 hover:border-indigo-500/60 bg-zinc-900/20 hover:bg-zinc-900/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-all duration-200 group min-h-[220px]"
          >
            <div className="w-12 h-12 rounded-xl bg-zinc-900 border border-zinc-800 group-hover:border-indigo-500/50 group-hover:bg-indigo-600/10 flex items-center justify-center text-zinc-400 group-hover:text-indigo-400 transition-all mb-3 shadow-lg">
              <Plus className="w-6 h-6" />
            </div>
            <h3 className="font-semibold text-sm text-zinc-200 group-hover:text-zinc-100">
              Create New Project
            </h3>
            <p className="text-xs text-zinc-500 mt-1 max-w-[200px]">
              Deploy a new database, Redis, GitHub repo, or custom web container.
            </p>
          </div>

          {/* Project Cards */}
          {filtered.map((proj) => {
            const envColors = {
              production: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400',
              staging: 'border-amber-500/30 bg-amber-500/10 text-amber-400',
              preview: 'border-purple-500/30 bg-purple-500/10 text-purple-400',
            }[proj.environment] || 'border-zinc-700 bg-zinc-800 text-zinc-300';

            return (
              <div
                key={proj.id}
                onClick={() => onOpenProject(proj.name)}
                className="border border-zinc-800 hover:border-zinc-700 bg-zinc-950/60 hover:bg-zinc-900/50 rounded-2xl p-5 flex flex-col justify-between cursor-pointer transition-all duration-200 shadow-xl group hover:shadow-2xl relative overflow-hidden"
              >
                {/* Top Row: Name, Environment, Delete */}
                <div>
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-zinc-900 border border-zinc-800 flex items-center justify-center text-indigo-400 group-hover:border-indigo-500/30">
                        <FolderKanban className="w-4 h-4" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-zinc-100 group-hover:text-indigo-300 transition-colors">
                          {proj.name}
                        </h3>
                        <span className="text-[10px] text-zinc-500 font-mono">
                          ID: {proj.id.replace('proj-', '')}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded-full border text-[10px] font-mono capitalize ${envColors}`}>
                        {proj.environment}
                      </span>
                      <button
                        onClick={(e) => handleDelete(e, proj.id, proj.name)}
                        className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-950/30 rounded-lg transition-colors"
                        title="Delete Project"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Description */}
                  <p className="text-xs text-zinc-400 line-clamp-2 mt-2 leading-relaxed">
                    {proj.description || 'Modern cloud service and database environment'}
                  </p>

                  {/* Services & Databases Preview Pills */}
                  <div className="mt-4 pt-3 border-t border-zinc-900">
                    <div className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                      <span>Services in Project</span>
                      <span>
                        {(proj.servicesSummary?.length || 0)} Total
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 min-h-[38px]">
                      {proj.servicesSummary && proj.servicesSummary.length > 0 ? (
                        proj.servicesSummary.map((svc, i) => {
                          const isRedis = svc.type === 'redis';
                          const isPg = svc.type === 'postgres';
                          const badgeBorder = isRedis
                            ? 'border-rose-500/30 bg-rose-950/20 text-rose-300'
                            : isPg
                            ? 'border-indigo-500/30 bg-indigo-950/20 text-indigo-300'
                            : 'border-emerald-500/30 bg-emerald-950/20 text-emerald-300';

                          return (
                            <span
                              key={i}
                              className={`px-2 py-1 rounded-md text-[11px] font-mono border flex items-center gap-1.5 ${badgeBorder}`}
                            >
                              {isRedis && <RedisLogo className="w-3.5 h-3.5" />}
                              {isPg && <PostgresLogo className="w-3.5 h-3.5" />}
                              {!isRedis && !isPg && <Server className="w-3 h-3 text-emerald-400" />}
                              <span>{svc.name}</span>
                              {svc.port && (
                                <span className="text-[9px] opacity-70">:{svc.port}</span>
                              )}
                            </span>
                          );
                        })
                      ) : (
                        <span className="text-[11px] text-zinc-600 font-mono italic">
                          No services deployed yet
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer / CTA */}
                <div className="mt-5 pt-3 border-t border-zinc-800/80 flex items-center justify-between text-xs font-mono text-zinc-400">
                  <div className="flex items-center gap-3 text-[11px]">
                    <span className="text-zinc-300 font-semibold">{proj.serviceCount} svc</span>
                    <span>•</span>
                    <span className="text-zinc-300 font-semibold">{proj.databaseCount} db</span>
                  </div>

                  <div className="flex items-center gap-1 text-indigo-400 font-semibold group-hover:translate-x-1 transition-transform">
                    <span>Open Canvas</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Create New Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-zinc-100">Create New Project</h3>
                  <p className="text-[11px] text-zinc-400">Isolated workspace for services and databases</p>
                </div>
              </div>
              <button
                onClick={() => setIsCreateModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorNotice && (
              <div className="p-3 rounded-lg bg-red-950/40 border border-red-500/30 text-xs font-mono text-red-300">
                {errorNotice}
              </div>
            )}

            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  Project Name
                </label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. mobile-fintech, internal-portal"
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
                <p className="text-[10px] text-zinc-500 mt-1 font-mono">
                  Slug: {newName.toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'my-project'}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-zinc-300 block mb-1.5">
                  Description (Optional)
                </label>
                <textarea
                  rows={2}
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="Core microservices, Redis cache, and PostgreSQL cluster..."
                  className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl text-xs font-medium transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newName.trim() || isSubmitting}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-600/30 transition-all cursor-pointer"
                >
                  {isSubmitting ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  <span>Create & Open Canvas</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Project Confirmation Modal */}
      {projectToDelete && (
        <DeleteProjectModal
          isOpen={!!projectToDelete}
          onClose={() => setProjectToDelete(null)}
          onConfirm={handleConfirmDeleteProject}
          projectName={projectToDelete.name}
          projectId={projectToDelete.id}
          isDeleting={isDeletingProject}
        />
      )}
    </div>
  );
}
