import nodemailer from 'nodemailer';
import { env } from '../../config/env';

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!env.smtp.host || !env.smtp.user) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: { user: env.smtp.user, pass: env.smtp.password },
      // Fail fast instead of hanging the request for minutes when SMTP
      // settings are wrong or unreachable.
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 10_000,
    });
  }
  return transporter;
}

export async function sendEmailWithAttachment(params: {
  to: string;
  subject: string;
  text: string;
  filename: string;
  content: Buffer;
}) {
  const t = getTransporter();
  if (!t) {
    throw new Error('SMTP is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD in backend/.env.');
  }
  await t.sendMail({
    from: env.smtp.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    attachments: [{ filename: params.filename, content: params.content }],
  });
}

export async function sendPlainEmail(params: { to: string; subject: string; text: string; html?: string }) {
  const t = getTransporter();
  if (!t) {
    throw new Error('SMTP is not configured. Set SMTP_HOST/SMTP_USER/SMTP_PASSWORD in backend/.env.');
  }
  await t.sendMail({
    from: env.smtp.from,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });
}
