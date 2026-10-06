'use client';

import React, { useState, useEffect } from 'react';
import { ProjectsDashboard } from '@/components/project/ProjectsDashboard';
import { RailwayCanvas } from '@/components/canvas/RailwayCanvas';
import { SystemSettingsView } from '@/components/settings/SystemSettingsView';
import { AuthAndTeamModal } from '@/components/auth/AuthAndTeamModal';
import { SetupScreen } from '@/components/auth/SetupScreen';
import { LoginScreen } from '@/components/auth/LoginScreen';
import {
  fetchAuthStatus,
  getAuthToken,
  setAuthToken,
  clearAuthToken,
  fetchMe,
  logoutFromServer,
  AuthUser,
} from '@/lib/api';
import { Loader2, Server } from 'lucide-react';

type AuthState =
  | { phase: 'loading' }
  | { phase: 'setup' }
  | { phase: 'login'; instanceName: string }
  | { phase: 'app'; user: AuthUser; instanceName: string };

export default function Home() {
  const [auth, setAuth] = useState<AuthState>({ phase: 'loading' });
  const [currentView, setCurrentView] = useState<'projects' | 'canvas' | 'settings'>('projects');
  const [activeProject, setActiveProject] = useState('');
  const [currentOrg, setCurrentOrg] = useState('My Cloud');
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);

  // ── Bootstrap: check auth status on first load ─────────────────────────────
  useEffect(() => {
    async function bootstrap() {
      try {
        const status = await fetchAuthStatus();

        if (!status.isSetupComplete) {
          setAuth({ phase: 'setup' });
          return;
        }

        // Try existing token first
        const storedToken = getAuthToken();
        if (storedToken) {
          try {
            const me = await fetchMe();
            setAuth({ phase: 'app', user: me.user, instanceName: me.instanceName });
            setCurrentOrg(me.instanceName);
            restoreView();
            return;
          } catch {
            clearAuthToken();
          }
        }

        // No valid token — show login
        setAuth({ phase: 'login', instanceName: status.instanceName });
      } catch {
        // Can't reach server — show login with default name and let the user retry
        setAuth({ phase: 'login', instanceName: 'VPS Cloud' });
      }
    }
    bootstrap();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function restoreView() {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const viewParam = params.get('view');
    const projParam = params.get('project');
    const savedProj = localStorage.getItem('vps_active_project');
    const savedView = localStorage.getItem('vps_current_view');

    if (viewParam === 'settings') {
      setCurrentView('settings');
    } else if (projParam) {
      setActiveProject(projParam);
      setCurrentView('canvas');
      localStorage.setItem('vps_active_project', projParam);
      localStorage.setItem('vps_current_view', 'canvas');
    } else if (savedProj) {
      setActiveProject(savedProj);
      if (savedView === 'canvas') {
        setCurrentView('canvas');
      }
    }
  }

  function handleAuthSuccess(token: string, user: AuthUser, instanceName: string) {
    setAuthToken(token);
    setAuth({ phase: 'app', user, instanceName });
    setCurrentOrg(instanceName);
    restoreView();
  }

  async function handleLogout() {
    await logoutFromServer().catch(() => {});
    clearAuthToken();
    // Re-check status to decide setup vs login
    try {
      const status = await fetchAuthStatus();
      setAuth({ phase: 'login', instanceName: status.instanceName });
    } catch {
      setAuth({ phase: 'login', instanceName: 'VPS Cloud' });
    }
    setCurrentView('projects');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('vps_current_view');
    }
  }

  function handleOpenProject(projectName: string) {
    setActiveProject(projectName);
    setCurrentView('canvas');
    if (typeof window !== 'undefined') {
      localStorage.setItem('vps_active_project', projectName);
      localStorage.setItem('vps_current_view', 'canvas');
      const url = new URL(window.location.href);
      url.searchParams.set('project', projectName);
      url.searchParams.delete('view');
      window.history.pushState({}, '', url.toString());
    }
  }

  function handleBackToProjects() {
    setCurrentView('projects');
    if (typeof window !== 'undefined') {
      localStorage.setItem('vps_current_view', 'projects');
      const url = new URL(window.location.href);
      url.searchParams.delete('project');
      url.searchParams.delete('view');
      window.history.pushState({}, '', url.toString());
    }
  }

  function handleOpenSettings() {
    setCurrentView('settings');
    if (typeof window !== 'undefined') {
      localStorage.setItem('vps_current_view', 'settings');
      const url = new URL(window.location.href);
      url.searchParams.set('view', 'settings');
      window.history.pushState({}, '', url.toString());
    }
  }

  // ── Auth phases ────────────────────────────────────────────────────────────
  if (auth.phase === 'loading') {
    return (
      <div className="w-screen h-screen bg-zinc-950 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-2xl shadow-indigo-600/40">
          <Server className="w-6 h-6 text-white" />
        </div>
        <Loader2 className="w-5 h-5 text-zinc-500 animate-spin" />
        <p className="text-xs text-zinc-600 font-mono">Connecting to control plane…</p>
      </div>
    );
  }

  if (auth.phase === 'setup') {
    return <SetupScreen onComplete={handleAuthSuccess} />;
  }

  if (auth.phase === 'login') {
    return (
      <LoginScreen
        instanceName={auth.instanceName}
        onSuccess={handleAuthSuccess}
      />
    );
  }

  // ── Authenticated app ──────────────────────────────────────────────────────
  return (
    <main className="w-screen h-screen overflow-hidden bg-[#09090b]">
      {currentView === 'settings' ? (
        <SystemSettingsView onBackToProjects={handleBackToProjects} />
      ) : currentView === 'projects' ? (
        <ProjectsDashboard
          onOpenProject={handleOpenProject}
          onOpenSettings={handleOpenSettings}
          currentOrg={currentOrg}
          onOpenTeamModal={() => setIsTeamModalOpen(true)}
        />
      ) : (
        <RailwayCanvas
          activeProject={activeProject}
          onBackToProjects={handleBackToProjects}
          onOpenSettings={handleOpenSettings}
          onSelectProject={(proj) => {
            setActiveProject(proj);
            if (typeof window !== 'undefined') {
              const url = new URL(window.location.href);
              url.searchParams.set('project', proj);
              window.history.pushState({}, '', url.toString());
            }
          }}
        />
      )}

      <AuthAndTeamModal
        isOpen={isTeamModalOpen}
        onClose={() => setIsTeamModalOpen(false)}
        currentOrg={currentOrg}
        onSwitchOrg={setCurrentOrg}
      />
    </main>
  );
}
