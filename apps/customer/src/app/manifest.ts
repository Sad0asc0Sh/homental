import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'هومنتال — مشاور و خدمات هوشمند امنیت',
    short_name: 'هومنتال',
    description:
      'طراحی هوشمند چرخه کامل امنیت، قیمت‌گذاری شفاف، اعزام کارشناس و گارانتی دیجیتال',
    dir: 'rtl',
    lang: 'fa',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    id: '/',
    theme_color: '#0f2438',
    background_color: '#f8fafc',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
        purpose: 'any',
      },
    ],
  };
}
