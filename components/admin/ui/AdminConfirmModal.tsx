'use client';

import React from 'react';
import { AlertTriangle, Loader2, X } from 'lucide-react';

interface AdminConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AdminConfirmModal({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive = false,
  loading = false,
  onConfirm,
  onCancel,
}: AdminConfirmModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="admin-confirm-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-[#0A0A0A] border border-[#292929] p-6 space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center border ${
                destructive
                  ? 'bg-red-500/10 border-red-500/30 text-red-400'
                  : 'bg-[#141414] border-[#292929] text-white'
              }`}
            >
              <AlertTriangle size={18} aria-hidden="true" />
            </div>
            <h2 id="admin-confirm-title" className="text-sm font-bold text-white">
              {title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="p-1.5 rounded-lg text-[#707070] hover:text-white hover:bg-[#141414]"
            aria-label="Close confirmation dialog"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-[#A0A0A0] leading-relaxed">{description}</p>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 text-xs font-medium text-white cursor-pointer disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50 ${
              destructive
                ? 'bg-red-600 hover:bg-red-500 text-white'
                : 'bg-white hover:bg-neutral-200 text-black'
            }`}
          >
            {loading && <Loader2 size={13} className="animate-spin" />}
            <span>{confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
