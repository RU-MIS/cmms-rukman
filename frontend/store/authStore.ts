import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface AuthUser {
  id: number;
  username: string;
  name: string;
  email?: string | null;
  isSuperAdmin?: boolean;
  mustChangePassword?: boolean;
}

export interface CompanyRef {
  id: number;
  name: string;
  role: string;
}

interface AuthState {
  token: string | null;
  user: AuthUser | null;
  activeCompany: CompanyRef | null;
  companies: CompanyRef[];
  hasHydrated: boolean;
  setAuth: (token: string, user: AuthUser, activeCompany: CompanyRef, companies: CompanyRef[]) => void;
  setActiveCompany: (token: string, activeCompany: CompanyRef) => void;
  setMustChangePassword: (v: boolean) => void;
  logout: () => void;
  setHasHydrated: (v: boolean) => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      activeCompany: null,
      companies: [],
      hasHydrated: false,
      setAuth: (token, user, activeCompany, companies) => set({ token, user, activeCompany, companies }),
      setActiveCompany: (token, activeCompany) => set({ token, activeCompany }),
      setMustChangePassword: (v) => set((s) => (s.user ? { user: { ...s.user, mustChangePassword: v } } : {})),
      logout: () => set({ token: null, user: null, activeCompany: null, companies: [] }),
      setHasHydrated: (v) => set({ hasHydrated: v }),
    }),
    {
      name: 'bf-erp-auth',
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
