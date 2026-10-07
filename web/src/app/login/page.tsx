'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { brand, errorText, sb } from '@/lib/supabase';
import { useSession } from '@/lib/session';
import { Button, ErrorBox, Field, Input, Tabs } from '@/components/ui';

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const { ready, session, boot } = useSession();
  const [mode, setMode] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (ready && session && boot) {
      // only same-site paths ("/x", never "//host" or "/\\host") — no open redirect
      const safeNext = next && /^\/(?![\/\\])/.test(next) ? next : null;
      router.replace(safeNext ?? (boot.companies.length ? '/erp/' : '/portal/'));
    }
  }, [ready, session, boot, next, router]);

  async function act(fn: () => Promise<void>) {
    setBusy(true); setError(null); setInfo(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }

  const loginPassword = () => act(async () => {
    const { error: e } = await sb().auth.signInWithPassword({ email: email.trim(), password });
    if (e) throw e;
  });
  const sendCode = () => act(async () => {
    const { error: e } = await sb().auth.signInWithOtp({ email: email.trim(), options: { shouldCreateUser: true } });
    if (e) throw e;
    setCodeSent(true);
    setInfo(`A login code has been sent to ${email.trim()}. It is valid for a few minutes.`);
  });
  const verifyCode = () => act(async () => {
    const { error: e } = await sb().auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
    if (e) throw e;
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-brand-light p-4">
      <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-6 shadow-lg">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {brand.logo && <img src={brand.logo} alt="" className="mb-3 h-10 w-auto" />}
        <h1 className="text-lg font-semibold text-slate-800">{brand.name}</h1>
        <p className="mb-4 text-sm text-slate-500">Sign in to the ERP, customer portal or vendor portal.</p>
        <Tabs tabs={[{ id: 'password', label: 'Password' }, { id: 'code', label: 'Email code (OTP)' }]} active={mode}
          onChange={(m) => { setMode(m); setError(null); setInfo(null); }} />
        <ErrorBox error={error} />
        {info && <div className="mb-3 rounded-md bg-sky-50 px-3 py-2 text-sm text-sky-700">{info}</div>}
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault();
          if (mode === 'password') loginPassword(); else if (codeSent) verifyCode(); else sendCode(); }}>
          <Field label="Email"><Input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          {mode === 'password' && (
            <Field label="Password"><Input type="password" autoComplete="current-password" required value={password}
              onChange={(e) => setPassword(e.target.value)} /></Field>
          )}
          {mode === 'code' && codeSent && (
            <Field label="Code from the email"><Input inputMode="numeric" autoComplete="one-time-code" required value={code}
              onChange={(e) => setCode(e.target.value)} /></Field>
          )}
          <Button type="submit" busy={busy} className="w-full">
            {mode === 'password' ? 'Sign in' : codeSent ? 'Verify code' : 'Send login code'}
          </Button>
        </form>
        <p className="mt-4 text-xs text-slate-500">
          Forgot your password? Use <button className="text-brand underline" onClick={() => setMode('code')}>Email code</button>,
          then set a new password under My account.
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return <Suspense><LoginForm /></Suspense>;
}
