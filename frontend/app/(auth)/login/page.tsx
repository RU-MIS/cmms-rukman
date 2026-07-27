'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Eye, EyeOff, Shield, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';

const schema = z.object({
  username:   z.string().min(3, 'Min 3 characters'),
  password:   z.string().min(4, 'Min 4 characters'),
  rememberMe: z.boolean().optional(),
});
type Form = z.infer<typeof schema>;

export default function LoginPage() {
  const router = useRouter();
  const { login, user, isLoading } = useAuthStore();
  const [showPass, setShowPass] = useState(false);

  useEffect(() => { if (user) router.replace('/dashboard'); }, [user, router]);

  const { register, handleSubmit, formState: { errors } } = useForm<Form>({
    resolver: zodResolver(schema),
    defaultValues: { username: '', password: '', rememberMe: false },
  });

  const onSubmit = async (d: Form) => {
    const ok = await login(d.username, d.password, d.rememberMe);
    if (ok) router.replace('/dashboard');
  };

  return (
    <div className="min-h-screen bg-[#F5FEFF] flex">
      {/* Left branding panel */}
      <div className="hidden lg:flex lg:w-[45%] bg-[#0E2F76] flex-col justify-between p-12 relative overflow-hidden">
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-20 left-20 w-64 h-64 rounded-full bg-white" />
          <div className="absolute bottom-32 right-16 w-96 h-96 rounded-full bg-white" />
        </div>
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-xl">CMMS Pro</div>
            <div className="text-white/60 text-xs">Rukman Udyog</div>
          </div>
        </div>
        <div className="relative z-10">
          <h1 className="text-white font-bold text-4xl leading-tight mb-4">Maintenance<br/>Made Simple</h1>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">Track inspections, assign tasks, verify compliance — all from one place.</p>
          <div className="flex gap-8 mt-10">
            {[['500+','Employees'],['7','Departments'],['100%','Compliance']].map(([v,l]) => (
              <div key={l}>
                <div className="text-white font-bold text-2xl">{v}</div>
                <div className="text-white/60 text-xs mt-0.5">{l}</div>
              </div>
            ))}
          </div>
        </div>
        <p className="relative z-10 text-white/40 text-xs">© 2024 Rukman Udyog</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-[400px]">
          <div className="flex lg:hidden items-center gap-2 mb-8">
            <div className="w-8 h-8 bg-[#0E2F76] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg text-[#0E2F76]">CMMS Pro</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-semibold text-[#0A1F4E]">Welcome back</h2>
            <p className="text-[#7A9CC0] text-sm mt-1">Sign in to your account to continue</p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Username</label>
              <input {...register('username')} type="text" placeholder="Enter your username" autoFocus
                className={`w-full border rounded-lg px-3 py-2.5 text-sm text-[#0A1F4E] bg-white placeholder:text-[#7A9CC0] focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76] transition-colors ${errors.username ? 'border-red-400' : 'border-[#AAC0E1]'}`} />
              {errors.username && <p className="text-xs text-red-500 mt-1">{errors.username.message}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#3A5A8A] uppercase tracking-wide mb-1.5">Password</label>
              <div className="relative">
                <input {...register('password')} type={showPass ? 'text' : 'password'} placeholder="Enter your password"
                  className={`w-full border rounded-lg px-3 py-2.5 pr-10 text-sm text-[#0A1F4E] bg-white placeholder:text-[#7A9CC0] focus:outline-none focus:ring-2 focus:ring-[#0E2F76]/20 focus:border-[#0E2F76] transition-colors ${errors.password ? 'border-red-400' : 'border-[#AAC0E1]'}`} />
                <button type="button" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A9CC0] hover:text-[#3A5A8A]">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-500 mt-1">{errors.password.message}</p>}
            </div>

            <div className="flex items-center gap-2">
              <input {...register('rememberMe')} id="rm" type="checkbox" className="w-4 h-4 accent-[#0E2F76] cursor-pointer" />
              <label htmlFor="rm" className="text-sm text-[#3A5A8A] cursor-pointer">Keep me signed in for 7 days</label>
            </div>

            <button type="submit" disabled={isLoading}
              className="w-full bg-[#0E2F76] text-white font-medium py-2.5 rounded-lg text-base hover:bg-[#071E52] active:scale-95 transition-all disabled:opacity-50 flex items-center justify-center gap-2">
              {isLoading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : 'Sign in'}
            </button>
          </form>

          <div className="mt-8 pt-6 border-t border-[#D4E4F7]">
            <p className="text-xs text-[#7A9CC0] text-center">
              Forgot password? Contact your <span className="text-[#0E2F76] font-medium">system administrator</span>
            </p>
          </div>
          <p className="text-xs text-[#7A9CC0] text-center mt-4">CMMS Pro v1.0 · Rukman Udyog</p>
        </div>
      </div>
    </div>
  );
}
