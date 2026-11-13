'use client';

import React from 'react';
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Clock,
  Info,
  ShieldAlert,
} from 'lucide-react';

export type StatusTone = 'operational' | 'degraded' | 'outage' | 'pending' | 'info';

export function AdminStatusBadge({
  tone,
  label,
}: {
  tone: StatusTone;
  label: string;
}) {
  const config: Record<
    StatusTone,
    { classes: string; Icon: React.ComponentType<{ size?: number; className?: string }> }
  > = {
    operational: {
      classes: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
      Icon: CheckCircle2,
    },
    degraded: {
      classes: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
      Icon: AlertTriangle,
    },
    outage: {
      classes: 'bg-red-500/10 text-red-300 border-red-500/30',
      Icon: XCircle,
    },
    pending: {
      classes: 'bg-[#141414] text-neutral-300 border-[#333333]',
      Icon: Clock,
    },
    info: {
      classes: 'bg-white/10 text-white border-white/25',
      Icon: Info,
    },
  };

  const { classes, Icon } = config[tone] || config.info;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border font-mono text-[10px] font-semibold uppercase tracking-wider whitespace-nowrap ${classes}`}
    >
      <Icon size={11} className="shrink-0" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function SeverityBadge({
  severity,
}: {
  severity: 'info' | 'warning' | 'error' | 'critical' | string;
}) {
  if (severity === 'critical') {
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border bg-red-500/15 text-red-300 border-red-500/40 font-mono text-[10px] font-bold uppercase tracking-wider">
        <ShieldAlert size={11} aria-hidden="true" />
        <span>CRITICAL</span>
      </span>
    );
  }
  if (severity === 'error') {
    return <AdminStatusBadge tone="outage" label="ERROR" />;
  }
  if (severity === 'warning') {
    return <AdminStatusBadge tone="degraded" label="WARNING" />;
  }
  return <AdminStatusBadge tone="info" label="INFO" />;
}
