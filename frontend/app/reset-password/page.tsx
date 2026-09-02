'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Boxes, Loader2, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error('Passwords do not match');
    if (!token) return toast.error('Missing or invalid reset link');
    setLoading(true);
    try {
      await api.post('/auth/reset-password', { token, newPassword });
      setDone(true);
      setTimeout(() => router.push('/login'), 2500);
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
          <h1 className="text-lg font-semibold text-ink">Set a New Password</h1>
        </div>

        {done ? (
          <div className="card p-5 text-center space-y-2">
            <CheckCircle2 size={28} className="text-success mx-auto" />
            <p className="text-sm text-ink">Password updated. Redirecting to login…</p>
          </div>
        ) : !token ? (
          <div className="card p-5 text-center space-y-3">
            <p className="text-sm text-danger">This reset link is missing its token. Please request a new one.</p>
            <Link href="/forgot-password" className="btn-primary w-full justify-center">Request New Link</Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-5 space-y-4">
            <div>
              <label className="label">New Password</label>
              <input type="password" className="input" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoFocus />
            </div>
            <div>
              <label className="label">Confirm New Password</label>
              <input type="password" className="input" required minLength={6} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading && <Loader2 size={15} className="animate-spin" />}
              Update Password
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
