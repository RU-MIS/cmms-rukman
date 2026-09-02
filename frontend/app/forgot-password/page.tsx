'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Boxes, Loader2, ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.post('/auth/forgot-password', { email });
      setSent(true);
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg px-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center mb-3">
            <Boxes size={24} className="text-white" />
          </div>
          <h1 className="text-lg font-semibold text-ink">Forgot Password</h1>
          <p className="text-sm text-ink-muted text-center">Enter your account email and we&apos;ll send you a reset link</p>
        </div>

        {sent ? (
          <div className="card p-5 text-center space-y-3">
            <p className="text-sm text-ink">
              If <b>{email}</b> is registered, a password reset link has been sent. Check your inbox (and spam folder) — the link is valid for 1 hour.
            </p>
            <Link href="/login" className="btn-secondary w-full justify-center"><ArrowLeft size={15} /> Back to Login</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-5 space-y-4">
            <div>
              <label className="label">Account Email</label>
              <input type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading && <Loader2 size={15} className="animate-spin" />}
              Send Reset Link
            </button>
            <Link href="/login" className="flex items-center justify-center gap-1 text-xs text-ink-muted hover:text-ink"><ArrowLeft size={13} /> Back to Login</Link>
          </form>
        )}
      </div>
    </div>
  );
}
