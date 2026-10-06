'use client';

import React, { useState, useCallback, useEffect } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  addEdge,
  Connection,
  Edge,
  Node,
  BackgroundVariant,
} from '@xyflow/react';
import { ServiceNode } from './nodes/ServiceNode';
import { DatabaseNode } from './nodes/DatabaseNode';
import { TerminalDrawer } from '../terminal/TerminalDrawer';
import { NeonDatabaseStudio } from '../studio/NeonDatabaseStudio';
import { DatabaseSettingsModal } from '../database/DatabaseSettingsModal';
import { DeleteDatabaseModal } from '../database/DeleteDatabaseModal';
import { CreateServiceModal } from './CreateServiceModal';
import { AuthAndTeamModal } from '../auth/AuthAndTeamModal';
import { GitHubRepoModal, GitHubIcon } from '../github/GitHubRepoModal';
import { PostgresLogo, RedisLogo } from '../icons/DatabaseLogos';
import { ProjectSwitcherModal } from '../project/ProjectSwitcherModal';
import { ServiceDetailDrawer } from '../service/ServiceDetailDrawer';
import {
  provisionDatabase,
  provisionRedis,
  deleteDatabase,
  fetchDatabases,
  deployService,
  fetchServices,
  updateServiceEnv,
  fetchProject,
  saveProjectCanvas,
} from '@/lib/api';
import {
  Database,
  Globe,
  Plus,
  Sparkles,
  Layers,
  Terminal,
  Server,
  Users,
  Settings,
  ChevronDown,
  Activity,
  Check,
  FolderKanban,
  Flame,
  Sliders,
  ArrowLeft
} from 'lucide-react';

const nodeTypes = {
  serviceNode: ServiceNode,
  databaseNode: DatabaseNode,
};

const initialNodes: Node[] = [];
const initialEdges: Edge[] = [];

interface RailwayCanvasProps {
  activeProject?: string;
  onBackToProjects?: () => void;
  onSelectProject?: (name: string) => void;
  onOpenSettings?: () => void;
}

export function RailwayCanvas({
  activeProject = '',
  onBackToProjects,
  onSelectProject,
  onOpenSettings,
}: RailwayCanvasProps) {
  const [currentProject, setCurrentProject] = useState(activeProject);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Studio and Terminal state
  const [activeStudioDb, setActiveStudioDb] = useState<{ id: string; name: string } | null>(null);
  const [activeSettingsDb, setActiveSettingsDb] = useState<{ id: string; name: string; engine?: string; connectionUrl?: string } | null>(null);
  const [pendingDeleteDb, setPendingDeleteDb] = useState<{ id: string; name: string; engine?: string } | null>(null);
  const [isDeletingDb, setIsDeletingDb] = useState(false);
  const [isCreateServiceModalOpen, setIsCreateServiceModalOpen] = useState(false);
  const [activeTerminalService, setActiveTerminalService] = useState<{ id?: string; name: string } | null>(null);
  const [linkNotification, setLinkNotification] = useState<string | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isGitHubModalOpen, setIsGitHubModalOpen] = useState(false);
  const [isProjectModalOpen, setIsProjectModalOpen] = useState(false);
  const [selectedServiceForDrawer, setSelectedServiceForDrawer] = useState<any | null>(null);
  const [currentOrg, setCurrentOrg] = useState('My Cloud');

  // Keep currentProject in sync with prop
  useEffect(() => {
    if (activeProject && activeProject !== currentProject) {
      setCurrentProject(activeProject);
    }
  }, [activeProject]);

  // Load project nodes and edges from backend whenever currentProject changes
  useEffect(() => {
    let isMounted = true;
    fetchProject(currentProject)
      .then((proj) => {
        if (!isMounted) return;
        if (proj.nodes && proj.nodes.length > 0) {
          setNodes(proj.nodes);
          setEdges(proj.edges || []);
        } else {
          setNodes([]);
          setEdges([]);
        }
      })
      .catch(() => {
        if (!isMounted) return;
        setNodes([]);
        setEdges([]);
      });

    return () => {
      isMounted = false;
    };
  }, [currentProject, setNodes, setEdges]);

  // Real-time synchronization loop: continuously sync Docker container statuses and resolve building nodes
  useEffect(() => {
    let isSubscribed = true;

    async function syncRealtimeStatus() {
      try {
        const [services, databases] = await Promise.all([
          fetchServices().catch(() => []),
          fetchDatabases().catch(() => []),
        ]);

        if (!isSubscribed) return;

        setNodes((prevNodes: Node[]) => {
          let hasChanges = false;
          const nextNodes = prevNodes.map((n: Node) => {
            const nodeData = (n.data || {}) as Record<string, any>;

            if (n.type === 'serviceNode') {
              // 1. If it's a temporary building node (deploying-*)
              if (n.id.startsWith('deploying-')) {
                // Check if the service has finished building and now exists in Docker
                const matchingService = services.find(
                  (s) =>
                    s.name === nodeData.name ||
                    (nodeData.gitRepo && s.gitRepo === nodeData.gitRepo)
                );

                if (matchingService) {
                  hasChanges = true;
                  return {
                    ...n,
                    id: matchingService.id,
                    data: {
                      ...nodeData,
                      name: matchingService.name,
                      status: matchingService.status || 'running',
                      port: matchingService.port || nodeData.port || 3000,
                      gitRepo: matchingService.gitRepo || nodeData.gitRepo,
                      gitBranch: matchingService.gitBranch || nodeData.gitBranch,
                      branch: matchingService.gitBranch || nodeData.branch || 'main',
                      subfolder: matchingService.subfolder || nodeData.subfolder,
                      createdAt: matchingService.createdAt,
                      startedAt: matchingService.startedAt,
                      env: matchingService.env || nodeData.env || {},
                      cpuPercent: '0.2%',
                      memoryUsage: '32MB',
                    },
                  };
                }

                // If no service found and timestamp > 3 mins old, mark as failed instead of stuck in building
                const createdMs = parseInt(n.id.replace('deploying-', ''), 10);
                if (!isNaN(createdMs) && Date.now() - createdMs > 180000 && nodeData.status === 'building') {
                  hasChanges = true;
                  return {
                    ...n,
                    data: {
                      ...nodeData,
                      status: 'failed',
                      errorMessage: 'Build process timed out or was interrupted. Check deployment logs or redeploy.',
                    },
                  };
                }

                return n;
              }

              // 2. Regular service node
              const realService = services.find(
                (s) => s.id === n.id || s.name === nodeData.name
              );

              if (realService) {
                const currentStatus = realService.status || 'running';
                if (
                  nodeData.status !== currentStatus ||
                  nodeData.port !== realService.port ||
                  nodeData.createdAt !== realService.createdAt ||
                  nodeData.startedAt !== realService.startedAt
                ) {
                  hasChanges = true;
                  return {
                    ...n,
                    id: realService.id,
                    data: {
                      ...nodeData,
                      name: realService.name,
                      status: currentStatus,
                      port: realService.port || nodeData.port || 3000,
                      gitRepo: realService.gitRepo || nodeData.gitRepo,
                      gitBranch: realService.gitBranch || nodeData.gitBranch,
                      subfolder: realService.subfolder || nodeData.subfolder,
                      createdAt: realService.createdAt,
                      startedAt: realService.startedAt,
                      env: realService.env || nodeData.env || {},
                    },
                  };
                }
              }
            }

            if (n.type === 'databaseNode') {
              const realDb = databases.find((d) => d.id === n.id || d.name === nodeData.name);
              if (realDb) {
                if (nodeData.status !== 'healthy' || nodeData.connectionUrl !== realDb.connectionUrl) {
                  hasChanges = true;
                  return {
                    ...n,
                    data: {
                      ...nodeData,
                      status: 'healthy',
                      connectionUrl: realDb.connectionUrl,
                      port: realDb.port,
                    },
                  };
                }
              }
            }

            return n;
          });

          if (hasChanges) {
            saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
            return nextNodes;
          }
          return prevNodes;
        });
      } catch {
        // Network or backend temporarily unavailable
      }
    }

    // Run initial sync after a short delay, then every 3 seconds
    const interval = setInterval(syncRealtimeStatus, 3000);
    const timeout = setTimeout(syncRealtimeStatus, 500);

    return () => {
      isSubscribed = false;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [currentProject, edges]);

  // Keep open service drawer in sync with updated node data
  useEffect(() => {
    if (selectedServiceForDrawer) {
      const activeNode = nodes.find(
        (n) => n.id === selectedServiceForDrawer.id || (n.data as any)?.name === selectedServiceForDrawer.name
      );
      if (activeNode && activeNode.data) {
        const d = activeNode.data as any;
        if (
          d.status !== selectedServiceForDrawer.status ||
          d.errorMessage !== selectedServiceForDrawer.errorMessage ||
          d.startedAt !== selectedServiceForDrawer.startedAt ||
          d.gitRepo !== selectedServiceForDrawer.gitRepo
        ) {
          setSelectedServiceForDrawer((prev: any) => ({
            ...prev,
            id: activeNode.id,
            name: d.name || prev.name,
            status: d.status,
            errorMessage: d.errorMessage,
            gitRepo: d.gitRepo,
            gitBranch: d.gitBranch || d.branch,
            subfolder: d.subfolder,
            dockerfilePath: d.dockerfilePath,
            createdAt: d.createdAt,
            startedAt: d.startedAt,
            port: d.port,
            env: d.env,
          }));
        }
      }
    }
  }, [nodes, selectedServiceForDrawer]);

  // Wire linking: auto-inject DATABASE_URL or REDIS_URL
  const onConnect = useCallback(
    async (params: Connection) => {
      const newEdges = addEdge(
        {
          ...params,
          animated: true,
          style: { stroke: '#6366f1', strokeWidth: 2 },
        } as Edge,
        edges
      );
      setEdges(newEdges);

      const sourceNode = nodes.find((n) => n.id === params.source);
      const targetNode = nodes.find((n) => n.id === params.target);
      const sourceName = (sourceNode?.data as any)?.name || 'database';
      const targetName = (targetNode?.data as any)?.name || 'service';
      const engine = (sourceNode?.data as any)?.engine || 'postgres';
      const isRedis = engine === 'redis';

      const connUrl =
        (sourceNode?.data as any)?.connectionUrl ||
        (isRedis
          ? `redis://default:secret@${sourceNode?.id || 'paas-redis'}:6379`
          : `postgresql://postgres:secret@${sourceNode?.id || 'paas-pg'}:5432/railway`);

      const envKey = isRedis ? 'REDIS_URL' : 'DATABASE_URL';

      if (targetNode?.id) {
        try {
          await updateServiceEnv(targetNode.id, { [envKey]: connUrl });
        } catch {}
      }

      setLinkNotification(`✨ Injected \${{ ${sourceName}.${envKey} }} into ${targetName}!`);
      setTimeout(() => setLinkNotification(null), 3500);

      // Persist canvas
      saveProjectCanvas(currentProject, nodes, newEdges).catch(() => {});
    },
    [nodes, edges, currentProject, setEdges]
  );

  async function addNewPostgres(customName?: string) {
    const dbName = customName?.trim() || `postgres-${Math.floor(Math.random() * 900 + 100)}`;
    const tempId = `db-${Date.now()}`;
    const newNode: Node = {
      id: tempId,
      type: 'databaseNode',
      position: { x: 120, y: 160 + nodes.length * 90 },
      data: {
        name: dbName,
        status: 'healthy',
        engine: 'PostgreSQL 16',
        diskUsage: '512MB',
        connectionUrl: `postgresql://postgres:pass@${tempId}:5432/railway`,
      },
    };
    const nextNodes = [...nodes, newNode];
    setNodes(nextNodes);

    try {
      const realDb = await provisionDatabase(dbName);
      const updatedNodes = nextNodes.map((n) =>
        n.id === tempId
          ? {
              ...n,
              id: realDb.id,
              data: {
                ...n.data,
                name: realDb.name,
                connectionUrl: realDb.connectionUrl,
              },
            }
          : n
      );
      setNodes(updatedNodes);
      saveProjectCanvas(currentProject, updatedNodes, edges).catch(() => {});
    } catch {
      saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
    }
  }

  async function addNewRedis(customName?: string) {
    const redisName = customName?.trim() || `redis-${Math.floor(Math.random() * 900 + 100)}`;
    const tempId = `db-${Date.now()}`;
    const newNode: Node = {
      id: tempId,
      type: 'databaseNode',
      position: { x: 120, y: 220 + nodes.length * 90 },
      data: {
        name: redisName,
        status: 'healthy',
        engine: 'redis',
        diskUsage: '16MB',
        connectionUrl: `redis://default:secret@${tempId}:6379`,
      },
    };
    const nextNodes = [...nodes, newNode];
    setNodes(nextNodes);

    try {
      const realRedis = await provisionRedis(redisName);
      const updatedNodes = nextNodes.map((n) =>
        n.id === tempId
          ? {
              ...n,
              id: realRedis.id,
              data: {
                ...n.data,
                name: realRedis.name,
                engine: 'redis',
                connectionUrl: realRedis.connectionUrl,
              },
            }
          : n
      );
      setNodes(updatedNodes);
      saveProjectCanvas(currentProject, updatedNodes, edges).catch(() => {});
    } catch {
      saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
    }
  }

  async function executeDeleteDatabase(id: string, name: string) {
    setIsDeletingDb(true);
    try {
      await deleteDatabase(id);
      const nextNodes = nodes.filter((n) => n.id !== id);
      const nextEdges = edges.filter((e) => e.source !== id && e.target !== id);

      setNodes(nextNodes);
      setEdges(nextEdges);

      if (activeStudioDb?.id === id) setActiveStudioDb(null);
      if (activeSettingsDb?.id === id) setActiveSettingsDb(null);
      setPendingDeleteDb(null);

      await saveProjectCanvas(currentProject, nextNodes, nextEdges).catch(() => {});
      setLinkNotification(`🗑️ Deleted database "${name}"`);
      setTimeout(() => setLinkNotification(null), 3500);
    } catch (err: any) {
      alert(`Delete error: ${err.message}`);
    } finally {
      setIsDeletingDb(false);
    }
  }

  return (
    <div className="relative w-screen h-screen bg-[#09090b] overflow-hidden flex flex-col font-sans select-none">
      {/* Top Main Navigation Bar */}
      <div className="h-14 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-xl px-5 flex items-center justify-between z-20 shadow-md">
        {/* Left: Organization, Projects Breadcrumb & Switcher */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-100 font-bold tracking-tight text-sm">
            <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-600/30">
              <Layers className="w-4 h-4 text-white" />
            </div>
            <span>RAILWAY</span>
          </div>

          <span className="text-zinc-700">/</span>

          <button
            onClick={() => setIsAuthModalOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <Users className="w-3.5 h-3.5 text-zinc-400" />
            <span>{currentOrg}</span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>

          <span className="text-zinc-700">/</span>

          {/* Clickable Projects Breadcrumb Link */}
          {onBackToProjects ? (
            <button
              onClick={onBackToProjects}
              className="flex items-center gap-1.5 px-2 py-1 rounded-lg hover:bg-zinc-850 hover:text-indigo-300 text-zinc-400 text-xs font-medium transition-colors cursor-pointer"
              title="Return to Projects Dashboard"
            >
              <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
              <span>Projects</span>
            </button>
          ) : (
            <span className="text-xs font-medium text-zinc-400">Projects</span>
          )}

          <span className="text-zinc-700">/</span>

          {/* Active Project Switcher Button */}
          <button
            onClick={() => setIsProjectModalOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-medium text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            <span>Project: <strong className="text-zinc-100">{currentProject}</strong></span>
            <ChevronDown className="w-3 h-3 text-zinc-500" />
          </button>
        </div>

        {/* Center: Link Notification Banner */}
        {linkNotification && (
          <div className="flex items-center gap-2 px-3 py-1 bg-indigo-600/20 border border-indigo-500/40 text-indigo-300 text-xs font-mono rounded-lg shadow-lg animate-in fade-in slide-in-from-top-2">
            <Check className="w-3.5 h-3.5 text-indigo-400" />
            <span>{linkNotification}</span>
          </div>
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-2">
          {onBackToProjects && (
            <button
              onClick={onBackToProjects}
              className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="View all projects"
            >
              <FolderKanban className="w-3.5 h-3.5 text-indigo-400" />
              <span>All Projects</span>
            </button>
          )}

          {onOpenSettings && (
            <button
              onClick={onOpenSettings}
              className="px-2.5 py-1.5 bg-zinc-900 hover:bg-zinc-850 border border-zinc-800 text-zinc-300 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer"
              title="Open System Settings"
            >
              <Sliders className="w-3.5 h-3.5 text-zinc-400" />
              <span>Settings</span>
            </button>
          )}

          <button
            onClick={() => setIsCreateServiceModalOpen(true)}
            className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add a new service</span>
          </button>
        </div>
      </div>

      {/* React Flow Interactive Canvas */}
      <div className="flex-1 w-full h-full relative railway-canvas">
        <ReactFlow
          nodes={nodes.map((n) => {
            const nodeData = (n.data || {}) as Record<string, any>;
            return {
              ...n,
              data: {
                ...nodeData,
                onOpenStudio: () => setActiveStudioDb({ id: n.id, name: String(nodeData.name || n.id) }),
                onOpenSettings: () =>
                  setActiveSettingsDb({
                    id: n.id,
                    name: String(nodeData.name || n.id),
                    engine: nodeData.engine || (n.id.includes('redis') ? 'redis' : 'postgres'),
                    connectionUrl: String(nodeData.connectionUrl || ''),
                  }),
                onOpenLogs: () => setActiveTerminalService({ id: n.id, name: String(nodeData.name || n.id) }),
                onOpenDetails: () =>
                  setSelectedServiceForDrawer({
                    id: n.id,
                    name: String(nodeData.name || n.id),
                    gitRepo: nodeData.gitRepo,
                    gitBranch: nodeData.gitBranch || nodeData.branch,
                    branch: String(nodeData.branch || 'main'),
                    subfolder: nodeData.subfolder,
                    dockerfilePath: nodeData.dockerfilePath,
                    buildMethod: nodeData.buildMethod,
                    runtimeMode: nodeData.runtimeMode,
                    port: nodeData.port || 3000,
                    env: nodeData.env || {},
                    status: String(nodeData.status || 'running'),
                    errorMessage: nodeData.errorMessage,
                    createdAt: nodeData.createdAt,
                    startedAt: nodeData.startedAt,
                  }),
              },
            };
          })}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeClick={(_event: React.MouseEvent, node: Node) => {
            const nodeData = (node.data || {}) as Record<string, any>;
            if (node.type === 'serviceNode') {
              setSelectedServiceForDrawer({
                id: node.id,
                name: String(nodeData.name || node.id),
                gitRepo: nodeData.gitRepo,
                gitBranch: nodeData.gitBranch || nodeData.branch,
                branch: String(nodeData.branch || 'main'),
                subfolder: nodeData.subfolder,
                dockerfilePath: nodeData.dockerfilePath,
                buildMethod: nodeData.buildMethod,
                runtimeMode: nodeData.runtimeMode,
                port: nodeData.port || 3000,
                env: nodeData.env || {},
                status: String(nodeData.status || 'running'),
                errorMessage: nodeData.errorMessage,
                createdAt: nodeData.createdAt,
                startedAt: nodeData.startedAt,
              });
            } else if (node.type === 'databaseNode') {
              setActiveSettingsDb({
                id: node.id,
                name: String(nodeData.name || node.id),
                engine: nodeData.engine || (node.id.includes('redis') ? 'redis' : 'postgres'),
                connectionUrl: String(nodeData.connectionUrl || ''),
              });
            }
          }}
          nodeTypes={nodeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="#27272a" />
          <Controls className="!bg-zinc-900 !border-zinc-800 !fill-zinc-400" />
          <MiniMap
            className="!bg-zinc-950 !border-zinc-800 !rounded-xl"
            nodeColor={(node) => (node.type === 'databaseNode' ? '#818cf8' : '#34d399')}
          />
        </ReactFlow>

        {/* Empty Canvas Quick-Start Overlay */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
            <div className="pointer-events-auto max-w-lg w-full mx-4 p-8 rounded-2xl border border-zinc-800 bg-zinc-950/90 backdrop-blur-xl shadow-2xl text-center space-y-6 animate-in fade-in zoom-in-95">
              <div className="w-12 h-12 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 mx-auto flex items-center justify-center">
                <Layers className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-100">
                  Welcome to <span className="text-indigo-400">{currentProject}</span>
                </h3>
                <p className="text-xs text-zinc-400 mt-1 max-w-sm mx-auto">
                  Deploy a database, in-memory cache, or deploy directly from GitHub into this isolated environment.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-left">
                <button
                  onClick={() => setIsCreateServiceModalOpen(true)}
                  className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-indigo-500/50 transition-all flex flex-col gap-1 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold group-hover:text-indigo-300">
                    <PostgresLogo className="w-4 h-4" />
                    <span>PostgreSQL 16</span>
                  </div>
                  <span className="text-[11px] text-zinc-500">With Neon Table Studio</span>
                </button>

                <button
                  onClick={() => setIsCreateServiceModalOpen(true)}
                  className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-rose-500/50 transition-all flex flex-col gap-1 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 text-rose-400 text-xs font-semibold group-hover:text-rose-300">
                    <RedisLogo className="w-4 h-4" />
                    <span>Redis 7 Cache</span>
                  </div>
                  <span className="text-[11px] text-zinc-500">Fast in-memory store</span>
                </button>

                <button
                  onClick={() => setIsGitHubModalOpen(true)}
                  className="p-3.5 rounded-xl border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-900 hover:border-zinc-600 transition-all flex flex-col gap-1 cursor-pointer group"
                >
                  <div className="flex items-center gap-2 text-zinc-200 text-xs font-semibold group-hover:text-white">
                    <GitHubIcon className="w-4 h-4 text-zinc-300" />
                    <span>Deploy GitHub</span>
                  </div>
                  <span className="text-[11px] text-zinc-500">Deploy repository branch</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Canvas Helpful Hint Pill */}
        <div className="absolute bottom-5 left-6 px-3 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800/80 backdrop-blur-md text-[11px] text-zinc-400 font-mono shadow-xl flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
          <span>Click any service for Variables, Settings, Domains, Logs & Deployments</span>
        </div>
      </div>

      {/* Neon Database Studio Slide-Over Window */}
      {activeStudioDb && (
        <div className="fixed inset-y-3 right-3 w-[840px] z-50 shadow-2xl rounded-2xl overflow-hidden border border-zinc-800 bg-zinc-950 flex flex-col animate-in slide-in-from-right duration-250">
          <NeonDatabaseStudio
            databaseId={activeStudioDb.id}
            databaseName={activeStudioDb.name}
            onClose={() => setActiveStudioDb(null)}
          />
        </div>
      )}

      {/* Database Settings, S3 Backups & Danger Zone Modal */}
      {activeSettingsDb && (
        <DatabaseSettingsModal
          isOpen={true}
          onClose={() => setActiveSettingsDb(null)}
          databaseId={activeSettingsDb.id}
          databaseName={activeSettingsDb.name}
          engine={activeSettingsDb.engine}
          connectionUrl={activeSettingsDb.connectionUrl}
          onOpenStudio={
            activeSettingsDb.engine !== 'redis' && !activeSettingsDb.name.toLowerCase().includes('redis')
              ? () => setActiveStudioDb({ id: activeSettingsDb.id, name: activeSettingsDb.name })
              : undefined
          }
          onDatabaseDeleted={(deletedId) => {
            const nextNodes = nodes.filter((n) => n.id !== deletedId);
            const nextEdges = edges.filter((e) => e.source !== deletedId && e.target !== deletedId);
            setNodes(nextNodes);
            setEdges(nextEdges);
            setActiveSettingsDb(null);
            saveProjectCanvas(currentProject, nextNodes, nextEdges).catch(() => {});
            setLinkNotification(`🗑️ Deleted database "${activeSettingsDb.name}"`);
            setTimeout(() => setLinkNotification(null), 3500);
          }}
        />
      )}

      {/* Standalone Custom Delete Database Modal (if triggered outside settings) */}
      {pendingDeleteDb && (
        <DeleteDatabaseModal
          isOpen={true}
          onClose={() => setPendingDeleteDb(null)}
          onConfirm={() => executeDeleteDatabase(pendingDeleteDb.id, pendingDeleteDb.name)}
          databaseName={pendingDeleteDb.name}
          databaseId={pendingDeleteDb.id}
          engine={pendingDeleteDb.engine}
          isDeleting={isDeletingDb}
        />
      )}

      {/* Create a new service Modal (Railway Style) */}
      <CreateServiceModal
        isOpen={isCreateServiceModalOpen}
        onClose={() => setIsCreateServiceModalOpen(false)}
        onSelectGit={() => setIsGitHubModalOpen(true)}
        onSelectDatabase={async (engine, customName) => {
          if (engine === 'postgres') {
            await addNewPostgres(customName);
          } else if (engine === 'redis') {
            await addNewRedis(customName);
          }
        }}
        onDeployDockerImage={async (image, name, port) => {
          const svcName = name || image.split(':')[0].replace(/[^a-zA-Z0-9_-]/g, '-') + '-' + Math.floor(Math.random() * 900 + 100);
          const tempId = `svc-${Date.now()}`;
          const newNode: Node = {
            id: tempId,
            type: 'serviceNode',
            position: { x: 560 + Math.floor(Math.random() * 120), y: 160 + nodes.length * 80 },
            data: {
              name: svcName,
              status: 'running',
              branch: image,
              port: port || 80,
              cpuPercent: '0.2%',
              memoryUsage: '36MB',
              env: {
                PORT: String(port || 80),
                DOCKER_IMAGE: image,
              },
            },
          };
          const nextNodes = [...nodes, newNode];
          setNodes(nextNodes);
          try {
            const realSvc = await deployService(svcName, image, port || 80);
            const updatedNodes = nextNodes.map((n) =>
              n.id === tempId ? { ...n, id: realSvc.id, data: { ...n.data, name: realSvc.name, port: realSvc.port || port || 80 } } : n
            );
            setNodes(updatedNodes);
            saveProjectCanvas(currentProject, updatedNodes, edges).catch(() => {});
            setLinkNotification(`🚀 Deployed Docker image ${image} as "${svcName}"!`);
            setTimeout(() => setLinkNotification(null), 4000);
          } catch (err: any) {
            alert(`Deploy error: ${err.message}`);
          }
        }}
      />

      {/* Terminal Drawer for Container Logs */}
      {activeTerminalService && (
        <TerminalDrawer
          serviceId={activeTerminalService.id}
          serviceName={activeTerminalService.name}
          isOpen={true}
          onClose={() => setActiveTerminalService(null)}
        />
      )}

      {/* Team Workspaces & Auth Modal */}
      <AuthAndTeamModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentOrg={currentOrg}
        onSwitchOrg={setCurrentOrg}
      />

      {/* GitHub Project & Repository Modal */}
      <GitHubRepoModal
        isOpen={isGitHubModalOpen}
        onClose={() => setIsGitHubModalOpen(false)}
        onDeployStart={(info) => {
          // Immediately add a "building" node on the canvas when user clicks Deploy
          const newNode: Node = {
            id: info.tempId,
            type: 'serviceNode',
            position: {
              x: 560 + Math.floor(Math.random() * 120),
              y: 180 + nodes.length * 80,
            },
            data: {
              name: info.name,
              status: 'building',
              gitRepo: info.cloneUrl || info.repoName,
              gitBranch: info.branch,
              branch: info.branch,
              subfolder: info.subfolder,
              port: info.port,
              buildStrategy: info.buildStrategy,
              cpuPercent: '—',
              memoryUsage: '—',
              env: {},
            },
          };
          const nextNodes = [...nodes, newNode];
          setNodes(nextNodes);
          saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
          setLinkNotification(`⚙️ Building ${info.repoName} (${info.branch})...`);
        }}
        onDeploySuccess={(service, gitInfo, tempId) => {
          // Replace the placeholder "building" node with the real deployed service node
          setNodes((prev: Node[]) => {
            const filtered = tempId ? prev.filter((n: Node) => n.id !== tempId) : prev;
            const exists = filtered.some((n: Node) => n.id === service.id);
            if (exists) return filtered;
            const placeholderPos = tempId
              ? prev.find((n: Node) => n.id === tempId)?.position
              : undefined;
            const newNode: Node = {
              id: service.id,
              type: 'serviceNode',
              position: placeholderPos ?? {
                x: 560 + Math.floor(Math.random() * 120),
                y: 180 + filtered.length * 80,
              },
              data: {
                name: service.name,
                status: 'running',
                branch: gitInfo.branch || 'main',
                subfolder: service.subfolder || gitInfo.subfolder,
                buildStrategy: gitInfo.buildStrategy,
                cpuPercent: '0.2%',
                memoryUsage: '32MB',
                port: service.port || 3000,
                gitRepo: service.gitRepo,
                gitBranch: service.gitBranch,
                env: service.env || {},
              },
            };
            const nextNodes = [...filtered, newNode];
            saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
            return nextNodes;
          });
          setLinkNotification(`🚀 Deployed ${gitInfo.repoName} (${gitInfo.branch}) successfully!`);
          setTimeout(() => setLinkNotification(null), 5000);
        }}
        onDeployError={(tempId, errorMsg, name) => {
          // Mark the placeholder node as failed
          setNodes((prev: Node[]) => {
            const updated = prev.map((n: Node) =>
              n.id === tempId
                ? { ...n, data: { ...n.data, status: 'failed', errorMessage: errorMsg } }
                : n
            );
            saveProjectCanvas(currentProject, updated, edges).catch(() => {});
            return updated;
          });
          setLinkNotification(`❌ Deployment of ${name} failed — check build logs.`);
          setTimeout(() => setLinkNotification(null), 6000);
        }}
      />

      {/* Service Detail Drawer: Deployments, Variables, Domains, Logs, Settings */}
      {selectedServiceForDrawer && (
        <ServiceDetailDrawer
          service={selectedServiceForDrawer}
          isOpen={true}
          onClose={() => setSelectedServiceForDrawer(null)}
          onServiceUpdated={(updated) => {
            const nextNodes = nodes.map((n) =>
              n.id === updated.id ? { ...n, data: { ...n.data, ...updated } } : n
            );
            setNodes(nextNodes);
            saveProjectCanvas(currentProject, nextNodes, edges).catch(() => {});
          }}
          onServiceDeleted={(id) => {
            const nextNodes = nodes.filter((n) => n.id !== id);
            const nextEdges = edges.filter((e) => e.source !== id && e.target !== id);
            setNodes(nextNodes);
            setEdges(nextEdges);
            setSelectedServiceForDrawer(null);
            saveProjectCanvas(currentProject, nextNodes, nextEdges).catch(() => {});
          }}
        />
      )}

      {/* Project Switcher Modal */}
      <ProjectSwitcherModal
        isOpen={isProjectModalOpen}
        onClose={() => setIsProjectModalOpen(false)}
        currentProject={currentProject}
        onSelectProject={(newProj) => {
          setCurrentProject(newProj);
          onSelectProject?.(newProj);
          setLinkNotification(`Switched to project space "${newProj}"`);
          setTimeout(() => setLinkNotification(null), 3500);
        }}
        onOpenDashboard={onBackToProjects}
      />
    </div>
  );
}
