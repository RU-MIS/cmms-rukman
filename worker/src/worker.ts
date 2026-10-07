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

async function buildAttachments(db: SupabaseClient, email: ClaimedEmail) {
  const out: { filename: string; content: Buffer; contentType?: string }[] = [];
  for (const a of email.attachments) {
    if (a.type === 'po_pdf') {
      if (!a.data) throw new Error('PO data missing for PDF attachment');
      out.push({ filename: a.file_name, content: Buffer.from(await buildPoPdf(a.data)), contentType: 'application/pdf' });
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
    const from = mailFrom.includes('<') ? mailFrom : `"${email.company_name.replace(/"/g, '')}" <${mailFrom}>`;
    const info = await transport.sendMail({
      from,
      to: email.to,
      cc: email.cc.length ? email.cc : undefined,
      replyTo: email.company_email ?? undefined,
      subject: email.subject,
      text: email.body_text,
      html: htmlBody(email.body_text),
      attachments,
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
