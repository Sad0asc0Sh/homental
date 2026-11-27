import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import { CustomerBottomNav } from '@/components/layout/CustomerBottomNav';
import { CustomerHeader } from '@/components/layout/CustomerHeader';
import { CustomerRoleGate } from '@/components/layout/CustomerRoleGate';
import { PwaRuntime } from '@/components/layout/PwaRuntime';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic'],
  variable: '--font-vazir',
  display: 'swap',
});

export const metadata: Metadata = {
  applicationName: 'هومنتال',
  title: 'هومنتال — مشاور و طراح هوشمند امنیت',
  description:
    'هومنتال: طراحی هوشمند چرخه کامل امنیت (مشاوره، قیمت‌گذاری شفاف، اعزام کارشناس، گارانتی دیجیتال) — فاز پایلوت مشهد.',
  appleWebApp: {
    capable: true,
    title: 'هومنتال',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  themeColor: '#0f2438',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} min-h-[100dvh] font-sans`}>
        <PwaRuntime />
        <CustomerHeader />
        <div className="safe-bottom-nav-offset md:pb-0">
          <CustomerRoleGate>{children}</CustomerRoleGate>
        </div>
        <CustomerBottomNav />
      </body>
    </html>
  );
}
