'use client';

import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2, ShieldAlert, FolderMinus } from 'lucide-react';

interface DeleteProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  projectName: string;
  projectId: string;
  isDeleting?: boolean;
}

export function DeleteProjectModal({
  isOpen,
  onClose,
  onConfirm,
  projectName,
  projectId,
  isDeleting = false,
}: DeleteProjectModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const isMatch = confirmInput.trim().toLowerCase() === projectName.trim().toLowerCase();

  if (!isOpen) return null;

  async function handleDelete() {
    if (!isMatch && confirmInput.trim().length > 0) return;
    await onConfirm();
  }

  function handleClose() {
    if (isDeleting) return;
    setConfirmInput('');
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-lg bg-zinc-950 border border-zinc-800/90 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 text-zinc-100 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header */}
        <div className="p-6 border-b border-zinc-800/80 bg-red-950/15 flex items-start justify-between relative overflow-hidden">
          <div className="absolute top-0 right-0 w-48 h-48 bg-red-500/5 rounded-full blur-3xl pointer-events-none" />

          <div className="flex items-center gap-3.5 relative z-10">
            <div className="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base text-zinc-100 flex items-center gap-2">
                <span>Delete Project</span>
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 font-mono inline-flex items-center gap-1.5">
                  <FolderMinus className="w-3.5 h-3.5 text-zinc-400" />
                  <span className="truncate max-w-[120px]">{projectName}</span>
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                This will delete the project and all attached services
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            disabled={isDeleting}
            className="p-1.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-xs">
          <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-950/20 text-red-200/90 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-red-300">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>Warning: Irreversible Action</span>
            </div>
            <p className="leading-relaxed text-[11px] text-zinc-300">
              You are about to delete project <strong className="text-white font-mono">{projectName}</strong>{' '}
              <span className="text-zinc-500">({projectId})</span>.
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-zinc-400 pl-1">
              <li>All containers, databases, and microservices in this project will be deleted</li>
              <li>Network routes, canvas layouts, and environment variables will be dropped</li>
              <li>Any persistent storage volumes associated with this project will be removed</li>
            </ul>
          </div>

          {/* Verification Input */}
          <div className="space-y-2 pt-1">
            <label className="block text-xs text-zinc-300">
              To confirm deletion, type <strong className="text-red-400 font-mono select-all">{projectName}</strong> below:
            </label>
            <input
              type="text"
              autoFocus
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${projectName}" to confirm`}
              className="w-full px-3.5 py-2.5 bg-zinc-900 border border-zinc-800 rounded-xl text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-red-500 transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isMatch && !isDeleting) {
                  handleDelete();
                }
              }}
            />
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-zinc-800/80 bg-zinc-900/40 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={handleClose}
            disabled={isDeleting}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700/80 text-zinc-300 hover:text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDelete}
            disabled={isDeleting || !isMatch}
            className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-lg shadow-red-600/20 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isDeleting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Deleting Project...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete Project</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
