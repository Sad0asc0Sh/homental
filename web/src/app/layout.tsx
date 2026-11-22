import type { Metadata, Viewport } from 'next';
import { Vazirmatn } from 'next/font/google';
import { AppHeader } from '@/components/layout/AppHeader';
import './globals.css';

const vazirmatn = Vazirmatn({
  subsets: ['arabic'],
  variable: '--font-vazir',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'هومنتال — مشاور و طراح هوشمند امنیت',
  description:
    'هومنتال: طراحی هوشمند چرخه کامل امنیت (مشاوره، قیمت‌گذاری شفاف، اعزام کارشناس، گارانتی دیجیتال) — فاز پایلوت مشهد.',
};

export const viewport: Viewport = {
  themeColor: '#0f2438',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body className={`${vazirmatn.variable} min-h-screen font-sans`}>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
