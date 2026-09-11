'use client';

import { useState } from 'react';
import { Search, Loader2, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { isValidGSTIN } from '@/lib/gstin';

interface GstinInputProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  disabled?: boolean;
  /** Called with the fetched taxpayer details once a real GST API is connected. Unused today. */
  onFetched?: (details: Record<string, unknown>) => void;
}

export function GstinInput({ value, onChange, label = 'GSTIN', disabled = false, onFetched }: GstinInputProps) {
  const [fetching, setFetching] = useState(false);
  const trimmed = (value || '').trim().toUpperCase();
  const showError = trimmed.length > 0 && !isValidGSTIN(trimmed);

  async function handleFetch() {
    if (!isValidGSTIN(trimmed)) {
      toast.error('Enter a valid 15-character GSTIN first');
      return;
    }
    setFetching(true);
    try {
      const res = await api.post('/gst/lookup', { gstin: trimmed });
      onFetched?.(res.data.data);
      toast.success('GST details fetched');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setFetching(false);
    }
  }

  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex gap-2">
        <input
          className={`input ${showError ? '!border-danger focus:!ring-danger/30' : ''}`}
          value={value ?? ''}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          maxLength={15}
          placeholder="22AAAAA0000A1Z5"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={handleFetch}
          disabled={fetching || disabled}
          className="btn-secondary shrink-0 whitespace-nowrap"
          title="GST API not configured yet — enter details manually for now"
        >
          {fetching ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
          Fetch GST Details
        </button>
      </div>
      {showError && (
        <p className="text-xs text-danger mt-1 flex items-center gap-1">
          <AlertCircle size={12} /> Invalid GSTIN format
        </p>
      )}
    </div>
  );
}
