// In-memory simulation of the Apps Script services used by the backend, so the
// real .gs files can be executed and tested with Node. It is NOT Google: it
// cannot prove deployment, quotas or Google's redirect / CORS behaviour (see
// mock-gas-server.mjs and the manual checks in the deployment guide).
//
// Fidelity choices that matter for the tests:
// - Sheets auto-conversion: a cell NOT formatted as plain text ('@') turns numeric
//   strings into numbers and TRUE/FALSE into booleans, like Google Sheets does;
//   a leading apostrophe forces text and is not returned on read.
// - Utilities returns signed bytes (-128..127) like the Java-backed originals.
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';

const signed = (buf) => Array.from(buf, (b) => (b > 127 ? b - 256 : b));
const unsigned = (arr) => Buffer.from(arr.map((b) => b & 0xff));
const toBuf = (v) => (typeof v === 'string' ? Buffer.from(v, 'utf8') : unsigned(v));

class Range {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getRow() { return this.row; }
  getValues() {
    const out = [];
    for (let r = 0; r < this.rows; r++) {
      const line = [];
      for (let c = 0; c < this.cols; c++) {
        const v = this.sheet.cells.get(`${this.row + r}:${this.col + c}`);
        line.push(v === undefined ? '' : v);
      }
      out.push(line);
    }
    return out;
  }
  setValues(values) {
    if (values.length !== this.rows || values.some((l) => l.length !== this.cols)) throw new Error('setValues: dimensions do not match the range');
    values.forEach((line, r) => line.forEach((v, c) => {
      const key = `${this.row + r}:${this.col + c}`;
      if (this.row + r > this.sheet.maxRows) throw new Error('setValues beyond the last row of the sheet');
      this.sheet.cells.set(key, this.sheet.convert(v, this.sheet.formats.get(key)));
    }));
    return this;
  }
  setNumberFormat(f) {
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) this.sheet.formats.set(`${this.row + r}:${this.col + c}`, f);
    return this;
  }
  setFontWeight() { return this; }
  createTextFinder(text) {
    const range = this;
    const finder = {
      matchEntireCell() { return finder; },
      matchCase() { return finder; },
      findNext() {
        for (let r = 0; r < range.rows; r++) for (let c = 0; c < range.cols; c++) {
          const v = range.sheet.cells.get(`${range.row + r}:${range.col + c}`);
          if (v !== undefined && String(v) === text) return new Range(range.sheet, range.row + r, range.col + c, 1, 1);
        }
        return null;
      }
    };
    return finder;
  }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.formats = new Map(); this.maxRows = 1000; this.frozen = 0; this.protections = []; }
  convert(v, format) {
    if (typeof v !== 'string') return v;
    if (v.startsWith("'")) return v.slice(1);                         // forced text
    if (format === '@') return v;
    if (v === 'TRUE') return true;
    if (v === 'FALSE') return false;
    if (v.trim() !== '' && /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(v.trim())) return Number(v);
    if (v.startsWith('=')) return `#FORMULA(${v})`;                     // would have been evaluated
    return v;
  }
  getName() { return this.name; }
  getLastRow() { let m = 0; for (const [k, v] of this.cells) if (v !== '' && v !== undefined) m = Math.max(m, Number(k.split(':')[0])); return m; }
  getLastColumn() { let m = 0; for (const [k, v] of this.cells) if (v !== '' && v !== undefined) m = Math.max(m, Number(k.split(':')[1])); return m; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(row, col, rows = 1, cols = 1) {
    if (row < 1 || col < 1 || rows < 1 || cols < 1) throw new Error(`getRange(${row},${col},${rows},${cols}): invalid range`);
    return new Range(this, row, col, rows, cols);
  }
  setFrozenRows(n) { this.frozen = n; }
  protect() { const p = { setDescription: () => p, setWarningOnly: () => p }; this.protections.push(p); return p; }
  getProtections() { return this.protections; }
  appendRow() { throw new Error('appendRow is not used by the backend (rows are written with a text format first)'); }
}

export function createGas() {
  const sheets = new Map();
  const properties = new Map();
  const cache = new Map();
  const logs = [];
  const ss = {
    getSheetByName: (n) => sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.set(n, s); return s; },
    getSheets: () => [...sheets.values()],
    deleteSheet: (s) => sheets.delete(s.name)
  };
  ss.insertSheet('Sheet1');
  let lockHeld = false;
  const globals = {
    console: { log: (...a) => logs.push(['log', a.join(' ')]), error: (...a) => logs.push(['error', a.join(' ')]), warn: (...a) => logs.push(['warn', a.join(' ')]) },
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      flush() {},
      ProtectionType: { SHEET: 'SHEET' },
      getUi() { throw new Error('No UI in tests'); }
    },
    Utilities: {
      getUuid: () => randomUUID(),
      newBlob: (s) => ({ getBytes: () => signed(Buffer.from(String(s), 'utf8')) }),
      DigestAlgorithm: { SHA_256: 'sha256' },
      Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, value) => signed(createHash(alg).update(toBuf(value)).digest()),
      computeHmacSha256Signature: (value, key) => signed(createHmac('sha256', toBuf(key)).update(toBuf(value)).digest()),
      base64Encode: (bytes) => (typeof bytes === 'string' ? Buffer.from(bytes) : unsigned(bytes)).toString('base64'),
      base64Decode: (s) => signed(Buffer.from(s, 'base64'))
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => properties.get(k) ?? null, setProperty: (k, v) => properties.set(k, String(v)) }) },
    CacheService: {
      getScriptCache: () => ({
        get: (k) => { const e = cache.get(k); if (!e) return null; if (e.until < Date.now()) { cache.delete(k); return null; } return e.v; },
        put: (k, v, ttl = 600) => { if (String(k).length > 250) throw new Error('cache key too long'); cache.set(k, { v: String(v), until: Date.now() + ttl * 1000 }); },
        remove: (k) => cache.delete(k)
      })
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => { if (lockHeld) throw new Error('lock already held by this execution (nested tryLock)'); lockHeld = true; return true; },
        releaseLock: () => { lockHeld = false; }
      })
    },
    ContentService: {
      MimeType: { JSON: 'application/json' },
      createTextOutput: (s) => { const o = { content: s, mime: 'text/plain', setMimeType(m) { o.mime = m; return o; }, getContent: () => o.content }; return o; }
    }
  };
  const context = vm.createContext({ ...globals, Date, JSON, Math, Object, Array, String, Number, RegExp, Error, isFinite, URLSearchParams });
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'apps-script');
  const source = readdirSync(dir).filter((f) => f.endsWith('.gs')).sort().map((f) => `// ---- ${f}\n${readFileSync(path.join(dir, f), 'utf8')}`).join('\n');
  vm.runInContext(source, context, { filename: 'apps-script.gs' });
  return {
    g: context, ss, sheets, properties, cache, logs,
    /** what the browser would get back from doPost */
    post: (body) => JSON.parse(context.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body), type: 'text/plain' } }).getContent()),
    isLockHeld: () => lockHeld
  };
}
