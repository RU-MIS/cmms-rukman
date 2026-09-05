'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuthStore } from '@/store/authStore';

export default function ChangePasswordPage() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const mustChangePassword = useAuthStore((s) => s.user?.mustChangePassword);
  const setMustChangePassword = useAuthStore((s) => s.setMustChangePassword);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) return toast.error('New passwords do not match');
    setLoading(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      if (mustChangePassword) {
        setMustChangePassword(false);
        router.replace('/dashboard');
      }
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-md">
      <PageHeader
        title="Change Password"
        description={mustChangePassword ? 'For security, you must set a new password before continuing.' : 'Update your login password'}
      />
      <form onSubmit={handleSubmit} className="card p-5 space-y-4">
        <div>
          <label className="label">Current Password</label>
          <input type="password" className="input" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </div>
        <div>
          <label className="label">New Password</label>
          <input type="password" className="input" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={6} required />
        </div>
        <div>
          <label className="label">Confirm New Password</label>
          <input type="password" className="input" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={6} required />
        </div>
        <button className="btn-primary" disabled={loading}>
          Update Password
        </button>
      </form>
    </div>
  );
}
