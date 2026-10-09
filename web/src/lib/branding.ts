'use client';
import { useEffect, useState } from 'react';
import { brand, sb } from './supabase';

/** Company branding (company_branding row, sent with the session). Empty values fall back to the instance (env) branding. */
export interface Branding {
  app_name?: string | null; short_name?: string | null; primary_color?: string | null;
  logo_path?: string | null; favicon_path?: string | null; document_footer?: string | null;
  email_from_name?: string | null; email_reply_to?: string | null;
}

export const ASSET_BUCKET = 'company-assets';
export const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/x-icon', 'image/vnd.microsoft.icon'];
export const ASSET_MAX_BYTES = 1024 * 1024;

const hex = (h: string) => /^#[0-9a-f]{6}$/i.test(h);
function lum(h: string): number {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** WCAG contrast ratio of two #rrggbb colours. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/**
 * The brand colour carries white text (buttons, active menu). A colour that
 * would make that text unreadable is darkened until it reaches WCAG AA 4.5:1.
 */
export function readableBrand(color: string | null | undefined): string {
  let c = color && hex(color) ? color.toLowerCase() : brand.color;
  for (let i = 0; i < 40 && contrastRatio(c, '#ffffff') < 4.5; i++) {
    c = '#' + [1, 3, 5].map((j) => Math.max(0, Math.round(parseInt(c.slice(j, j + 2), 16) * 0.9)).toString(16).padStart(2, '0')).join('');
  }
  return c;
}

/** Short-lived signed URL of a private branding file (members / portal users of the company only). */
export function useAssetUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!path) { setUrl(null); return; }
    sb().storage.from(ASSET_BUCKET).createSignedUrl(path, 3600)
      .then(({ data }) => { if (alive) setUrl(data?.signedUrl ?? null); }, () => { if (alive) setUrl(null); });
    return () => { alive = false; };
  }, [path]);
  return url;
}

/** Applies a company's branding to the page: colour, title, favicon. */
export function useApplyBranding(b: Branding | null | undefined, suffix?: string) {
  const favicon = useAssetUrl(b?.favicon_path);
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--brand', readableBrand(b?.primary_color));
    const name = b?.app_name || brand.name;
    document.title = suffix ? `${suffix} · ${name}` : name;
  }, [b?.primary_color, b?.app_name, suffix]);
  useEffect(() => {
    if (!favicon) return;
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = favicon;
  }, [favicon]);
}
