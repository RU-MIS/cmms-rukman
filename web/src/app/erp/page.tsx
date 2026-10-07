'use client';
import Link from 'next/link';
import { sb, must } from '@/lib/supabase';
import { useCompanyId, useSession } from '@/lib/session';
import { useData } from '@/lib/useData';
import { ErrorBox, PageHeader, Spinner, Stat } from '@/components/ui';
import { money } from '@/lib/format';

async function count(q: PromiseLike<{ count: number | null; error: unknown }>) {
  const r = await q;
  if (r.error) throw r.error;
  return r.count ?? 0;
}

export default function Dashboard() {
  const companyId = useCompanyId();
  const { can } = useSession();
  const { data, error, loading } = useData(async () => {
    const c = sb();
    const head = { count: 'exact' as const, head: true };
    const [low, out, cpo, so, pending, failed, overdue] = await Promise.all([
      can('items.view') ? count(c.from('v_inventory_items').select('item_id', head).eq('company_id', companyId).eq('stock_status', 'LOW_STOCK')) : 0,
      can('items.view') ? count(c.from('v_inventory_items').select('item_id', head).eq('company_id', companyId).eq('stock_status', 'OUT_OF_STOCK')) : 0,
      can('customer_po.view') ? count(c.from('customer_pos').select('id', head).eq('company_id', companyId).in('status', ['SUBMITTED', 'UNDER_REVIEW'])) : 0,
      can('sales_order.view') ? count(c.from('sales_orders').select('id', head).eq('company_id', companyId).in('status', ['OPEN', 'PARTIALLY_DISPATCHED'])) : 0,
      can('purchase_order.view') ? count(c.from('v_purchase_pending_lines').select('po_line_id', head).eq('company_id', companyId)) : 0,
      can('email.view') ? count(c.from('email_outbox').select('id', head).eq('company_id', companyId).eq('status', 'FAILED')) : 0,
      can('voucher.view')
        ? must(await c.from('v_bill_outstanding').select('outstanding_amount').eq('company_id', companyId).eq('side', 'RECEIVABLE')
            .gt('outstanding_amount', 0).lt('due_date', new Date().toISOString().slice(0, 10)))
            .reduce((s: number, r: { outstanding_amount: number }) => s + Number(r.outstanding_amount), 0)
        : 0,
    ]);
    return { low, out, cpo, so, pending, failed, overdue };
  }, [companyId]);

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="What needs attention today" />
      <ErrorBox error={error} />
      {loading && !data ? <Spinner /> : data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Link href="/erp/inventory/?status=LOW_STOCK"><Stat label="Low stock items" value={data.low} tone={data.low ? 'amber' : undefined} /></Link>
          <Link href="/erp/inventory/?status=OUT_OF_STOCK"><Stat label="Out of stock" value={data.out} tone={data.out ? 'red' : undefined} /></Link>
          <Link href="/erp/customer-pos/"><Stat label="Customer POs to review" value={data.cpo} tone={data.cpo ? 'amber' : undefined} /></Link>
          <Link href="/erp/sales-orders/"><Stat label="Open sales orders" value={data.so} /></Link>
          <Link href="/erp/receiving/"><Stat label="PO lines pending receipt" value={data.pending} /></Link>
          <Link href="/erp/email-log/?status=FAILED"><Stat label="Failed emails" value={data.failed} tone={data.failed ? 'red' : undefined} /></Link>
          <Link href="/erp/bills/"><Stat label="Overdue receivables" value={money(data.overdue)} tone={data.overdue ? 'red' : undefined} /></Link>
        </div>
      )}
    </div>
  );
}
