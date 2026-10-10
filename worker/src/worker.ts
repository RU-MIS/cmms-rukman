// Email outbox worker. Business transactions only QUEUE emails (email_outbox);
// this worker claims them (SKIP LOCKED, service role), builds attachments,
// sends over SMTP and reports the result. Failures are retried with back-off
// by the database (email_complete), so a broken SMTP server never affects ERP
// transactions.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import nodemailer, { type Transporter } from 'nodemailer';
import { buildPoPdf, type PoPrintData } from './po-pdf.ts';
import type { WorkerConfig } from './config.ts';

export interface ClaimedAttachment {
  type: 'storage' | 'po_pdf';
  bucket?: string;
  path?: string;
  file_name: string;
  mime_type?: string | null;
  data?: PoPrintData;
}

export interface ClaimedEmail {
  id: string;
  company_id: string;
  company_name: string;
  company_email: string | null;
  kind: string;
  to: string[];
  cc: string[];
  subject: string;
  body_text: string;
  attachments: ClaimedAttachment[];
  attempt: number;
}

export interface RunResult {
  claimed: number;
  sent: number;
  failed: number;
  reminders?: unknown;
  imports?: number;
  orphanImages?: number;
}

/**
 * Removes item-image files that no item_images row references and that are
 * older than 24 hours (an upload whose registration failed or was abandoned).
 */
export async function cleanOrphanImages(db: SupabaseClient, log: Logger, minAgeMs = 24 * 3600_000): Promise<number> {
  const cutoff = Date.now() - minAgeMs;
  let removed = 0;
  const { data: companies } = await db.storage.from('item-images').list('', { limit: 1000 });
  for (const c of companies ?? []) {
    const { data: items } = await db.storage.from('item-images').list(c.name, { limit: 10000 });
    for (const it of items ?? []) {
      const { data: files } = await db.storage.from('item-images').list(`${c.name}/${it.name}`, { limit: 1000 });
      const paths = (files ?? []).filter((f) => f.id && Date.parse(f.created_at ?? '') < cutoff).map((f) => `${c.name}/${it.name}/${f.name}`);
      if (paths.length === 0) continue;
      const { data: known } = await db.from('item_images').select('storage_path').in('storage_path', paths);
      const keep = new Set((known ?? []).map((k: { storage_path: string }) => k.storage_path));
      const orphans = paths.filter((p) => !keep.has(p));
      if (orphans.length) {
        const { error } = await db.storage.from('item-images').remove(orphans);
        if (error) log.error(`orphan cleanup failed: ${error.message}`); else removed += orphans.length;
      }
    }
  }
  if (removed) log.info(`removed ${removed} orphaned item image(s)`);
  return removed;
}

export interface Logger {
  info(msg: string): void;
  error(msg: string): void;
}

const consoleLogger: Logger = {
  info: (m) => console.log(`[worker] ${m}`),
  error: (m) => console.error(`[worker] ${m}`),
};

export function createDb(cfg: Pick<WorkerConfig, 'supabaseUrl' | 'serviceRoleKey'>): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function createTransport(cfg: WorkerConfig): Transporter {
  return nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.secure,
    auth: cfg.smtp.user ? { user: cfg.smtp.user, pass: cfg.smtp.pass } : undefined,
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
}

function htmlBody(text: string): string {
  const esc = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;white-space:pre-wrap">${esc}</div>`;
}

export interface CompanyBranding { email_from_name: string | null; email_reply_to: string | null; document_footer: string | null; logo_path: string | null }

/** Company branding for e-mails and PDFs (service role; empty values fall back to the company profile). */
export async function companyBranding(db: SupabaseClient, companyId: string): Promise<CompanyBranding | null> {
  const { data } = await db.from('company_branding').select('email_from_name, email_reply_to, document_footer, logo_path')
    .eq('company_id', companyId).maybeSingle();
  return (data as CompanyBranding | null) ?? null;
}

async function readLogo(db: SupabaseClient, path: string | null | undefined): Promise<Uint8Array | null> {
  if (!path) return null;
  const { data } = await db.storage.from('company-assets').download(path);
  return data ? new Uint8Array(await data.arrayBuffer()) : null;
}

async function buildAttachments(db: SupabaseClient, email: ClaimedEmail) {
  const out: { filename: string; content: Buffer; contentType?: string }[] = [];
  for (const a of email.attachments) {
    if (a.type === 'po_pdf') {
      if (!a.data) throw new Error('PO data missing for PDF attachment');
      const logo = await readLogo(db, a.data.branding?.logo_path);
      out.push({ filename: a.file_name, content: Buffer.from(await buildPoPdf(a.data, logo)), contentType: 'application/pdf' });
    } else {
      const { data, error } = await db.storage.from(a.bucket ?? 'documents').download(a.path ?? '');
      if (error || !data) throw new Error(`Attachment ${a.file_name} could not be read: ${error?.message ?? 'not found'}`);
      out.push({ filename: a.file_name, content: Buffer.from(await data.arrayBuffer()), contentType: a.mime_type ?? undefined });
    }
  }
  return out;
}

/** Sends one claimed email and reports the result to the database. */
export async function deliver(db: SupabaseClient, transport: Transporter, mailFrom: string, email: ClaimedEmail, log: Logger) {
  try {
    const attachments = await buildAttachments(db, email);
    const b = await companyBranding(db, email.company_id);
    // sender name / reply-to / footer of the company's branding; the sending address stays the instance's SMTP sender
    const name = (b?.email_from_name || email.company_name).replace(/["<>\r\n]/g, '');
    const address = mailFrom.match(/<([^>]+)>/)?.[1] ?? mailFrom;
    const from = `"${name}" <${address}>`;
    const body = b?.document_footer ? `${email.body_text}\n\n--\n${b.document_footer}` : email.body_text;
    const info = await transport.sendMail({
      from,
      to: email.to,
      cc: email.cc.length ? email.cc : undefined,
      replyTo: b?.email_reply_to || email.company_email || undefined,
      subject: email.subject,
      text: body,
      html: htmlBody(body),
      attachments,
      // stable Message-ID: a retry of the same outbox row is recognisable as the
      // same message (mail servers / clients de-duplicate on it)
      messageId: `<erp-${email.id}@${(mailFrom.match(/@([^>\s]+)/)?.[1] ?? 'erp.local')}>`,
      headers: { 'X-ERP-Email-Id': email.id, 'X-ERP-Email-Kind': email.kind },
    });
    const res = await db.rpc('email_complete', { p_id: email.id, p_ok: true, p_error: null, p_message_id: info.messageId ?? null });
    if (res.error) throw new Error(`email_complete failed: ${res.error.message}`);
    log.info(`sent ${email.kind} ${email.id} to ${email.to.join(', ')}`);
    return true;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error(`failed ${email.kind} ${email.id} (attempt ${email.attempt}): ${message}`);
    const res = await db.rpc('email_complete', { p_id: email.id, p_ok: false, p_error: message.slice(0, 1000), p_message_id: null });
    if (res.error) log.error(`could not record failure of ${email.id}: ${res.error.message}`);
    return false;
  }
}

/** Claims and sends until the queue is empty (or maxBatches reached). */
export async function runOnce(opts: {
  db: SupabaseClient;
  transport: Transporter;
  mailFrom: string;
  batchSize?: number;
  maxBatches?: number;
  reminders?: boolean;
  asOf?: string;
  log?: Logger;
}): Promise<RunResult> {
  const log = opts.log ?? consoleLogger;
  const result: RunResult = { claimed: 0, sent: 0, failed: 0 };
  if (opts.reminders) {
    const r = await opts.db.rpc('run_payment_reminders', opts.asOf ? { p_as_of: opts.asOf } : {});
    if (r.error) throw new Error(`run_payment_reminders failed: ${r.error.message}`);
    result.reminders = r.data;
    log.info(`payment reminders: ${JSON.stringify(r.data)}`);
    result.orphanImages = await cleanOrphanImages(opts.db, log);   // daily, with the reminders
  }
  // large imports queued by the screen: committed here as the importer (one transaction each)
  for (let i = 0; i < 5; i++) {
    const r = await opts.db.rpc('import_commit_next');
    if (r.error) { log.error(`import_commit_next failed: ${r.error.message}`); break; }
    if (!r.data) break;
    const j = r.data as { job_id: string; status: string; imported_rows: number };
    log.info(`import ${j.job_id}: ${j.status} (${j.imported_rows} rows)`);
    result.imports = (result.imports ?? 0) + 1;
  }
  for (let i = 0; i < (opts.maxBatches ?? 50); i++) {
    const { data, error } = await opts.db.rpc('email_claim', { p_limit: opts.batchSize ?? 20 });
    if (error) throw new Error(`email_claim failed: ${error.message}`);
    const batch = (data ?? []) as ClaimedEmail[];
    if (batch.length === 0) break;
    result.claimed += batch.length;
    for (const email of batch) {
      if (await deliver(opts.db, opts.transport, opts.mailFrom, email, log)) result.sent++;
      else result.failed++;
    }
  }
  return result;
}
