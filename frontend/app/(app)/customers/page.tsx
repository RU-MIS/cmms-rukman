'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Pencil, Power, FileDown } from 'lucide-react';
import { api, apiErrorMessage } from '@/lib/api';
import { openFile } from '@/lib/files';
import { useDebouncedValue } from '@/lib/hooks';
import { PageHeader } from '@/components/ui/PageHeader';
import { SearchInput } from '@/components/ui/SearchInput';
import { DataTable, Column } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { GstinInput } from '@/components/forms/GstinInput';
import { formatCurrency } from '@/lib/utils';

interface Customer {
  id: number;
  code: string;
  name: string;
  companyName?: string;
  mobile?: string;
  email?: string;
  city?: string;
  gstin?: string;
  openingBalance: string;
  creditLimit: string;
  active: boolean;
}

const emptyForm = {
  name: '', companyName: '', mobile: '', altMobile: '', email: '',
  address: '', addressLine2: '', city: '', state: '', pincode: '', country: '', gstin: '',
  shipAddressLine1: '', shipAddressLine2: '', shipCity: '', shipState: '', shipPincode: '', shipCountry: '', shipGstin: '',
  openingBalance: 0, creditLimit: 0,
  paymentTerms: '', notes: '',
};

const BILL_TO_SHIP_TO_MAP: Record<string, string> = {
  address: 'shipAddressLine1',
  addressLine2: 'shipAddressLine2',
  city: 'shipCity',
  state: 'shipState',
  pincode: 'shipPincode',
  country: 'shipCountry',
  gstin: 'shipGstin',
};

/** True when every Ship To field is blank, or exactly mirrors Bill To -- the
 * "effectively same as billing" state the checkbox should default to. */
function isSameAsBilling(form: any): boolean {
  return Object.entries(BILL_TO_SHIP_TO_MAP).every(([billKey, shipKey]) => {
    const shipVal = form[shipKey] ?? '';
    if (!shipVal) return true;
    return shipVal === (form[billKey] ?? '');
  });
}

export default function CustomersPage() {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState<any>(emptyForm);
  const [sameAsBilling, setSameAsBilling] = useState(true);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['customers', debouncedSearch, page],
    queryFn: async () => (await api.get('/customers', { params: { search: debouncedSearch, page, pageSize: 20 } })).data,
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setSameAsBilling(true);
    setModalOpen(true);
  }
  function openEdit(c: Customer) {
    setEditing(c);
    const merged = { ...emptyForm, ...c };
    setForm(merged);
    setSameAsBilling(isSameAsBilling(merged));
    setModalOpen(true);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      // "Same as Bill To" copies Bill To values into Ship To at save time,
      // so every downstream consumer (invoice PDF, sale/purchase creation)
      // always gets real, usable Ship To data -- never a blank fallback.
      const payload = sameAsBilling
        ? Object.entries(BILL_TO_SHIP_TO_MAP).reduce((acc, [billKey, shipKey]) => ({ ...acc, [shipKey]: form[billKey] }), { ...form })
        : form;
      if (editing) {
        await api.put(`/customers/${editing.id}`, payload);
        toast.success('Customer updated');
      } else {
        await api.post('/customers', payload);
        toast.success('Customer created');
      }
      setModalOpen(false);
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(c: Customer) {
    try {
      await api.patch(`/customers/${c.id}/toggle-active`);
      qc.invalidateQueries({ queryKey: ['customers'] });
    } catch (err) {
      toast.error(apiErrorMessage(err));
    }
  }

  const columns: Column<Customer>[] = [
    { key: 'code', header: 'Code' },
    { key: 'name', header: 'Name', render: (c) => <div><p className="font-medium">{c.name}</p>{c.companyName && <p className="text-xs text-ink-muted">{c.companyName}</p>}</div> },
    { key: 'mobile', header: 'Mobile' },
    { key: 'city', header: 'City' },
    { key: 'openingBalance', header: 'Opening Bal.', align: 'right', render: (c) => formatCurrency(c.openingBalance) },
    { key: 'active', header: 'Status', render: (c) => <Badge status={c.active ? 'ACTIVE' : 'INACTIVE'} /> },
    {
      key: 'actions', header: '', align: 'right',
      render: (c) => (
        <div className="flex justify-end gap-1">
          <button className="btn-ghost !px-2 !py-1" onClick={() => openEdit(c)}><Pencil size={14} /></button>
          <button className="btn-ghost !px-2 !py-1" onClick={() => toggleActive(c)}><Power size={14} /></button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="Customers"
        description="Manage your customer master data"
        actions={
          <>
            <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search customers…" />
            <button className="btn-secondary" onClick={() => openFile('/documents/list/customers')}><FileDown size={15} /> Download PDF</button>
            <button className="btn-primary" onClick={openCreate}><Plus size={15} /> New Customer</button>
          </>
        }
      />
      <DataTable columns={columns} rows={data?.data ?? []} loading={isLoading} onRowClick={openEdit} />
      {data?.meta && <Pagination page={data.meta.page} totalPages={data.meta.totalPages} total={data.meta.total} pageSize={data.meta.pageSize} onPageChange={setPage} />}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Customer' : 'New Customer'} width="max-w-3xl">
        <form onSubmit={handleSave} className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="label">Name *</label><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div><label className="label">Company Name</label><input className="input" value={form.companyName ?? ''} onChange={(e) => setForm({ ...form, companyName: e.target.value })} /></div>
          <div><label className="label">Mobile</label><input className="input" value={form.mobile ?? ''} onChange={(e) => setForm({ ...form, mobile: e.target.value })} /></div>
          <div><label className="label">Alternate Mobile</label><input className="input" value={form.altMobile ?? ''} onChange={(e) => setForm({ ...form, altMobile: e.target.value })} /></div>
          <div><label className="label">Email</label><input type="email" className="input" value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>

          <div className="col-span-2 pt-2 border-t border-card-border">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">Bill To Address</p>
          </div>
          <div className="col-span-2"><label className="label">Address Line 1</label><input className="input" value={form.address ?? ''} onChange={(e) => setForm({ ...form, address: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Address Line 2</label><input className="input" value={form.addressLine2 ?? ''} onChange={(e) => setForm({ ...form, addressLine2: e.target.value })} /></div>
          <div><label className="label">City</label><input className="input" value={form.city ?? ''} onChange={(e) => setForm({ ...form, city: e.target.value })} /></div>
          <div><label className="label">State</label><input className="input" value={form.state ?? ''} onChange={(e) => setForm({ ...form, state: e.target.value })} /></div>
          <div><label className="label">Pincode</label><input className="input" value={form.pincode ?? ''} onChange={(e) => setForm({ ...form, pincode: e.target.value })} /></div>
          <div><label className="label">Country</label><input className="input" value={form.country ?? ''} onChange={(e) => setForm({ ...form, country: e.target.value })} /></div>
          <div className="col-span-2"><GstinInput label="Bill To GSTIN" value={form.gstin} onChange={(v) => setForm({ ...form, gstin: v })} /></div>

          <div className="col-span-2 pt-2 border-t border-card-border flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Ship To Address</p>
            <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={sameAsBilling}
                onChange={(e) => setSameAsBilling(e.target.checked)}
              />
              Same as Bill To
            </label>
          </div>
          <div className="col-span-2">
            <label className="label">Address Line 1</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.address : form.shipAddressLine1) ?? ''} onChange={(e) => setForm({ ...form, shipAddressLine1: e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label">Address Line 2</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.addressLine2 : form.shipAddressLine2) ?? ''} onChange={(e) => setForm({ ...form, shipAddressLine2: e.target.value })} />
          </div>
          <div>
            <label className="label">City</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.city : form.shipCity) ?? ''} onChange={(e) => setForm({ ...form, shipCity: e.target.value })} />
          </div>
          <div>
            <label className="label">State</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.state : form.shipState) ?? ''} onChange={(e) => setForm({ ...form, shipState: e.target.value })} />
          </div>
          <div>
            <label className="label">Pincode</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.pincode : form.shipPincode) ?? ''} onChange={(e) => setForm({ ...form, shipPincode: e.target.value })} />
          </div>
          <div>
            <label className="label">Country</label>
            <input className="input" disabled={sameAsBilling} value={(sameAsBilling ? form.country : form.shipCountry) ?? ''} onChange={(e) => setForm({ ...form, shipCountry: e.target.value })} />
          </div>
          <div className="col-span-2">
            <GstinInput label="Ship To GSTIN" disabled={sameAsBilling} value={(sameAsBilling ? form.gstin : form.shipGstin) ?? ''} onChange={(v) => setForm({ ...form, shipGstin: v })} />
          </div>

          <div className="col-span-2 pt-2 border-t border-card-border" />
          <div><label className="label">Opening Balance</label><input type="number" step="0.01" className="input" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} /></div>
          <div><label className="label">Credit Limit</label><input type="number" step="0.01" className="input" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} /></div>
          <div><label className="label">Payment Terms</label><input className="input" value={form.paymentTerms ?? ''} onChange={(e) => setForm({ ...form, paymentTerms: e.target.value })} /></div>
          <div className="col-span-2"><label className="label">Notes</label><textarea className="input" rows={2} value={form.notes ?? ''} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          <div className="col-span-2 flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary" onClick={() => setModalOpen(false)}>Cancel</button>
            <button type="submit" disabled={saving} className="btn-primary">{editing ? 'Save Changes' : 'Create Customer'}</button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
