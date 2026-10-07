// Worker configuration — everything from environment variables (no secrets in code).
export interface WorkerConfig {
  supabaseUrl: string;
  serviceRoleKey: string;
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    pass?: string;
  };
  mailFrom: string;
  batchSize: number;
  loopIntervalMs: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Environment variable ${name} is required`);
  return v;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const port = Number(env.SMTP_PORT ?? 587);
  return {
    supabaseUrl: env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? required('SUPABASE_URL'),
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY ?? required('SUPABASE_SERVICE_ROLE_KEY'),
    smtp: {
      host: env.SMTP_HOST ?? required('SMTP_HOST'),
      port,
      secure: (env.SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true',
      user: env.SMTP_USER || undefined,
      pass: env.SMTP_PASSWORD || env.SMTP_PASS || undefined,
    },
    mailFrom: env.MAIL_FROM
      ?? (env.EMAIL_FROM_ADDRESS
        ? (env.EMAIL_FROM_NAME ? `"${env.EMAIL_FROM_NAME.replace(/"/g, '')}" <${env.EMAIL_FROM_ADDRESS}>` : env.EMAIL_FROM_ADDRESS)
        : required('EMAIL_FROM_ADDRESS')),
    batchSize: Number(env.WORKER_BATCH_SIZE ?? 20),
    loopIntervalMs: Number(env.WORKER_LOOP_INTERVAL_MS ?? 60000),
  };
}
