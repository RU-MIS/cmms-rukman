import type { Metadata, Viewport } from 'next';
import { Inter, Poppins } from 'next/font/google';
import { Toaster } from 'react-hot-toast';
import { Providers } from '@/components/shared/Providers';
import './globals.css';

const inter    = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const poppins  = Poppins({ subsets: ['latin'], weight: ['500','600','700'], variable: '--font-poppins', display: 'swap' });

export const metadata: Metadata = {
  title:       'CMMS Pro — Rukman Udyog',
  description: 'Enterprise Maintenance Inspection Management System',
  manifest:    '/manifest.json',
  icons: { icon: '/icons/icon-192.png', apple: '/icons/icon-192.png' },
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'CMMS Pro' },
};

export const viewport: Viewport = {
  width: 'device-width', initialScale: 1, maximumScale: 1, themeColor: '#0E2F76',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${poppins.variable}`}>
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
      </head>
      <body className="font-sans bg-surface-app text-text-primary antialiased">
        <Providers>
          {children}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#fff', color: '#0A1F4E',
                border: '0.5px solid #D4E4F7', borderRadius: '10px',
                fontSize: '13px', fontWeight: '500',
                boxShadow: '0 4px 16px rgba(14,47,118,0.12)',
              },
              success: { iconTheme: { primary: '#16A34A', secondary: '#fff' }, style: { borderLeft: '3px solid #16A34A' } },
              error:   { iconTheme: { primary: '#DC2626', secondary: '#fff' }, style: { borderLeft: '3px solid #DC2626' } },
            }}
          />
        </Providers>
      </body>
    </html>
  );
}
