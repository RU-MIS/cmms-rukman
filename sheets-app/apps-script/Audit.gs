/**
 * Audit log: append-only sheet of important actions. Never contains passwords,
 * tokens or hashes (details are filtered by key before they are written).
 */

var AUDIT_SECRET_KEYS_ = /pass|token|hash|secret|pepper/i;

function scrubDetails_(details) {
  var out = {};
  Object.keys(details || {}).forEach(function (k) {
    if (AUDIT_SECRET_KEYS_.test(k)) return;
    var v = details[k];
    out[k] = v !== null && typeof v === 'object' ? scrubDetails_(v) : v;
  });
  return out;
}

/** Appends one audit row (under the script lock; re-entrant, so callers may already hold it). */
function writeAudit_(user, action, target, result, details) {
  appendRecord_('AuditLog', {
    auditId: Utilities.getUuid(),
    at: nowIso_(),
    userId: user ? user.userId : '',
    username: user ? user.username : '',
    action: action,
    target: String(target || '').slice(0, 120),
    result: result,
    details: JSON.stringify(scrubDetails_(details)).slice(0, 2000)
  });
}

function listAudit_(ctx, data) {
  var limit = Math.max(1, Math.min(LIMITS.auditPageSize, Number(data && data.limit) || 50));
  var skip = Math.max(0, Number(data && data.skip) || 0);
  var rows = readLast_('AuditLog', limit, skip).reverse();
  return {
    entries: rows.map(function (r) {
      return { at: r.at, username: r.username, action: r.action, target: r.target, result: r.result, details: r.details };
    }),
    total: countRows_('AuditLog'),
    skip: skip,
    limit: limit
  };
}
