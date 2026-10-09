'use client';
import { rpc } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { Badge, Card, ErrorBox, PageHeader, Spinner, Toggle, useAction } from '@/components/ui';

interface Mod { code: string; label: string; description: string; is_core: boolean; is_enabled: boolean }

/**
 * Module switch per company (D6). A disabled module is refused by the database
 * for every user: tables, document actions, imports, exports, portal RPCs.
 * Administration and Masters are always on, so the Owner can always come back here.
 */
export default function ModulesPage() {
  const companyId = useCompanyId();
  const { can, refresh } = useSession();
  const { busy, run } = useAction();
  const mods = useData(() => rpc<Mod[]>('company_modules_list', { p_company_id: companyId }), [companyId]);
  const editable = can('settings_modules.edit');
  return (
    <div>
      <PageHeader title="Modules" subtitle="Switch business modules on or off. Data stays; a module that is off is refused everywhere (screens, API, imports, exports, portals)." />
      <ErrorBox error={mods.error} />
      {!mods.data ? (mods.error ? null : <Spinner />) : (
        <Card>
          <div className="divide-y divide-slate-100">
            {mods.data.map((m) => (
              <div key={m.code} className="flex items-start justify-between gap-4" data-testid={`module-${m.code}`}>
                <div className="flex-1">
                  <Toggle label={m.label} hint={m.description} checked={m.is_enabled} disabled={!editable || m.is_core || busy}
                    onChange={(v) => run(async () => {
                      await rpc('module_set', { p_company_id: companyId, p_module: m.code, p_enabled: v });
                      mods.reload(); await refresh();
                    }, `${m.label} ${v ? 'switched on' : 'switched off'}`)} />
                </div>
                {m.is_core && <div className="pt-2"><Badge color="blue">Always on</Badge></div>}
              </div>))}
          </div>
          {!editable && <p className="mt-3 text-sm text-slate-500">Changing modules needs the Modules edit right.</p>}
        </Card>)}
    </div>
  );
}
