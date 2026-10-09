'use client';

import React, { useState, useEffect } from 'react';
import {
  Users,
  Shield,
  UserPlus,
  Mail,
  X,
  Check,
  Building,
  Loader2,
  Trash2,
  Copy,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  UserCheck,
  Clock
} from 'lucide-react';
import {
  fetchTeamMembers,
  inviteTeamMember,
  updateTeamMemberRole,
  removeTeamMember,
  TeamMember,
} from '@/lib/api';

interface AuthAndTeamModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentOrg: string;
  onSwitchOrg: (org: string) => void;
  currentUserRole?: 'OWNER' | 'ADMIN' | 'DEVELOPER' | 'VIEWER';
}

export function AuthAndTeamModal({
  isOpen,
  onClose,
  currentOrg,
  onSwitchOrg,
  currentUserRole,
}: AuthAndTeamModalProps) {
  const [tab, setTab] = useState<'team' | 'invite' | 'auth'>('team');
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Determine current user permissions
  const currentUser = members.find((m) => m.isYou);
  const effectiveRole = currentUserRole || currentUser?.role;
  const canManageTeam = effectiveRole === 'OWNER' || effectiveRole === 'ADMIN';

  // Invite state
  const [inviteName, setInviteName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'ADMIN' | 'DEVELOPER' | 'VIEWER'>('DEVELOPER');
  const [isInviting, setIsInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{
    email: string;
    role: string;
    inviteToken: string;
    inviteLink: string;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Member management state
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [copiedMemberId, setCopiedMemberId] = useState<string | null>(null);

  // If a non-admin is on the invite tab, route back to team tab
  useEffect(() => {
    if (!canManageTeam && tab === 'invite') {
      setTab('team');
    }
  }, [canManageTeam, tab]);

  useEffect(() => {
    if (isOpen) {
      loadMembers();
      setActionError(null);
    }
  }, [isOpen]);

  async function loadMembers() {
    setIsLoading(true);
    setActionError(null);
    try {
      const data = await fetchTeamMembers();
      setMembers(data);
    } catch (err: any) {
      console.error('Failed to load team members:', err);
      setActionError(err.message || 'Failed to load team members');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleSendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail) return;

    setIsInviting(true);
    setActionError(null);

    try {
      const res = await inviteTeamMember({
        email: inviteEmail.trim(),
        role: inviteRole,
        name: inviteName.trim() || undefined,
      });

      const origin = typeof window !== 'undefined' ? window.location.origin : '';
      const inviteLink = `${origin}/invite?token=${res.inviteToken}`;

      setInviteResult({
        email: res.member.email,
        role: res.member.role,
        inviteToken: res.inviteToken,
        inviteLink,
      });

      // Refresh members list in background
      loadMembers();
    } catch (err: any) {
      setActionError(err.message || 'Failed to send invitation');
    } finally {
      setIsInviting(false);
    }
  }

  async function handleRoleChange(memberId: string, newRole: 'ADMIN' | 'DEVELOPER' | 'VIEWER') {
    setUpdatingId(memberId);
    setActionError(null);
    try {
      const updated = await updateTeamMemberRole(memberId, newRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === memberId ? { ...m, role: updated.role } : m))
      );
    } catch (err: any) {
      setActionError(err.message || 'Failed to update member role');
    } finally {
      setUpdatingId(null);
    }
  }

  async function handleRemoveMember(memberId: string, memberName: string) {
    if (!window.confirm(`Are you sure you want to remove ${memberName} from the workspace?`)) {
      return;
    }

    setRemovingId(memberId);
    setActionError(null);
    try {
      await removeTeamMember(memberId);
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err: any) {
      setActionError(err.message || 'Failed to remove member');
    } finally {
      setRemovingId(null);
    }
  }

  function copyToClipboard(text: string, memberId?: string) {
    if (!text) return;
    navigator.clipboard.writeText(text);
    if (memberId) {
      setCopiedMemberId(memberId);
      setTimeout(() => setCopiedMemberId(null), 2000);
    } else {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  }

  function resetInviteForm() {
    setInviteName('');
    setInviteEmail('');
    setInviteRole('DEVELOPER');
    setInviteResult(null);
    setCopiedLink(false);
    setActionError(null);
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-xl bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20 text-indigo-400">
              <Users className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-sm text-zinc-100">Team Workspaces & Access Control</h3>
              <p className="text-[11px] text-zinc-400">Manage team members, roles, and workspace access</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Controls */}
        <div className="px-5 pt-3 border-b border-zinc-800 flex items-center gap-4 text-xs bg-zinc-950">
          <button
            onClick={() => {
              setTab('team');
              setActionError(null);
            }}
            className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
              tab === 'team'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <span>Members</span>
            <span className="px-1.5 py-0.2 rounded-full bg-zinc-800 text-[10px] text-zinc-300">
              {members.length}
            </span>
          </button>
          {canManageTeam && (
            <button
              onClick={() => {
                setTab('invite');
                resetInviteForm();
              }}
              className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
                tab === 'invite'
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-zinc-400 hover:text-zinc-200'
              }`}
            >
              + Invite Colleague
            </button>
          )}
          <button
            onClick={() => {
              setTab('auth');
              setActionError(null);
            }}
            className={`pb-2.5 font-medium border-b-2 transition-colors cursor-pointer ${
              tab === 'auth'
                ? 'border-indigo-500 text-indigo-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Access & Security
          </button>
        </div>

        {/* Global Error Banner */}
        {actionError && (
          <div className="mx-5 mt-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="flex-1">{actionError}</span>
            <button
              onClick={() => setActionError(null)}
              className="text-zinc-400 hover:text-zinc-200 text-xs"
            >
              ×
            </button>
          </div>
        )}

        {/* Modal Body */}
        <div className="p-5">
          {/* TAB 1: Members List */}
          {tab === 'team' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-zinc-400 pb-2 border-b border-zinc-800/80">
                <div className="flex items-center gap-2">
                  <Building className="w-3.5 h-3.5 text-indigo-400" />
                  <span className="font-semibold text-zinc-200">{currentOrg}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={loadMembers}
                    disabled={isLoading}
                    title="Refresh members"
                    className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-800 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
                  </button>
                  {canManageTeam && (
                    <button
                      onClick={() => {
                        setTab('invite');
                        resetInviteForm();
                      }}
                      className="text-[11px] text-indigo-400 hover:text-indigo-300 font-medium transition-colors cursor-pointer"
                    >
                      + Invite
                    </button>
                  )}
                </div>
              </div>

              {isLoading && members.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center gap-2 text-zinc-500 text-xs">
                  <Loader2 className="w-5 h-5 animate-spin text-indigo-400" />
                  <span>Loading team members...</span>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {members.map((member) => {
                    const isPending = member.status === 'invited';
                    const origin = typeof window !== 'undefined' ? window.location.origin : '';
                    const inviteUrl = member.inviteToken ? `${origin}/invite?token=${member.inviteToken}` : '';

                    return (
                      <div
                        key={member.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-zinc-900/50 border border-zinc-800/80 hover:border-zinc-700/70 transition-all gap-3"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Avatar Initials Badge */}
                          <div
                            className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-xs shrink-0 border ${
                              member.isOwner
                                ? 'bg-amber-500/10 text-amber-300 border-amber-500/30'
                                : member.role === 'ADMIN'
                                ? 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30'
                                : member.role === 'DEVELOPER'
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : 'bg-zinc-800 text-zinc-300 border-zinc-700'
                            }`}
                          >
                            {member.avatarInitials || member.name.substring(0, 2).toUpperCase()}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="text-xs font-semibold text-zinc-100 truncate">
                                {member.name}
                              </span>
                              {member.isYou && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-medium">
                                  You
                                </span>
                              )}
                              {isPending && (
                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono flex items-center gap-1">
                                  <Clock className="w-2.5 h-2.5" /> Pending Invite
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-zinc-400 font-mono truncate">
                              {member.email}
                            </div>
                          </div>
                        </div>

                        {/* Actions & Role Badge */}
                        <div className="flex items-center gap-2 shrink-0">
                          {/* Copy invite link button for pending invites (Admin/Owner only) */}
                          {canManageTeam && isPending && inviteUrl && (
                            <button
                              onClick={() => copyToClipboard(inviteUrl, member.id)}
                              title="Copy invite link to share"
                              className="px-2 py-1 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-[11px] text-zinc-300 flex items-center gap-1 border border-zinc-700 transition-colors cursor-pointer"
                            >
                              {copiedMemberId === member.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-400" />
                                  <span className="text-emerald-400">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3 text-zinc-400" />
                                  <span>Copy Link</span>
                                </>
                              )}
                            </button>
                          )}

                          {/* Role selector / badge */}
                          {member.isOwner ? (
                            <span className="px-2 py-1 rounded-lg text-[10px] font-mono uppercase tracking-wider font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/30">
                              OWNER
                            </span>
                          ) : canManageTeam ? (
                            <div className="flex items-center gap-1">
                              <select
                                value={member.role}
                                disabled={updatingId === member.id || removingId === member.id}
                                onChange={(e) =>
                                  handleRoleChange(
                                    member.id,
                                    e.target.value as 'ADMIN' | 'DEVELOPER' | 'VIEWER'
                                  )
                                }
                                className={`text-[10px] font-mono uppercase font-semibold py-1 px-2 rounded-lg border focus:outline-none cursor-pointer transition-colors ${
                                  member.role === 'ADMIN'
                                    ? 'bg-indigo-950/40 text-indigo-300 border-indigo-500/30 focus:border-indigo-400'
                                    : member.role === 'DEVELOPER'
                                    ? 'bg-emerald-950/40 text-emerald-300 border-emerald-500/30 focus:border-emerald-400'
                                    : 'bg-zinc-900 text-zinc-300 border-zinc-700 focus:border-zinc-500'
                                }`}
                              >
                                <option value="ADMIN" className="bg-zinc-900 text-zinc-100">
                                  ADMIN
                                </option>
                                <option value="DEVELOPER" className="bg-zinc-900 text-zinc-100">
                                  DEVELOPER
                                </option>
                                <option value="VIEWER" className="bg-zinc-900 text-zinc-100">
                                  VIEWER
                                </option>
                              </select>

                              {/* Remove member button */}
                              <button
                                onClick={() => handleRemoveMember(member.id, member.name)}
                                disabled={updatingId === member.id || removingId === member.id}
                                title="Remove team member"
                                className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-md transition-colors cursor-pointer disabled:opacity-40"
                              >
                                {removingId === member.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider font-semibold border ${
                                member.role === 'ADMIN'
                                  ? 'bg-indigo-500/10 text-indigo-400 border-indigo-500/20'
                                  : member.role === 'DEVELOPER'
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                                  : 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20'
                              }`}
                            >
                              {member.role}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Empty state when only 1 member (the owner) */}
              {members.length === 1 && !isLoading && (
                <div className="p-4 rounded-xl border border-dashed border-zinc-800 bg-zinc-900/20 text-center space-y-2">
                  <p className="text-xs text-zinc-400">
                    No colleagues have been invited to this workspace yet.
                  </p>
                  {canManageTeam && (
                    <button
                      onClick={() => {
                        setTab('invite');
                        resetInviteForm();
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium transition-colors cursor-pointer shadow-sm"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Invite your first colleague</span>
                    </button>
                  )}
                </div>
              )}

              <div className="pt-2 text-[11px] text-zinc-500 font-mono border-t border-zinc-800/60 flex items-center gap-1.5">
                <span>💡</span>
                <span>
                  <strong>Admins:</strong> full control • <strong>Developers:</strong> deploy & config • <strong>Viewers:</strong> read-only.
                </span>
              </div>
            </div>
          )}

          {/* TAB 2: Invite Colleague */}
          {tab === 'invite' && (
            <div>
              {inviteResult ? (
                /* Success view with shareable invite link */
                <div className="space-y-4 animate-in fade-in duration-200">
                  <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-start gap-3">
                    <div className="p-1.5 bg-emerald-500/20 rounded-lg text-emerald-400 mt-0.5">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <div>
                      <h4 className="text-xs font-semibold text-emerald-300">
                        Invitation link generated!
                      </h4>
                      <p className="text-[11px] text-zinc-300 mt-0.5">
                        Colleague <strong className="font-mono text-emerald-200">{inviteResult.email}</strong> has been invited as{' '}
                        <strong className="font-mono text-emerald-200">{inviteResult.role}</strong>.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-xs font-medium text-zinc-300">
                      Shareable Invitation Link (Valid for 7 days)
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteResult.inviteLink}
                        className="w-full px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs font-mono text-zinc-200 focus:outline-none select-all"
                      />
                      <button
                        type="button"
                        onClick={() => copyToClipboard(inviteResult.inviteLink)}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-medium shrink-0 flex items-center gap-1.5 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
                      >
                        {copiedLink ? (
                          <>
                            <Check className="w-4 h-4 text-emerald-300" />
                            <span>Copied!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-4 h-4" />
                            <span>Copy Link</span>
                          </>
                        )}
                      </button>
                    </div>
                    <p className="text-[11px] text-zinc-500">
                      Share this link directly with your colleague. When they open it, they can configure their password and join your control plane.
                    </p>
                  </div>

                  <div className="pt-2 flex items-center justify-between border-t border-zinc-800">
                    <button
                      type="button"
                      onClick={() => setTab('team')}
                      className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    >
                      ← Back to Members
                    </button>
                    <button
                      type="button"
                      onClick={resetInviteForm}
                      className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs font-medium text-zinc-200 cursor-pointer transition-colors"
                    >
                      Invite Another Colleague
                    </button>
                  </div>
                </div>
              ) : (
                /* Invitation form */
                <form onSubmit={handleSendInvite} className="space-y-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Colleague's Work Email <span className="text-rose-400">*</span>
                    </label>
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
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Full Name <span className="text-zinc-500 font-normal">(Optional)</span>
                    </label>
                    <input
                      type="text"
                      value={inviteName}
                      onChange={(e) => setInviteName(e.target.value)}
                      placeholder="e.g. Sarah Connor"
                      className="w-full px-3.5 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                      Assigned Role
                    </label>
                    <div className="grid grid-cols-3 gap-2.5">
                      {(
                        [
                          {
                            id: 'ADMIN',
                            label: 'Admin',
                            desc: 'Full access to deploys, settings & members',
                          },
                          {
                            id: 'DEVELOPER',
                            label: 'Developer',
                            desc: 'Deploy services, manage env vars & DBs',
                          },
                          {
                            id: 'VIEWER',
                            label: 'Viewer',
                            desc: 'Read-only access to services & logs',
                          },
                        ] as const
                      ).map((r) => (
                        <button
                          key={r.id}
                          type="button"
                          onClick={() => setInviteRole(r.id)}
                          className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                            inviteRole === r.id
                              ? 'bg-indigo-600/15 border-indigo-500 text-indigo-300'
                              : 'bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                          }`}
                        >
                          <div className="flex items-center justify-between w-full mb-1">
                            <span className="font-semibold text-xs text-zinc-200">
                              {r.label}
                            </span>
                            {inviteRole === r.id && (
                              <Check className="w-3.5 h-3.5 text-indigo-400" />
                            )}
                          </div>
                          <span className="text-[10px] text-zinc-500 leading-tight">
                            {r.desc}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isInviting || !inviteEmail}
                    className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-lg shadow-indigo-600/20"
                  >
                    {isInviting ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        <span>Generating Invitation...</span>
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-4 h-4" />
                        <span>Send Team Invitation</span>
                      </>
                    )}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: Access & Security */}
          {tab === 'auth' && (
            <div className="space-y-4">
              <div className="p-3.5 bg-zinc-900/60 rounded-xl border border-zinc-800 text-xs space-y-2">
                <div className="font-semibold text-zinc-200 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-emerald-400" />
                  <span>Security & Access Control</span>
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">
                  Your control plane authenticates team members using scrypt-salted password cryptography and cryptographically randomized bearer tokens with automatic expiration.
                </p>
              </div>

              <div className="p-3.5 bg-zinc-900/40 rounded-xl border border-zinc-800/80 text-xs space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Workspace / Instance:</span>
                  <span className="font-semibold text-zinc-200">{currentOrg}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Total Registered Members:</span>
                  <span className="font-mono text-zinc-200">{members.length}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-zinc-400">Session Policy:</span>
                  <span className="text-emerald-400 font-mono text-[11px]">Active (30-day bearer session)</span>
                </div>
              </div>

              <div className="pt-2 text-[11px] text-zinc-500 font-mono">
                🔒 Team members added through invitations are securely stored in the control plane disk state.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
