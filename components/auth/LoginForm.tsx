'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Lock, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatAuthError } from '@/lib/auth';
import { GoogleSignInButton } from './GoogleSignInButton';

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const { signInWithEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSuccess = () => {
    router.push(redirectPath.startsWith('/') ? redirectPath : '/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (!password) {
      setError('Please enter your password.');
      return;
    }

    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
      handleSuccess();
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-md mx-auto rounded-2xl bg-[#0A0A0A] border border-[#292929] p-6 sm:p-8 shadow-2xl space-y-6">
      <div className="space-y-1.5 text-center">
        <div className="w-10 h-10 rounded-xl bg-white text-black font-black text-base flex items-center justify-center mx-auto mb-3 shadow-md">
          AS
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Sign in to AniScroll
        </h1>
        <p className="text-xs text-[#A0A0A0]">
          Sync your watchlist, playback progress, and preferences across all devices.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-[#141414] border border-white/25 text-xs text-white flex items-start gap-2.5">
          <AlertCircle size={16} className="text-white shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <GoogleSignInButton
        label="Sign in with Google"
        onSuccess={handleSuccess}
        onError={(msg) => setError(msg)}
      />

      <div className="relative flex items-center justify-center">
        <div className="border-t border-[#292929] w-full" />
        <span className="bg-[#0A0A0A] px-3 text-[11px] uppercase tracking-wider text-[#707070] font-mono whitespace-nowrap shrink-0">
          or email
        </span>
        <div className="border-t border-[#292929] w-full" />
      </div>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label
            htmlFor="login-email"
            className="block text-xs font-medium text-[#A0A0A0]"
          >
            Email Address
          </label>
          <div className="relative">
            <Mail
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-white placeholder-[#666666] text-xs sm:text-sm focus:outline-none transition-colors"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label
              htmlFor="login-password"
              className="block text-xs font-medium text-[#A0A0A0]"
            >
              Password
            </label>
            <Link
              href="/forgot-password"
              className="text-xs text-[#A0A0A0] hover:text-white transition-colors"
            >
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-white placeholder-[#666666] text-xs sm:text-sm focus:outline-none transition-colors"
              required
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 text-black font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
        >
          {submitting ? (
            <>
              <Loader2 size={16} className="animate-spin text-black" />
              <span>Signing In...</span>
            </>
          ) : (
            <>
              <span>Sign In</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className="pt-2 border-t border-[#292929] text-center text-xs text-[#A0A0A0]">
        Don&apos;t have an account?{' '}
        <Link
          href={
            redirectPath !== '/'
              ? `/register?redirect=${encodeURIComponent(redirectPath)}`
              : '/register'
          }
          className="text-white font-semibold hover:underline"
        >
          Create account
        </Link>
      </div>
    </div>
  );
}
