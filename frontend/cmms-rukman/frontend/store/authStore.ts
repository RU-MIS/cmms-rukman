'use client';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import api, { setAccessToken, clearAccessToken } from '@/lib/api';
import toast from 'react-hot-toast';

export interface AuthUser {
  userId: string; employeeCode: string; fullName: string; username: string;
  roleId: string; roleName: string; deptId: string; deptName: string;
  shiftId: string; shiftName: string; permissions: Record<string, string[]>;
}

interface AuthState {
  user: AuthUser | null; isLoading: boolean; isHydrated: boolean;
  login: (u: string, p: string, r?: boolean) => Promise<boolean>;
  logout: () => Promise<void>;
  setUser: (u: AuthUser | null) => void;
  setHydrated: () => void;
  hasPermission: (mod: string, action: string) => boolean;
  isRole: (role: string | string[]) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null, isLoading: false, isHydrated: false,
      setHydrated: () => set({ isHydrated: true }),
      setUser: (user) => set({ user }),

      login: async (username, password, rememberMe = false) => {
        set({ isLoading: true });
        try {
          const { data } = await api.post('/auth/login', { username, password, rememberMe });
          if (data.success) {
            setAccessToken(data.data.accessToken);
            set({ user: data.data.user, isLoading: false });
            toast.success(`Welcome back, ${data.data.user.fullName.split(' ')[0]}!`);
            return true;
          }
          return false;
        } catch { set({ isLoading: false }); return false; }
      },

      logout: async () => {
        try { await api.post('/auth/logout'); } catch {} finally {
          clearAccessToken(); set({ user: null });
          if (typeof window !== 'undefined') window.location.href = '/login';
        }
      },

      hasPermission: (mod, action) => {
        const { user } = get();
        if (!user) return false;
        if (user.roleName === 'Admin') return true;
        return user.permissions[mod]?.includes(action) ?? false;
      },

      isRole: (role) => {
        const { user } = get();
        if (!user) return false;
        return (Array.isArray(role) ? role : [role]).includes(user.roleName);
      },
    }),
    {
      name: 'cmms-auth',
      storage: createJSONStorage(() =>
        typeof window !== 'undefined' ? sessionStorage : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
      ),
      partialize: (state) => ({ user: state.user }),
    }
  )
);
