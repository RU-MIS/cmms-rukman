import type { Metadata, Viewport } from 'next';
import { Providers } from '@/components/Providers';
import './globals.css';

const name = process.env.NEXT_PUBLIC_APP_NAME ?? 'Rukman Dataflow Management System';
const color = process.env.NEXT_PUBLIC_PRIMARY_COLOR ?? '#1f4e79';

const favicon = process.env.NEXT_PUBLIC_FAVICON_URL;
export const metadata: Metadata = {
  title: name,
  description: `${name} — inventory, purchase, sales, documents and payments`,
  ...(favicon ? { icons: { icon: favicon } } : {}),
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" style={{ ['--brand' as string]: color }}>
      <body><Providers>{children}</Providers></body>
    </html>
  );
}
