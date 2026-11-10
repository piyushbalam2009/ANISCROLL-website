'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Shield,
  Lock,
  Loader2,
  AlertOctagon,
  ArrowLeft,
  Mail,
  KeyRound,
  LogIn,
  Copy,
  Check,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { BOOTSTRAPPED_OWNER_EMAIL } from '@/lib/admin/admin-permissions';
import { AdminSidebar } from './AdminSidebar';
import { AdminHeader } from './AdminHeader';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const {
    user,
    adminRecord,
    isAdmin,
    loading,
    adminLoading,
    signInWithGoogle,
    signInWithEmail,
    signOutUser,
    refreshAdminRecord,
  } = useAuth();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setSubmitting(true);
    try {
      await signInWithEmail(email, password);
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Failed to sign in with email and password.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleLogin = async () => {
    setAuthError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
    } catch (err) {
      setAuthError(
        err instanceof Error ? err.message : 'Google authentication failed.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const copyUid = () => {
    if (!user?.uid) return;
    navigator.clipboard.writeText(user.uid);
    setCopiedUid(true);
    setTimeout(() => setCopiedUid(false), 2000);
  };

  // 1. Loading State
  if (loading || adminLoading) {
    return (
      <div className="min-h-screen bg-[#000000] text-white flex flex-col items-center justify-center p-6">
        <div className="w-12 h-12 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-center mb-4">
          <Loader2 size={22} className="animate-spin text-white" />
        </div>
        <div className="text-sm font-bold tracking-wide text-white uppercase font-mono">
          Verifying Administrator Credentials...
        </div>
        <div className="text-xs text-[#707070] mt-1">
          Checking Firebase Authentication & Firestore RBAC Registry
        </div>
      </div>
    );
  }

  // 2. Unauthenticated Gate -> Show Monochrome Admin Sign-In
  if (!user) {
    return (
      <div className="min-h-screen bg-[#000000] text-white flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md bg-[#0A0A0A] border border-[#292929] rounded-2xl p-6 sm:p-8 shadow-2xl space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white text-black flex items-center justify-center font-black text-sm">
                <Shield size={20} />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white tracking-tight">
                  AniScroll Admin Console
                </h1>
                <p className="text-xs text-[#A0A0A0]">
                  Three-tier RBAC & Artwork Control Plane
                </p>
              </div>
            </div>
            <Link
              href="/"
              className="text-xs text-[#A0A0A0] hover:text-white inline-flex items-center gap-1"
            >
              <ArrowLeft size={14} />
              <span>Site</span>
            </Link>
          </div>

          <div className="p-3.5 rounded-xl bg-[#141414] border border-[#292929] text-xs space-y-1">
            <div className="font-mono font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
              <Lock size={13} />
              <span>Authorized Personnel Only</span>
            </div>
            <p className="text-[#A0A0A0] leading-relaxed">
              Sign in with the primary Owner account (
              <span className="text-white font-mono">{BOOTSTRAPPED_OWNER_EMAIL}</span>)
              or an invited Administrator account.
            </p>
          </div>

          {authError && (
            <div className="p-3 rounded-lg bg-[#141414] border border-white/40 text-xs text-white">
              {authError}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2.5 py-3 px-4 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs sm:text-sm transition-all cursor-pointer disabled:opacity-50"
          >
            <LogIn size={16} />
            <span>Continue with Google (Recommended for Owner)</span>
          </button>

          <div className="relative flex py-1 items-center">
            <div className="flex-grow border-t border-[#292929]" />
            <span className="flex-shrink mx-3 text-[10px] font-mono uppercase tracking-widest text-[#707070]">
              Or Email Credentials
            </span>
            <div className="flex-grow border-t border-[#292929]" />
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-3.5">
            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Administrator Email
              </label>
              <div className="relative">
                <Mail size={15} className="absolute left-3.5 top-3 text-[#707070]" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="balampiyush2009@gmail.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#A0A0A0] mb-1.5">
                Password
              </label>
              <div className="relative">
                <KeyRound size={15} className="absolute left-3.5 top-3 text-[#707070]" />
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] focus:border-white text-xs sm:text-sm text-white placeholder-[#707070] focus:outline-none"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-xl bg-[#141414] border border-[#292929] hover:border-white text-white font-semibold text-xs sm:text-sm transition-all cursor-pointer disabled:opacity-50"
            >
              {submitting ? 'Authenticating...' : 'Sign In to Admin Console'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // 3. Authenticated but NOT an Administrator
  if (!isAdmin || !adminRecord) {
    return (
      <div className="min-h-screen bg-[#000000] text-white flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-[#0A0A0A] border border-[#292929] rounded-2xl p-6 sm:p-8 space-y-5">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#141414] border border-[#292929] flex items-center justify-center text-white">
              <AlertOctagon size={22} />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">
                Access Denied — Administrator Role Required
              </h1>
              <p className="text-xs text-[#A0A0A0]">
                Your account is signed in but is not registered in the `/admins` RBAC collection.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-[#141414] border border-[#292929] space-y-2.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-[#707070] font-mono uppercase">Signed-in Email:</span>
              <span className="text-white font-mono font-semibold">{user.email}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#707070] font-mono uppercase">Firebase UID:</span>
              <div className="flex items-center gap-1.5">
                <code className="text-white font-mono bg-black px-2 py-0.5 rounded border border-[#292929]">
                  {user.uid}
                </code>
                <button
                  type="button"
                  onClick={copyUid}
                  className="p-1 rounded bg-[#0A0A0A] border border-[#292929] text-[#A0A0A0] hover:text-white"
                  title="Copy UID"
                >
                  {copiedUid ? <Check size={12} /> : <Copy size={12} />}
                </button>
              </div>
            </div>
          </div>

          <div className="text-xs text-[#A0A0A0] space-y-1.5 leading-relaxed">
            <p>
              To gain Owner access, sign in with{' '}
              <span className="text-white font-mono">{BOOTSTRAPPED_OWNER_EMAIL}</span>,
              or ask the Owner to add your UID above in{' '}
              <span className="text-white font-mono">/admin/admins</span>, or set{' '}
              <span className="text-white font-mono">ADMIN_OWNER_UID={user.uid}</span> in
              the server environment variables.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => refreshAdminRecord()}
              className="px-4 py-2.5 rounded-xl bg-white text-black font-bold text-xs hover:bg-neutral-200 transition-colors cursor-pointer"
            >
              Re-check Permissions
            </button>
            <button
              type="button"
              onClick={() => signOutUser()}
              className="px-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 text-white font-medium text-xs transition-colors cursor-pointer"
            >
              Switch Account
            </button>
            <Link
              href="/"
              className="px-4 py-2.5 rounded-xl bg-[#141414] border border-[#292929] hover:border-white/40 text-[#A0A0A0] hover:text-white font-medium text-xs transition-colors"
            >
              Return to AniScroll
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 4. Authorized Admin Workspace
  return (
    <div className="min-h-screen bg-[#000000] text-white flex">
      <AdminSidebar
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <div className="flex-1 flex flex-col min-h-screen lg:pl-[264px] min-w-0">
        <AdminHeader onOpenMobile={() => setMobileOpen(true)} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-[1600px] w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
