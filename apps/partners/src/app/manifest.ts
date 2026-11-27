import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'هومنتال همکاران',
    short_name: 'همکاران هومنتال',
    description: 'سامانه یکپارچه نصاب‌ها، تأمین کالا، فروشندگان و مدیریت شعب هومنتال',
    dir: 'rtl',
    lang: 'fa',
    display: 'standalone',
    orientation: 'portrait',
    start_url: '/',
    id: '/',
    theme_color: '#064e3b',
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
