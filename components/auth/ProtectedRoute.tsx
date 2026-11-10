'use client';

import React, { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?redirect=${encodeURIComponent(pathname || '/')}`);
    }
  }, [user, loading, router, pathname]);

  if (loading || !user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] text-center space-y-3">
        <Loader2 size={28} className="animate-spin text-white" />
        <p className="text-xs text-[#A0A0A0] font-mono uppercase tracking-wider">
          Verifying session...
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
