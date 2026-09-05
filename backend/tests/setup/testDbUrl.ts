/**
 * Resolves which MySQL database the test suite runs against.
 *
 * Precedence: an explicit `TEST_DATABASE_URL` always wins. Otherwise, the
 * suite derives one from `DATABASE_URL` by appending `_test` to the
 * database name — so `npm test` never touches whatever database your local
 * `backend/.env` points at for everyday development, without requiring any
 * extra setup.
 */
export function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

  const base = process.env.DATABASE_URL;
  if (!base) {
    throw new Error(
      'Set DATABASE_URL (or TEST_DATABASE_URL) before running tests — see backend/.env.example.'
    );
  }

  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  // Always append, even if DATABASE_URL already ends in "_test" — globalSetup
  // drops this database on every run, so the derived name must never be able
  // to collide with (and equal) the real DATABASE_URL, whatever it's called.
  url.pathname = `/${dbName}_jest_test`;
  // Rebuilt manually rather than via url.toString(): MySQL connection
  // strings aren't a "special" WHATWG scheme, and toString() on some
  // Node versions re-encodes the password/host in ways that don't
  // round-trip cleanly for those.
  return `${url.protocol}//${url.username}:${url.password}@${url.host}${url.pathname}${url.search}`;
}

export function testDatabaseName(testDatabaseUrl: string): string {
  return new URL(testDatabaseUrl).pathname.replace(/^\//, '');
}
