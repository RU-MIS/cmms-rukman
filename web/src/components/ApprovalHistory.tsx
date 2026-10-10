'use client';
import { must, sb } from '@/lib/supabase';
import { useData } from '@/lib/useData';
import { dateTime } from '@/lib/format';
import { Badge, Card } from './ui';

/** Approval history of a document (submissions, approvals per level, rejections with their reason). */
export function ApprovalHistory({ docType, docId }: { docType: string; docId: string }) {
  const h = useData(async () => must<{ id: number; level_no: number | null; decision: string; comment: string | null; at: string }[]>(
    await sb().from('approval_actions').select('id, level_no, decision, comment, at').eq('doc_type', docType).eq('doc_id', docId).order('id')), [docType, docId]);
  if (!h.data || h.data.length === 0) return null;
  const lastReject = [...h.data].reverse().find((a) => a.decision === 'REJECTED');
  return (
    <Card title="Approval history">
      {lastReject && <p role="alert" className="mb-2 rounded bg-red-50 p-2 text-sm text-red-700">Rejected: {lastReject.comment}</p>}
      <ul className="space-y-1 text-sm">{h.data.map((a) => (
        <li key={a.id}><Badge>{a.decision}</Badge> {a.level_no ? `level ${a.level_no} · ` : ''}{dateTime(a.at)}{a.comment ? ` — ${a.comment}` : ''}</li>))}</ul>
    </Card>
  );
}
