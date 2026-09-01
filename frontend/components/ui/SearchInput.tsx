'use client';

import { Search } from 'lucide-react';

export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="input !pl-8 w-56"
      />
    </div>
  );
}
