/**
 * auth.types.ts
 * ─────────────
 * All TypeScript interfaces for the Auth module.
 * Imported by auth.service, auth.controller, and middleware.
 */

// ── Request body types ───────────────────────────────────────────

export interface LoginRequest {
  username: string;
  password: string;
  rememberMe?: boolean;
}

export interface RefreshTokenRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword:     string;
  confirmPassword: string;
}

// ── Response types ───────────────────────────────────────────────

export interface AuthUser {
  userId:       string;
  employeeCode: string;
  fullName:     string;
  username:     string;
  roleId:       string;
  roleName:     string;
  deptId:       string;
  deptName:     string;
  shiftId:      string;
  shiftName:    string;
  permissions:  Record<string, string[]>;
}

export interface LoginResponse {
  user:         AuthUser;
  accessToken:  string;
  refreshToken: string;
  expiresIn:    number; // seconds
}

export interface TokenPayload {
  userId:   string;
  username: string;
  roleId:   string;
  roleName: string;
  deptId:   string;
  iat?:     number;
  exp?:     number;
}

// ── Express augmentation — add user to Request ───────────────────
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      token?: string;
    }
  }
}
