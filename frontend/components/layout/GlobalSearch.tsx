'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, User, Package } from 'lucide-react';
import { api } from '@/lib/api';

export function GlobalSearch() {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['global-search', query],
    queryFn: async () => {
      const [customers, products] = await Promise.all([
        api.get('/customers', { params: { search: query, pageSize: 5 } }),
        api.get('/products', { params: { search: query, pageSize: 5 } }),
      ]);
      return { customers: customers.data.data, products: products.data.data };
    },
    enabled: query.trim().length >= 2,
  });

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  const hasResults = (data?.customers?.length ?? 0) > 0 || (data?.products?.length ?? 0) > 0;

  return (
    <div className="relative" ref={boxRef}>
      <Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint" />
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Search customers, products…"
        className="input !pl-8 w-72"
      />
      {open && query.trim().length >= 2 && (
        <div className="absolute mt-1 w-full card p-1.5 z-40 max-h-80 overflow-y-auto">
          {!hasResults && <p className="text-xs text-ink-faint px-2 py-2">No matches</p>}
          {(data?.customers?.length ?? 0) > 0 && (
            <div className="mb-1">
              <p className="px-2 py-1 text-[10px] font-semibold uppercase text-ink-faint">Customers</p>
              {data!.customers.map((c: any) => (
                <button
                  key={c.id}
                  className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-brand-50 text-sm"
                  onClick={() => {
                    router.push(`/customers?search=${encodeURIComponent(c.name)}`);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <User size={14} className="text-ink-faint" /> {c.name}
                </button>
              ))}
            </div>
          )}
          {(data?.products?.length ?? 0) > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-semibold uppercase text-ink-faint">Products</p>
              {data!.products.map((p: any) => (
                <button
                  key={p.id}
                  className="flex items-center gap-2 w-full text-left px-2 py-1.5 rounded hover:bg-brand-50 text-sm"
                  onClick={() => {
                    router.push(`/products?search=${encodeURIComponent(p.name)}`);
                    setOpen(false);
                    setQuery('');
                  }}
                >
                  <Package size={14} className="text-ink-faint" /> {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
