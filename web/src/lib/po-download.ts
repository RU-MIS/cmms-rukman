'use client';
import { rpc } from './supabase';
import { buildPoPdf, type PoPrintData } from './po-pdf';

/** Builds the PO PDF in the browser (same generator as the email worker) and downloads it. */
export async function downloadPoPdf(poId: string, viaPortal?: { companyId: string }) {
  const data = viaPortal
    ? await rpc<PoPrintData>('portal_vendor_po_print', { p_company_id: viaPortal.companyId, p_po_id: poId })
    : await rpc<PoPrintData>('purchase_order_print', { p_po_id: poId });
  const bytes = await buildPoPdf(data);
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `PO-${(data.po.doc_no ?? 'draft').replace(/[^A-Za-z0-9-]+/g, '-')}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
