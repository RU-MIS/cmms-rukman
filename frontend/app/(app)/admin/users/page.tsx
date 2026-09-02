'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Power, KeyRound } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { formatDate } from '@/lib/utils';

interface User { id: number; username: string; name: string; email?: string; role: { id: number; name: string }; active: boolean; lastLoginAt?: string }

export default function UsersPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ username: '', name: '', email: '', password: '', roleId: '' });
  const [resetFor, setResetFor] = useState<User | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ['users'], queryFn: async () => (await api.get('/users', { params: { pageSize: 50 } })).data });
  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get('/roles')).data.data });

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/users', { ...form, roleId: Number(form.roleId) });
      toast.success('User created');
      setModalOpen(false);
      setForm({ username: '', name: '', email: '', password: '', roleId: '' });
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function toggleActive(u: User) {
    try {
      await api.patch(`/users/${u.id}/toggle-active`);
      qc.invalidateQueries({ queryKey: ['users'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault();
    if (!resetFor) return;
    try {
      await api.post(`/users/${resetFor.id}/reset-password`, { newPassword });
      toast.success('Password reset');
      setResetFor(null);
      setNewPassword('');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<User>[] = [
    { key: 'name', header: 'Name', render: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-ink-muted">@{u.username}</p></div> },
    { key: 'email', header: 'Email' },
    { key: 'role', header: 'Role', render: (u) => u.role.name },
    { key: 'lastLoginAt', header: 'Last Login', render: (u) => (u.lastLoginAt ? formatDate(u.lastLoginAt) : 'Never') },
    { key: 'active', header: 'Status', render: (u) => <Badge status={u.active ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (u) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost !px-2 !py-1" onClick={() => setResetFor(u)}><KeyRound size={14} /></button>
          <button className="btn-ghost !px-2 !py-1" onClick={() => toggleActive(u)}><Power size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader title="Users" description="Manage employee logins and role assignment"
        actions={<button className="btn-primary" onClick={() => setModalOpen(true)}><Plus size={15} /> New User</button>} />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} />

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="New User" width="max-w-sm">
        <form onSubmit={handleCreate} className="space-y-3">
          <div><label className="label">Full Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Username *</label><input className="input" required value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Password *</label><input type="password" className="input" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div>
            <label className="label">Role *</label>
            <select className="input" required value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}>
              <option value="">Select role</option>
              {roles?.map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary">Create User</button>
          </div>
        </form>
      </Modal>

      <Modal open={!!resetFor} onClose={() => setResetFor(null)} title={`Reset Password — ${resetFor?.name ?? ''}`} width="max-w-sm">
        <form onSubmit={handleReset} className="space-y-3">
          <div><label className="label">New Password *</label><input type="password" className="input" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setResetFor(null)}>Cancel</button><button type="submit" className="btn-primary">Reset</button></div>
        </form>
      </Modal>
    </div>
  );
}
