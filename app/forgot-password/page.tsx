'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  Mail,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ArrowLeft,
  Send,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { formatAuthError } from '@/lib/auth';

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSent(false);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setSubmitting(true);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(formatAuthError(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[75vh] py-10 px-4">
      <div className="w-full max-w-md mx-auto rounded-2xl bg-[#0A0A0A] border border-[#292929] p-6 sm:p-8 shadow-2xl space-y-6">
        <div className="space-y-1.5 text-center">
          <div className="w-10 h-10 rounded-xl bg-white text-black font-black text-base flex items-center justify-center mx-auto mb-3 shadow-md">
            AS
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Reset Your Password
          </h1>
          <p className="text-xs text-[#A0A0A0]">
            Enter the email address linked to your AniScroll account and we&apos;ll send a password reset link.
          </p>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-[#141414] border border-white/25 text-xs text-white flex items-start gap-2.5">
            <AlertCircle size={16} className="text-white shrink-0 mt-0.5" />
            <span className="leading-relaxed">{error}</span>
          </div>
        )}

        {sent && (
          <div className="p-3.5 rounded-xl bg-[#141414] border border-white/30 text-xs text-white flex items-start gap-2.5">
            <CheckCircle2 size={16} className="text-white shrink-0 mt-0.5" />
            <span className="leading-relaxed">
              Password reset link sent to <strong>{email}</strong>. Check your inbox and spam folder.
            </span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1.5">
            <label
              htmlFor="reset-email"
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
                id="reset-email"
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

          <button
            type="submit"
            disabled={submitting}
            className="w-full h-11 rounded-xl bg-white hover:bg-neutral-200 text-black font-semibold text-xs sm:text-sm flex items-center justify-center gap-2 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.99]"
          >
            {submitting ? (
              <>
                <Loader2 size={16} className="animate-spin text-black" />
                <span>Sending Reset Link...</span>
              </>
            ) : (
              <>
                <Send size={15} />
                <span>Send Reset Email</span>
              </>
            )}
          </button>
        </form>

        <div className="pt-2 border-t border-[#292929] text-center">
          <Link
            href="/login"
            className="inline-flex items-center gap-1.5 text-xs text-[#A0A0A0] hover:text-white transition-colors"
          >
            <ArrowLeft size={14} />
            <span>Back to Sign In</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
