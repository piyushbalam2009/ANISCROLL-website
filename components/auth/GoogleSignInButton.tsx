'use client';

import React, { useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatAuthError } from '@/lib/auth';

interface GoogleSignInButtonProps {
  onSuccess?: () => void;
  onError?: (message: string) => void;
  label?: string;
}

export function GoogleSignInButton({
  onSuccess,
  onError,
  label = 'Continue with Google',
}: GoogleSignInButtonProps) {
  const { signInWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);

  const handleGoogleClick = async () => {
    setLoading(true);
    try {
      await signInWithGoogle();
      onSuccess?.();
    } catch (err) {
      const msg = formatAuthError(err);
      onError?.(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleGoogleClick}
      disabled={loading}
      className="w-full h-11 px-4 rounded-xl bg-[#141414] hover:bg-[#1B1B1B] border border-[#292929] hover:border-white/40 text-white font-semibold text-xs sm:text-sm flex items-center justify-center gap-2.5 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
    >
      {loading ? (
        <Loader2 size={16} className="animate-spin text-white" />
      ) : (
        <Globe size={16} className="text-white" />
      )}
      <span>{loading ? 'Connecting to Google...' : label}</span>
    </button>
  );
}
