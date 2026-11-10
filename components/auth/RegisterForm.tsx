'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { User, Mail, Lock, Loader2, AlertCircle, ArrowRight } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatAuthError } from '@/lib/auth';
import { GoogleSignInButton } from './GoogleSignInButton';

export function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get('redirect') || '/';

  const { signUpWithEmail } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSuccess = () => {
    router.push(redirectPath.startsWith('/') ? redirectPath : '/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!displayName.trim()) {
      setError('Please enter a display name.');
      return;
    }
    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await signUpWithEmail(displayName, email, password);
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
          Create Your Account
        </h1>
        <p className="text-xs text-[#A0A0A0]">
          Join AniScroll to back up your watchlist and resume episodes anywhere.
        </p>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-[#141414] border border-white/25 text-xs text-white flex items-start gap-2.5">
          <AlertCircle size={16} className="text-white shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <GoogleSignInButton
        label="Sign up with Google"
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
            htmlFor="register-name"
            className="block text-xs font-medium text-[#A0A0A0]"
          >
            Display Name
          </label>
          <div className="relative">
            <User
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              maxLength={120}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Anime Fan"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-white placeholder-[#666666] text-xs sm:text-sm focus:outline-none transition-colors"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="register-email"
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
              id="register-email"
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
          <label
            htmlFor="register-password"
            className="block text-xs font-medium text-[#A0A0A0]"
          >
            Password
          </label>
          <div className="relative">
            <Lock
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 6 characters"
              className="w-full h-11 pl-10 pr-4 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-white placeholder-[#666666] text-xs sm:text-sm focus:outline-none transition-colors"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="register-confirm-password"
            className="block text-xs font-medium text-[#A0A0A0]"
          >
            Confirm Password
          </label>
          <div className="relative">
            <Lock
              size={15}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#707070]"
            />
            <input
              id="register-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat password"
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
              <span>Creating Account...</span>
            </>
          ) : (
            <>
              <span>Create Account</span>
              <ArrowRight size={15} />
            </>
          )}
        </button>
      </form>

      <div className="pt-2 border-t border-[#292929] text-center text-xs text-[#A0A0A0]">
        Already have an account?{' '}
        <Link
          href={
            redirectPath !== '/'
              ? `/login?redirect=${encodeURIComponent(redirectPath)}`
              : '/login'
          }
          className="text-white font-semibold hover:underline"
        >
          Sign in
        </Link>
      </div>
    </div>
  );
}
