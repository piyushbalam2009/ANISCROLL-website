'use client';

import React from 'react';
import Link from 'next/link';
import { LucideIcon } from 'lucide-react';

interface AdminKpiCardProps {
  label: string;
  value: string | number;
  sublabel?: string;
  icon: LucideIcon;
  href?: string;
  statusTone?: 'default' | 'good' | 'warn' | 'critical';
}

export function AdminKpiCard({
  label,
  value,
  sublabel,
  icon: Icon,
  href,
  statusTone = 'default',
}: AdminKpiCardProps) {
  const toneBorder =
    statusTone === 'critical'
      ? 'border-red-500/40'
      : statusTone === 'warn'
      ? 'border-amber-500/40'
      : 'border-[#292929]';

  const content = (
    <div
      className={`p-4 rounded-xl bg-[#0A0A0A] border ${toneBorder} ${
        href ? 'hover:border-white/50 transition-colors' : ''
      } h-full flex flex-col justify-between gap-2`}
    >
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono uppercase tracking-wider text-[#707070]">
        <span className="truncate">{label}</span>
        <Icon size={14} className="shrink-0 text-[#A0A0A0]" aria-hidden="true" />
      </div>
      <div>
        <div className="text-2xl font-bold text-white tabular-nums tracking-tight">
          {value}
        </div>
        {sublabel && (
          <div className="text-[11px] font-mono text-[#707070] mt-1 truncate">
            {sublabel}
          </div>
        )}
      </div>
    </div>
  );

  if (href) {
    return (
      <Link href={href} className="block h-full">
        {content}
      </Link>
    );
  }
  return content;
}
