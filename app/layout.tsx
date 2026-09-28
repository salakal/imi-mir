import type { Metadata, Viewport } from 'next';
import './globals.css';

const description = 'Расписание, задолженности, сессии и учебная информация для студентов МИР.';
const canonical = 'https://imi-mir.vercel.app';
export const metadata: Metadata = {
  metadataBase: new URL(canonical), title: 'IMI — учёба в одном месте', description,
  applicationName: 'IMI', alternates: { canonical: '/' }, manifest: '/manifest.webmanifest',
  icons: { icon: '/favicon.svg', shortcut: '/favicon.svg', apple: '/brand/icon-192.png' },
  openGraph: { type: 'website', title: 'IMI — учёба в одном месте', description, url: '/', siteName: 'IMI', images: [{ url: '/brand/og.png', width: 1200, height: 630, alt: 'IMI — студенческий сервис МИР' }] },
  twitter: { card: 'summary_large_image', title: 'IMI — учёба в одном месте', description, images: ['/brand/og.png'] },
};
export const viewport: Viewport = { themeColor: '#254685' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ru"><body className="antialiased">{children}</body></html>;
}
