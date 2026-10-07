'use client';
import { useState } from 'react';
import Link from 'next/link';
import { sb } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, Card, Field, Input, PageHeader, Spinner, useAction } from '@/components/ui';
import { UserMenu } from '@/components/AppShell';

export default function AccountPage() {
  const { ready, session, boot } = useSession();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, run } = useAction();
  if (!ready) return <Spinner />;
  if (!session || !boot) return <div className="p-6">Please <Link className="text-brand underline" href="/login/">sign in</Link>.</div>;
  return (
    <div className="mx-auto max-w-lg p-4">
      <div className="mb-4 flex justify-between"><Link href="/" className="text-brand">← Back</Link><UserMenu /></div>
      <PageHeader title="My account" subtitle={boot.email} />
      <Card title="Change password">
        <form className="space-y-3" onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            if (pw.length < 8) throw new Error('Password must have at least 8 characters');
            if (pw !== pw2) throw new Error('Passwords do not match');
            const { error } = await sb().auth.updateUser({ password: pw });
            if (error) throw error;
            setPw(''); setPw2('');
          }, 'Password changed');
        }}>
          <Field label="New password"><Input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
          <Field label="Repeat new password"><Input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
          <Button type="submit" busy={busy}>Save password</Button>
        </form>
      </Card>
    </div>
  );
}
