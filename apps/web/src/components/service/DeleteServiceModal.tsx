'use client';

import React, { useState } from 'react';
import { AlertTriangle, Trash2, X, Loader2, ShieldAlert, Box } from 'lucide-react';

interface DeleteServiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  serviceName: string;
  serviceId: string;
  image?: string;
  isDeleting?: boolean;
}

export function DeleteServiceModal({
  isOpen,
  onClose,
  onConfirm,
  serviceName,
  serviceId,
  image,
  isDeleting = false,
}: DeleteServiceModalProps) {
  const [confirmInput, setConfirmInput] = useState('');
  const isMatch = confirmInput.trim().toLowerCase() === serviceName.trim().toLowerCase();

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
                <span>Delete Service</span>
                {image && (
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 font-mono inline-flex items-center gap-1.5">
                    <Box className="w-3.5 h-3.5 text-zinc-400" />
                    <span className="truncate max-w-[120px]">{image}</span>
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                This action is permanent and cannot be undone
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
              <span>Warning: Destructive Operation</span>
            </div>
            <p className="leading-relaxed text-[11px] text-zinc-300">
              You are about to delete service <strong className="text-white font-mono">{serviceName}</strong>{' '}
              <span className="text-zinc-500">({serviceId})</span>.
            </p>
            <ul className="list-disc list-inside space-y-1 text-[11px] text-zinc-400 pl-1">
              <li>Docker container will be forcefully terminated and purged from the host</li>
              <li>Reverse proxy routes and domain bindings will be immediately decommissioned</li>
              <li>Canvas connections and environment variables tied to this service will be deleted</li>
            </ul>
          </div>

          {/* Verification Input */}
          <div className="space-y-2 pt-1">
            <label className="block text-xs text-zinc-300">
              To confirm deletion, type <strong className="text-red-400 font-mono select-all">{serviceName}</strong> below:
            </label>
            <input
              type="text"
              autoFocus
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              placeholder={`Type "${serviceName}" to confirm`}
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
                <span>Deleting Service...</span>
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4" />
                <span>Delete Service</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
