'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Boxes, Loader2, Building2, ShieldCheck, BarChart3 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api, apiErrorMessage } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const token = useAuthStore((s) => s.token);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (token) router.replace('/dashboard');
  }, [token, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      setAuth(res.data.data.token, res.data.data.user, res.data.data.activeCompany, res.data.data.companies);
      toast.success(`Welcome back, ${res.data.data.user.name}`);
      router.replace('/dashboard');
    } catch (err) {
      toast.error(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-app-bg">
      {/* Brand panel */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[45%] relative overflow-hidden bg-sidebar text-white flex-col justify-between p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-brand-700/40 via-transparent to-brand-900/60" />
        <div className="absolute -right-24 -top-24 w-96 h-96 rounded-full bg-brand-500/10" />
        <div className="absolute -left-16 bottom-0 w-72 h-72 rounded-full bg-brand-400/10" />

        <div className="relative flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
            <Boxes size={18} className="text-white" />
          </div>
          <span className="font-semibold tracking-wide">BusinessFlow ERP</span>
        </div>

        <div className="relative space-y-8 max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">
            One cloud ERP.<br />Every company you run.
          </h2>
          <p className="text-white/60 text-sm leading-relaxed">
            Sales, purchases, inventory, accounts and reports — for as many companies
            as you manage, isolated and switchable from a single login.
          </p>
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <Building2 size={17} />
              </div>
              <p className="text-sm text-white/80">Create or switch between company workspaces instantly</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <ShieldCheck size={17} />
              </div>
              <p className="text-sm text-white/80">Role-based access with full company-wise data isolation</p>
            </div>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center shrink-0">
                <BarChart3 size={17} />
              </div>
              <p className="text-sm text-white/80">Live dashboards, GST-ready invoices and inventory ledgers</p>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} BusinessFlow ERP</p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center mb-6 lg:hidden">
            <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center mb-3">
              <Boxes size={24} className="text-white" />
            </div>
            <h1 className="text-lg font-semibold text-ink">BusinessFlow ERP</h1>
          </div>
          <div className="mb-6 hidden lg:block">
            <h1 className="text-xl font-semibold text-ink">Sign in to your account</h1>
            <p className="text-sm text-ink-muted mt-1">Welcome back — pick up where you left off.</p>
          </div>

          <form onSubmit={handleSubmit} className="card p-5 space-y-4">
            <div>
              <label className="label">Username</label>
              <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
            </div>
            <div>
              <div className="flex items-center justify-between">
                <label className="label !mb-0">Password</label>
                <Link href="/forgot-password" className="text-xs text-brand-600 hover:underline">Forgot password?</Link>
              </div>
              <input className="input mt-1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading && <Loader2 size={15} className="animate-spin" />}
              Sign In
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
