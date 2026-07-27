'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, ClipboardCheck, ChevronRight, Trash2, GripVertical, Image, X } from 'lucide-react';
import api from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

const FREQUENCIES = ['Daily','10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand'];
const INPUT_TYPES  = ['Checkbox','PassFail','YesNo','Dropdown','Text','Number','Decimal','Temperature','Pressure','Date','Time','Photo','Remarks'];
const PHOTO_FREQS  = ['10-Day','15-Day','Weekly','Monthly','Quarterly','Half-Yearly','Yearly','On-Demand'];

// ── Template detail / item builder ────────────────────────────────
function TemplateBuilder({ templateId, onClose }: { templateId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [newItem, setNewItem] = useState({ itemText: '', inputType: 'PassFail', isMandatory: true, unit: '', dropdownOptions: '' });

  const { data: template, isLoading } = useQuery({
    queryKey: ['template-detail', templateId],
    queryFn: () => api.get(`/checklists/${templateId}`).then(r => r.data.data),
  });

  const addItemMutation = useMutation({
    mutationFn: () => api.post(`/checklists/${templateId}/items`, {
      ...newItem,
      dropdownOptions: newItem.dropdownOptions ? newItem.dropdownOptions.split(',').map(s => s.trim()) : undefined,
    }),
    onSuccess: () => {
      toast.success('Item added');
      qc.invalidateQueries({ queryKey: ['template-detail', templateId] });
      setNewItem({ itemText: '', inputType: 'PassFail', isMandatory: true, unit: '', dropdownOptions: '' });
    },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/checklists/${templateId}/items/${itemId}`),
    onSuccess: () => { toast.success('Item removed'); qc.invalidateQueries({ queryKey: ['template-detail', templateId] }); },
  });

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full sm:max-w-2xl sm:rounded-xl rounded-t-xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between p-5 border-b border-[#D4E4F7] flex-shrink-0">
          <div>
            <h2 className="text-base font-semibold text-[#0A1F4E]">{template?.templateName || 'Loading...'}</h2>
            <div className="flex items-center gap-2 mt-1">
              {template && (
                <>
                  <span className="text-xs bg-[#EFF6FF] text-[#0E2F76] font-medium px-2 py-0.5 rounded-full">{template.frequency}</span>
                  <span className="text-xs text-[#7A9CC0]">{template.deptName}</span>
                  {template.hasPhoto && <span className="text-xs bg-amber-50 text-amber-700 font-medium px-2 py-0.5 rounded-full flex items-center gap-1"><Image className="w-3 h-3" />Photo required</span>}
                </>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] p-1"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Existing items */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide">Checklist items ({template?.itemCount || 0})</h3>
            {isLoading ? (
              Array(3).fill(0).map((_, i) => <div key={i} className="h-12 bg-[#D4E4F7] rounded-lg animate-pulse" />)
            ) : (template?.items || []).length === 0 ? (
              <div className="text-center py-6 text-sm text-[#7A9CC0]">No items yet. Add your first checklist item below.</div>
            ) : (template?.items || []).map((item: any, idx: number) => (
              <div key={item.itemId} className="flex items-center gap-3 bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg px-3 py-2.5">
                <span className="text-xs font-bold text-[#AAC0E1] flex-shrink-0 w-5">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-[#0A1F4E] truncate">{item.itemText}{item.isMandatory && <span className="text-red-500 ml-1">*</span>}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-[#7A9CC0] bg-white border border-[#D4E4F7] px-1.5 py-0.5 rounded">{item.inputType}</span>
                    {item.unit && <span className="text-xs text-[#7A9CC0]">{item.unit}</span>}
                    {item.dropdownOptions && <span className="text-xs text-[#7A9CC0]">{item.dropdownOptions.join(', ')}</span>}
                  </div>
                </div>
                <button onClick={() => deleteItemMutation.mutate(item.itemId)}
                  className="text-[#AAC0E1] hover:text-red-500 transition-colors flex-shrink-0">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add new item */}
          <div className="border-t border-[#D4E4F7] pt-4">
            <h3 className="text-xs font-semibold text-[#7A9CC0] uppercase tracking-wide mb-3">Add new item</h3>
            <div className="space-y-3 bg-[#F5FEFF] border border-[#D4E4F7] rounded-xl p-4">
              <div>
                <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Item text *</label>
                <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                  value={newItem.itemText} onChange={e => setNewItem(n => ({ ...n, itemText: e.target.value }))}
                  placeholder="e.g. Check hydraulic oil level" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Input type *</label>
                  <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={newItem.inputType} onChange={e => setNewItem(n => ({ ...n, inputType: e.target.value }))}>
                    {INPUT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Unit (optional)</label>
                  <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={newItem.unit} onChange={e => setNewItem(n => ({ ...n, unit: e.target.value }))} placeholder="°C, PSI, mm..." />
                </div>
              </div>
              {newItem.inputType === 'Dropdown' && (
                <div>
                  <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Dropdown options (comma separated)</label>
                  <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                    value={newItem.dropdownOptions} onChange={e => setNewItem(n => ({ ...n, dropdownOptions: e.target.value }))}
                    placeholder="OK, Not OK, NA" />
                </div>
              )}
              <div className="flex items-center gap-2">
                <input type="checkbox" id="mandatory" checked={newItem.isMandatory}
                  onChange={e => setNewItem(n => ({ ...n, isMandatory: e.target.checked }))}
                  className="w-4 h-4 accent-[#0E2F76]" />
                <label htmlFor="mandatory" className="text-sm text-[#3A5A8A] cursor-pointer">Mandatory field</label>
              </div>
              <button onClick={() => addItemMutation.mutate()} disabled={addItemMutation.isPending || !newItem.itemText}
                className="w-full bg-[#0E2F76] text-white text-sm font-medium py-2 rounded-lg hover:bg-[#071E52] disabled:opacity-50 flex items-center justify-center gap-2">
                <Plus className="w-4 h-4" />
                {addItemMutation.isPending ? 'Adding...' : 'Add item'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Template Modal ─────────────────────────────────────────
function CreateTemplateModal({ onClose, departments }: any) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ templateName: '', deptId: '', frequency: 'Daily', description: '' });

  const mutation = useMutation({
    mutationFn: () => api.post('/checklists', form),
    onSuccess: () => {
      toast.success('Template created!');
      qc.invalidateQueries({ queryKey: ['templates'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl border border-[#D4E4F7] w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between p-5 border-b border-[#D4E4F7]">
          <h2 className="text-base font-semibold text-[#0A1F4E]">Create checklist template</h2>
          <button onClick={onClose} className="text-[#7A9CC0] hover:text-[#0A1F4E] text-xl leading-none">×</button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Template name *</label>
            <input className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
              value={form.templateName} onChange={e => setForm(f => ({ ...f, templateName: e.target.value }))}
              placeholder="e.g. Daily BM Safety Check" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Department *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.deptId} onChange={e => setForm(f => ({ ...f, deptId: e.target.value }))}>
                <option value="">Select dept</option>
                {departments.map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Frequency *</label>
              <select className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20"
                value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
          {PHOTO_FREQS.includes(form.frequency) && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700 flex items-center gap-2">
              <Image className="w-4 h-4 flex-shrink-0" />
              Photo upload will be required for this frequency.
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Description</label>
            <textarea className="w-full border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 resize-none h-16"
              value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Optional description..." />
          </div>
        </div>
        <div className="flex justify-end gap-3 p-5 border-t border-[#D4E4F7]">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-[#3A5A8A] bg-[#F5FEFF] border border-[#D4E4F7] rounded-lg hover:bg-[#D4E4F7]">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.templateName || !form.deptId}
            className="px-4 py-2 text-sm font-medium text-white bg-[#0E2F76] rounded-lg hover:bg-[#071E52] disabled:opacity-50">
            {mutation.isPending ? 'Creating...' : 'Create template'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────
export default function ChecklistsPage() {
  const { isRole } = useAuthStore();
  const [freqFilter, setFreqFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['templates', freqFilter, deptFilter],
    queryFn: () => api.get('/checklists', { params: { frequency: freqFilter, deptId: deptFilter, limit: 50 } }).then(r => r.data),
  });

  const { data: deptsData } = useQuery({ queryKey: ['depts-list'], queryFn: () => api.get('/departments?limit=20').then(r => r.data.data) });

  const templates = templatesData?.data || [];

  const freqColor: Record<string, string> = {
    Daily: 'bg-blue-50 text-blue-700', 'Weekly': 'bg-purple-50 text-purple-700',
    Monthly: 'bg-green-50 text-green-700', Quarterly: 'bg-orange-50 text-orange-700',
    'Half-Yearly': 'bg-pink-50 text-pink-700', Yearly: 'bg-red-50 text-red-700',
    '10-Day': 'bg-indigo-50 text-indigo-700', '15-Day': 'bg-teal-50 text-teal-700',
    'On-Demand': 'bg-gray-100 text-gray-700',
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#0A1F4E]">Checklist templates</h1>
          <p className="text-sm text-[#7A9CC0] mt-0.5">{templates.length} templates</p>
        </div>
        {isRole(['Admin', 'Supervisor']) && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 bg-[#0E2F76] text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-[#071E52]">
            <Plus className="w-4 h-4" /> New template
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-[#D4E4F7] p-4 flex flex-wrap gap-3">
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[140px]"
          value={freqFilter} onChange={e => setFreqFilter(e.target.value)}>
          <option value="">All frequencies</option>
          {FREQUENCIES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="border border-[#AAC0E1] rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 min-w-[160px]"
          value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
          <option value="">All departments</option>
          {(deptsData || []).map((d: any) => <option key={d.deptId} value={d.deptId}>{d.deptName}</option>)}
        </select>
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array(6).fill(0).map((_, i) => <div key={i} className="h-36 bg-white rounded-xl border border-[#D4E4F7] animate-pulse" />)
        ) : templates.length === 0 ? (
          <div className="col-span-3 bg-white rounded-xl border border-[#D4E4F7] py-16 text-center">
            <ClipboardCheck className="w-12 h-12 text-[#AAC0E1] mx-auto mb-3" />
            <p className="text-sm font-semibold text-[#0A1F4E]">No templates yet</p>
            <p className="text-xs text-[#7A9CC0] mt-1">Create your first checklist template</p>
          </div>
        ) : templates.map((t: any) => (
          <button key={t.templateId} onClick={() => setSelectedTemplate(t.templateId)}
            className="bg-white rounded-xl border border-[#D4E4F7] p-4 text-left hover:border-[#AAC0E1] hover:shadow-md transition-all group">
            <div className="flex items-start justify-between mb-3">
              <div className="w-9 h-9 bg-[#EFF6FF] rounded-lg flex items-center justify-center">
                <ClipboardCheck className="w-5 h-5 text-[#0E2F76]" />
              </div>
              <ChevronRight className="w-4 h-4 text-[#AAC0E1] group-hover:text-[#0E2F76] transition-colors" />
            </div>
            <p className="font-semibold text-[#0A1F4E] text-sm mb-1 line-clamp-2">{t.templateName}</p>
            <p className="text-xs text-[#7A9CC0] mb-3">{t.deptName}</p>
            <div className="flex items-center justify-between">
              <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${freqColor[t.frequency] || 'bg-gray-100 text-gray-600'}`}>{t.frequency}</span>
              <div className="flex items-center gap-2">
                {t.hasPhoto && <Image className="w-3.5 h-3.5 text-amber-500" />}
                <span className="text-xs text-[#7A9CC0]">{t.itemCount} items</span>
              </div>
            </div>
          </button>
        ))}
      </div>

      {showCreate && <CreateTemplateModal onClose={() => setShowCreate(false)} departments={deptsData || []} />}
      {selectedTemplate && <TemplateBuilder templateId={selectedTemplate} onClose={() => setSelectedTemplate(null)} />}
    </div>
  );
}
