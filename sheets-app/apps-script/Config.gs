/**
 * Rukman Dataflow Management System — Apps Script backend
 * Configuration: sheet layouts, roles, permissions and limits.
 *
 * All files of this project share one global scope (Apps Script). Names that
 * end with "_" are private: they cannot be run from the editor's Run menu and
 * are never reachable from the web app (only API_ACTIONS in Api.gs are).
 */

var APP_NAME = 'Rukman Dataflow Management System';

// Sheet (tab) names and their column headers. The header row is written by
// setupDatabase(); code always addresses columns by header name, never by position.
var SHEETS = {
  Settings: ['key', 'value', 'description', 'updatedAt', 'updatedBy'],
  Users: ['userId', 'username', 'displayName', 'email', 'role', 'status', 'passwordHash', 'mustChangePassword',
          'failedAttempts', 'lockedUntil', 'lastLoginAt', 'passwordChangedAt', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  Sessions: ['sessionId', 'tokenHash', 'userId', 'createdAt', 'lastSeenAt', 'expiresAt', 'revokedAt', 'userAgent'],
  AuditLog: ['auditId', 'at', 'userId', 'username', 'action', 'target', 'result', 'details']
};

// Defaults written to the Settings sheet by setupDatabase(); the sheet values win afterwards.
var DEFAULT_SETTINGS = {
  appName: [APP_NAME, 'Name shown in the application'],
  sessionIdleMinutes: ['30', 'Sign out after this many minutes without activity'],
  sessionMaxHours: ['12', 'Maximum length of one session, in hours'],
  lockoutThreshold: ['5', 'Failed logins before the account is locked'],
  lockoutMinutes: ['15', 'How long a locked account stays locked'],
  passwordMinLength: ['10', 'Minimum password length (8 to 64)']
};

var ROLES = ['Admin', 'Manager', 'Staff'];

// Server-side permission map. The browser never sends a role: the role always
// comes from the Users sheet of the signed-in user.
var ROLE_PERMISSIONS = {
  Admin:   ['dashboard.view', 'users.view', 'users.manage', 'audit.view'],
  Manager: ['dashboard.view', 'users.view', 'audit.view'],
  Staff:   ['dashboard.view']
};

var USER_STATUS = ['ACTIVE', 'DISABLED'];

var LIMITS = {
  maxRequestBytes: 64 * 1024,     // larger request bodies are refused
  pbkdf2Iterations: 5000,          // stored with each hash, so it can be raised later
  globalFailedLoginsPer10Min: 200, // brute-force brake across all accounts
  lockWaitMs: 20000,               // wait for the script lock before giving up
  sessionCacheSeconds: 300,        // how long a validated session is cached
  touchSessionEverySeconds: 300,   // lastSeenAt is written at most this often
  auditPageSize: 100,
  maxTextLength: 200
};
