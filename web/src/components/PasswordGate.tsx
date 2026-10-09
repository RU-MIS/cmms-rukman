'use client';
import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { sb } from '@/lib/supabase';
import { useSession, type PasswordPolicy } from '@/lib/session';
import { Button, Card, Field, Input, useAction } from './ui';
import { UserMenu } from './AppShell';

/**
 * Password rules of the company (Security settings; the strictest over the
 * user's companies). The admin-users function enforces the same policy and
 * Supabase Auth its own minimum.
 */
export function passwordProblem(pw: string, repeat: string, policy?: PasswordPolicy): string | null {
  const min = Math.max(policy?.min_length ?? 10, 8);
  if (pw.length < min) return `Password must have at least ${min} characters`;
  if ((policy?.require_mixed ?? true) && (!/[A-Za-z]/.test(pw) || !/\d/.test(pw))) return 'Use letters and digits';
  if (pw !== repeat) return 'Passwords do not match';
  return null;
}

/**
 * A login with a temporary password (created or reset by an administrator)
 * must choose its own password before anything else. The database refuses
 * every business call until then (must_change_password); this screen is the
 * way out.
 */
export function PasswordGate({ children }: { children: ReactNode }) {
  const { session, boot, refresh } = useSession();
  const path = usePathname();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, run } = useAction();
  if (!session || !boot?.must_change_password || path.startsWith('/login')) return <>{children}</>;
  if (boot.temp_password_expired) {
    return (
      <div className="mx-auto max-w-md p-4 pt-10">
        <div className="mb-4 flex justify-end"><UserMenu /></div>
        <Card title="Temporary password expired">
          <p role="alert" className="text-sm text-slate-700">
            The temporary password for <b>{boot.email}</b> has expired. Ask your administrator for a new password.
          </p>
        </Card>
      </div>
    );
  }
  return (
    <div className="mx-auto max-w-md p-4 pt-10">
      <div className="mb-4 flex justify-end"><UserMenu /></div>
      <Card title="Choose your own password">
        <p className="mb-3 text-sm text-slate-600">
          You signed in with a temporary password for <b>{boot.email}</b>. Choose a new password to continue.
        </p>
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            const problem = passwordProblem(pw, pw2, boot.password_policy);
            if (problem) throw new Error(problem);
            const { error } = await sb().auth.updateUser({ password: pw });
            if (error) throw error;
            setPw(''); setPw2('');
            await refresh();
          }, 'Password changed');
        }}>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button type="submit" busy={busy}>Save password and continue</Button>
        </form>
      </Card>
    </div>
  );
}
