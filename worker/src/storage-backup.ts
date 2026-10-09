// Backup / restore of the files in Supabase Storage (the database dump holds
// only metadata). Service role required.
//   node src/storage-backup.ts backup  <dir> [bucket=documents]
//   node src/storage-backup.ts restore <dir> [bucket=documents]
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative } from 'node:path';

// Buckets with allowed MIME types (item-images) need the type on upload.
const TYPES: Record<string, string> = { '.pdf': 'application/pdf', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif' };
import { createDb } from './worker.ts';

type Db = ReturnType<typeof createDb>;

async function listAll(db: Db, bucket: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    for (const e of data ?? []) {
      const path = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) out.push(...(await listAll(db, bucket, path)));   // folder
      else out.push(path);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return [] as string[]; throw e; });
  for (const e of entries) {
    const p = join(dir, e);
    if ((await stat(p)).isDirectory()) out.push(...(await walk(p))); else out.push(p);
  }
  return out;
}

export async function backup(db: Db, dir: string, bucket = 'documents') {
  const files = await listAll(db, bucket);
  for (const path of files) {
    const { data, error } = await db.storage.from(bucket).download(path);
    if (error || !data) throw new Error(`download ${path}: ${error?.message}`);
    const target = join(dir, bucket, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, Buffer.from(await data.arrayBuffer()));
  }
  return files.length;
}

export async function restore(db: Db, dir: string, bucket = 'documents') {
  const root = join(dir, bucket);
  const files = await walk(root);
  for (const file of files) {
    const path = relative(root, file).split('\\').join('/');
    const contentType = TYPES[extname(path).toLowerCase()];
    const { error } = await db.storage.from(bucket).upload(path, await readFile(file), { upsert: true, ...(contentType ? { contentType } : {}) });
    if (error) throw new Error(`upload ${path}: ${error.message}`);
  }
  return files.length;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [mode, dir, bucket = 'documents'] = process.argv.slice(2);
  if (!['backup', 'restore'].includes(mode ?? '') || !dir) {
    console.error('usage: node src/storage-backup.ts backup|restore <dir> [bucket]');
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required'); process.exit(2); }
  const db = createDb({ supabaseUrl: url, serviceRoleKey: key });
  const n = mode === 'backup' ? await backup(db, dir, bucket) : await restore(db, dir, bucket);
  console.log(`${mode}: ${n} file(s) of bucket ${bucket}`);
}
