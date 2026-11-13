'use client';

import React from 'react';
import { Crown, Shield, ShieldCheck, User } from 'lucide-react';
import { ROLE_DEFINITIONS, UserRole, normalizeUserRole } from '@/lib/roles';

interface RoleBadgeProps {
  role?: UserRole | string | null;
  size?: 'xs' | 'sm' | 'md';
  showIcon?: boolean;
  hideMember?: boolean;
  className?: string;
}

const ROLE_STYLES: Record<UserRole, string> = {
  owner: 'bg-white text-black border border-white font-bold shadow-sm',
  admin: 'bg-[#1D1D1D] text-white border border-white/60 font-semibold',
  mod: 'bg-[#141414] text-[#E5E5E5] border border-white/30 font-semibold',
  member: 'bg-[#0F0F0F] text-[#A0A0A0] border border-[#292929] font-medium',
};

const SIZE_CLASSES: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'px-1.5 py-0.5 text-[9px] gap-1',
  sm: 'px-2 py-0.5 text-[10px] gap-1',
  md: 'px-2.5 py-1 text-[11px] gap-1.5',
};

const ICON_SIZES: Record<'xs' | 'sm' | 'md', number> = {
  xs: 10,
  sm: 11,
  md: 12,
};

export function RoleBadge({
  role,
  size = 'sm',
  showIcon = true,
  hideMember = false,
  className = '',
}: RoleBadgeProps) {
  const normalized = normalizeUserRole(role);
  if (hideMember && normalized === 'member') {
    return null;
  }

  const meta = ROLE_DEFINITIONS[normalized];
  const iconSize = ICON_SIZES[size];

  const renderIcon = () => {
    if (!showIcon) return null;
    switch (normalized) {
      case 'owner':
        return <Crown size={iconSize} className="shrink-0" aria-hidden="true" />;
      case 'admin':
        return <ShieldCheck size={iconSize} className="shrink-0" aria-hidden="true" />;
      case 'mod':
        return <Shield size={iconSize} className="shrink-0" aria-hidden="true" />;
      case 'member':
      default:
        return <User size={iconSize} className="shrink-0" aria-hidden="true" />;
    }
  };

  return (
    <span
      className={`inline-flex items-center rounded-md font-mono uppercase tracking-wider leading-none whitespace-nowrap select-none ${ROLE_STYLES[normalized]} ${SIZE_CLASSES[size]} ${className}`}
      title={`${meta.label} — ${meta.description}`}
    >
      {renderIcon()}
      <span>{meta.label}</span>
    </span>
  );
}
