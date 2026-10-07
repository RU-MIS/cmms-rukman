'use client';
import { useData } from './useData';
import { must, sb } from './supabase';

export interface Item { id: string; code: string; name: string; base_unit_id: string; sales_unit_id: string | null;
  purchase_unit_id: string | null; item_kind: string; is_active: boolean; sale_price: number | null; purchase_price: number | null }
export interface Unit { id: string; code: string; name: string }
export interface Godown { id: string; code: string; name: string; is_active: boolean }
export interface Location { id: string; godown_id: string; code: string; is_default: boolean; is_active: boolean; zone: string | null }
export interface Party { id: string; code: string; name: string; email: string | null; is_active: boolean }

export function useItems(companyId: string) {
  return useData(async () => must<Item[]>(await sb().from('items')
    .select('id, code, name, base_unit_id, sales_unit_id, purchase_unit_id, item_kind, is_active, sale_price, purchase_price')
    .eq('company_id', companyId).eq('is_deleted', false).order('name')), [companyId]);
}

export function useGodowns(companyId: string) {
  return useData(async () => must<Godown[]>(await sb().from('godowns').select('id, code, name, is_active')
    .eq('company_id', companyId).eq('is_deleted', false).order('name')), [companyId]);
}

export function useLocations(companyId: string) {
  return useData(async () => must<Location[]>(await sb().from('storage_locations')
    .select('id, godown_id, code, is_default, is_active, zone').eq('company_id', companyId).order('code')), [companyId]);
}

export function useParties(companyId: string, role?: string | string[]) {
  const roles = role ? (Array.isArray(role) ? role : [role]) : null;
  return useData(async () => {
    let q = sb().from('parties').select('id, code, name, email, is_active, party_roles!inner(role)')
      .eq('company_id', companyId).eq('is_deleted', false).order('name');
    if (roles) q = q.in('party_roles.role', roles);
    const rows = must<(Party & { party_roles: unknown })[]>(await q);
    const seen = new Set<string>();
    return rows.filter((r) => !seen.has(r.id) && seen.add(r.id)).map(({ party_roles: _r, ...p }) => { void _r; return p; });
  }, [companyId, roles?.join(',')]);
}

/** Units usable for an item: base unit + its packings. */
export function useUnitsAll() {
  return useData(async () => must<(Unit & { company_id: string | null })[]>(await sb().from('units').select('id, code, name, company_id').order('code')), []);
}

export function usePackings(companyId: string) {
  return useData(async () => must<{ item_id: string; unit_id: string; factor_to_base: number; is_default: boolean }[]>(
    await sb().from('item_packings').select('item_id, unit_id, factor_to_base, is_default, items!inner(company_id)').eq('items.company_id', companyId)), [companyId]);
}

export function itemUnits(item: Item | undefined, units: Unit[] | null, packings: { item_id: string; unit_id: string; factor_to_base: number }[] | null) {
  if (!item || !units) return [];
  const ids = [item.base_unit_id, ...(packings ?? []).filter((p) => p.item_id === item.id).map((p) => p.unit_id)];
  return units.filter((u) => ids.includes(u.id)).map((u) => {
    const f = (packings ?? []).find((p) => p.item_id === item.id && p.unit_id === u.id)?.factor_to_base;
    return { value: u.id, label: f ? `${u.code} (${Number(f)})` : u.code };
  });
}

export const opt = <T extends { id: string; name: string; code?: string }>(rows: T[] | null, withCode = false) =>
  (rows ?? []).map((r) => ({ value: r.id, label: withCode && r.code ? `${r.code} — ${r.name}` : r.name }));
