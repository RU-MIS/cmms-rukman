export default async function globalTeardown() {
  // Nothing to tear down — the test database is dropped and recreated at
  // the start of the next run (see globalSetup.ts), so it's left in place
  // for manual inspection after a failing run rather than wiped here.
}
