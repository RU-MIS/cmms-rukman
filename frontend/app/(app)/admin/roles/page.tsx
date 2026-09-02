'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Save } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { Modal } from '@/components/ui/Modal';

const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'print'];

export default function RolesPage() {
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [grants, setGrants] = useState<Set<number>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data: roles } = useQuery({ queryKey: ['roles'], queryFn: async () => (await api.get('/roles')).data.data });
  const { data: catalog } = useQuery({ queryKey: ['permission-catalog'], queryFn: async () => (await api.get('/roles/permissions/catalog')).data.data });

  const selectedRole = roles?.find((r: any) => r.id === selectedRoleId);

  useEffect(() => {
    if (selectedRole) setGrants(new Set(selectedRole.permissions.map((p: any) => p.permissionId)));
  }, [selectedRole]);

  const modules: string[] = catalog ? Array.from(new Set(catalog.map((c: any) => c.module))) : [];

  function permId(module: string, action: string) {
    return catalog?.find((c: any) => c.module === module && c.action === action)?.id;
  }

  function toggle(module: string, action: string) {
    const id = permId(module, action);
    if (!id) return;
    setGrants((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleSaveGrants() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await api.put(`/roles/${selectedRoleId}/permissions`, { permissionIds: Array.from(grants) });
      toast.success('Permissions updated');
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRole(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/roles', { name: newRoleName });
      toast.success('Role created');
      setCreateOpen(false);
      setNewRoleName('');
      qc.invalidateQueries({ queryKey: ['roles'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  return (
    <div>
      <PageHeader title="Roles & Permissions" description="Control what each role can view, create, edit, delete, export and print"
        actions={<button className="btn-primary" onClick={() => setCreateOpen(true)}><Plus size={15} /> New Role</button>} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-2 space-y-0.5 h-fit">
          {roles?.map((r: any) => (
            <button
              key={r.id}
              onClick={() => setSelectedRoleId(r.id)}
              className={`w-full text-left px-3 py-2 rounded text-sm ${selectedRoleId === r.id ? 'bg-brand-600 text-white' : 'hover:bg-brand-50 text-ink'}`}
            >
              {r.name} <span className="text-xs opacity-70">({r._count.users})</span>
            </button>
          ))}
        </div>

        <div className="md:col-span-3">
          {!selectedRole && <p className="text-sm text-ink-muted">Select a role to view or edit its permissions.</p>}
          {selectedRole && (
            <div className="card overflow-hidden">
              <div className="flex items-center justify-between p-3 border-b border-card-border">
                <h3 className="text-sm font-semibold text-ink">{selectedRole.name}{selectedRole.isSystem ? ' (Admin has full access by default)' : ''}</h3>
                {!selectedRole.isSystem || selectedRole.name !== 'Admin' ? (
                  <button className="btn-primary !py-1.5" onClick={handleSaveGrants} disabled={saving}><Save size={14} /> Save</button>
                ) : null}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[500px]">
                  <thead>
                    <tr>
                      <th className="th">Module</th>
                      {ACTIONS.map((a) => <th key={a} className="th text-center capitalize">{a}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {modules.map((m) => (
                      <tr key={m}>
                        <td className="td capitalize">{m.replace(/_/g, ' ')}</td>
                        {ACTIONS.map((a) => {
                          const id = permId(m, a);
                          return (
                            <td key={a} className="td text-center">
                              {id && (
                                <input
                                  type="checkbox"
                                  disabled={selectedRole.name === 'Admin'}
                                  checked={selectedRole.name === 'Admin' || grants.has(id)}
                                  onChange={() => toggle(m, a)}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Role" width="max-w-sm">
        <form onSubmit={handleCreateRole} className="space-y-3">
          <div><label className="label">Role Name *</label><input className="input" required value={newRoleName} onChange={(e) => setNewRoleName(e.target.value)} /></div>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button><button type="submit" className="btn-primary">Create</button></div>
        </form>
      </Modal>
    </div>
  );
}
