import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import { PartnerRoleGate } from '@/components/layout/PartnerRoleGate';
import { PartnersBottomNav } from '@/components/layout/PartnersBottomNav';
import { PartnersHeader } from '@/components/layout/PartnersHeader';
import { PwaRuntime } from '@/components/layout/PwaRuntime';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic'],
  variable: '--font-vazir',
  display: 'swap',
});

export const metadata: Metadata = {
  applicationName: 'هومنتال همکاران',
  title: 'هومنتال همکاران — پنل کارشناسان، فروشندگان و مدیریت',
  description:
    'سامانه یکپارچه همکاران هومنتال: پنل نصاب‌ها، تأمین کالا، فروشندگان، مدیریت شعب و ابرادمین.',
  appleWebApp: {
    capable: true,
    title: 'هومنتال همکاران',
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
  themeColor: '#064e3b',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} min-h-[100dvh] font-sans`}>
        <PwaRuntime />
        <PartnersHeader />
        <div className="safe-bottom-nav-offset md:pb-0">
          <PartnerRoleGate>{children}</PartnerRoleGate>
        </div>
        <PartnersBottomNav />
      </body>
    </html>
  );
}
