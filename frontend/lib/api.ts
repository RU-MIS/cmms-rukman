import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import toast from 'react-hot-toast';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 15000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let accessToken: string | null = null;
export const getAccessToken   = () => accessToken;
export const setAccessToken   = (t: string) => { accessToken = t; };
export const clearAccessToken = () => { accessToken = null; };

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let isRefreshing = false;
let queue: Array<{ resolve: (t: string) => void; reject: (e: unknown) => void }> = [];
const processQueue = (err: unknown, token: string | null = null) => {
  queue.forEach(p => err ? p.reject(err) : p.resolve(token!));
  queue = [];
};

api.interceptors.response.use(
  r => r,
  async (error: AxiosError<{ message: string }>) => {
    const orig = error.config as InternalAxiosRequestConfig & { _retry?: boolean };
    if (error.response?.status === 401 && !orig._retry) {
      if (isRefreshing) {
        return new Promise((res, rej) => queue.push({ resolve: res, reject: rej }))
          .then(t => { orig.headers.Authorization = `Bearer ${t}`; return api(orig); });
      }
      orig._retry = true; isRefreshing = true;
      try {
        const { data } = await api.post('/auth/refresh');
        const t = data.data.accessToken;
        setAccessToken(t); processQueue(null, t);
        orig.headers.Authorization = `Bearer ${t}`;
        return api(orig);
      } catch (e) {
        processQueue(e, null); clearAccessToken();
        if (typeof window !== 'undefined') window.location.href = '/login';
        return Promise.reject(e);
      } finally { isRefreshing = false; }
    }
    const msg = error.response?.data?.message || 'Something went wrong';
    if (error.response?.status !== 401) toast.error(msg);
    return Promise.reject(error);
  }
);

export default api;
