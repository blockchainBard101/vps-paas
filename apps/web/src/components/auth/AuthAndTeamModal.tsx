'use client';

import React, { useState } from 'react';
import {
  Users,
  Shield,
  UserPlus,
  Mail,
  Key,
  X,
  Check,
  Building,
  Sparkles
} from 'lucide-react';

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
  avatar: string;
}

interface AuthAndTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOrg: string;
  onSwitchOrg: (org: string) => void;
}

export function AuthAndTeamModal({
  isOpen,
  onClose,
  currentOrg,
  onSwitchOrg,
}: AuthAndTeamModalProps) {
  const [tab, setTab] = useState<'team' | 'invite' | 'auth'>('team');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'DEVELOPER' | 'VIEWER'>('DEVELOPER');
  const [inviteSuccess, setInviteSuccess] = useState(false);

  const [members, setMembers] = useState<TeamMember[]>([
    {
      id: 'm1',
      name: 'Alice Chen (You)',
      email: 'alice@acmecorp.com',
      role: 'OWNER',
      avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop',
    },
    {
      id: 'm2',
      name: 'Bob Smith',
      email: 'bob@acmecorp.com',
      role: 'ADMIN',
      avatar: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100&h=100&fit=crop',
    },
    {
      id: 'm3',
      name: 'Clara Diaz',
      email: 'clara@acmecorp.com',
      role: 'DEVELOPER',
      avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?w=100&h=100&fit=crop',
    },
    {
      id: 'm4',
      name: 'David Kim',
      email: 'david@acmecorp.com',
      role: 'VIEWER',
      avatar: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=100&h=100&fit=crop',
    },
  ]);

  if (!isOpen) return null;

  function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;

    const newMember: TeamMember = {
      id: `m-${Date.now()}`,
      name: inviteEmail.split('@')[0],
      email: inviteEmail,
      role: inviteRole,
      avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
    };

    setMembers([...members, newMember]);
    setInviteSuccess(true);
    setTimeout(() => {
      setInviteSuccess(false);
      setInviteEmail('');
      setTab('team');
    }, 1500);
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-500/10 rounded-lg border border-indigo-500/20">
              <Users className="w-4 h-4 text-indigo-400" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-zinc-100">Team Workspaces & Access Control</h3>
              <p className="text-[11px] text-zinc-400">Manage colleagues, roles and organization access</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-5 pt-3 border-b border-zinc-800 flex items-center gap-4 text-xs">
          <button
            onClick={() => setTab('team')}
            className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
              tab === 'team'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Members ({members.length})
          </button>
          <button
            onClick={() => setTab('invite')}
            className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
              tab === 'invite'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            + Invite Colleague
          </button>
          <button
            onClick={() => setTab('auth')}
            className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
              tab === 'auth'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Browser Login Settings
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5">
          {tab === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400 pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <Building className="w-3.5 h-3.5 text-zinc-500" />
                  <span className="font-semibold text-zinc-200">{currentOrg}</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onSwitchOrg(currentOrg === 'Acme Corp' ? 'Personal Workspace' : 'Acme Corp')}
                    className="text-[11px] text-indigo-400 hover:underline cursor-pointer"
                  >
                    Switch Workspace
                  </button>
                </div>
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-zinc-900/40 border border-zinc-800/70"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={member.avatar}
                        alt={member.name}
                        className="w-8 h-8 rounded-full border border-zinc-700 object-cover"
                      />
                      <div>
                        <div className="text-xs font-medium text-zinc-200">{member.name}</div>
                        <div className="text-[10px] text-zinc-500 font-mono">{member.email}</div>
                      </div>
                    </div>

                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${
                        member.role === 'OWNER'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : member.role === 'ADMIN'
                          ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                          : member.role === 'DEVELOPER'
                          ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                          : 'bg-zinc-500/10 text-zinc-400 border border-zinc-500/20'
                      }`}
                    >
                      {member.role}
                    </span>
                  </div>
                ))}
              </div>

              <div className="pt-2 text-[11px] text-zinc-500 font-mono">
                💡 Viewers have read-only access to the Neon Studio and cannot execute DROP or cell edits.
              </div>
            </div>
          )}

          {tab === 'invite' && (
            <form onSubmit={handleSendInvite} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Colleague's Work Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="teammate@company.com"
                    className="w-full pl-9 pr-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">Assigned Role</label>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  {(['ADMIN', 'DEVELOPER', 'VIEWER'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setInviteRole(r)}
                      className={`p-2 rounded-lg border text-center transition-all cursor-pointer ${
                        inviteRole === r
                          ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300 font-semibold'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
              >
                {inviteSuccess ? <Check className="w-4 h-4 text-emerald-400" /> : <UserPlus className="w-4 h-4" />}
                <span>{inviteSuccess ? 'Invite Token Generated!' : 'Send Team Invitation'}</span>
              </button>
            </form>
          )}

          {tab === 'auth' && (
            <div className="space-y-4">
              <div className="p-3 bg-zinc-900/60 rounded-xl border border-zinc-800 text-xs space-y-2">
                <div className="font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Configured Auth Methods</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  Your server is configured with 1-Click GitHub OAuth and Argon2id hashed email authentication.
                </p>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  className="w-full py-2.5 px-4 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-200 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                  </svg>
                  <span>Sign In with GitHub (Auto-detect repos)</span>
                </button>

                <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800/80 text-[11px] text-zinc-500 font-mono">
                  <span>Session Type: </span>
                  <span className="text-zinc-300">HttpOnly Encrypted JWT (7 Days)</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
