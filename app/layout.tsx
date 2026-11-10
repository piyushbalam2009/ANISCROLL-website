import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/contexts/AuthContext';

export const metadata: Metadata = {
  title: 'AniScroll — Premium Monochrome Anime Streaming',
  description:
    'Premium anime streaming platform with minimalist monochrome design, real-time search, AniList resolution, HLS playback, and AniSkip intro detection.',
  openGraph: {
    title: 'AniScroll — Premium Monochrome Anime Streaming',
    description:
      'Premium anime streaming platform with minimalist monochrome design, real-time search, AniList resolution, HLS playback, and AniSkip intro detection.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AniScroll — Premium Monochrome Anime Streaming',
    description:
      'Premium anime streaming platform with minimalist monochrome design, real-time search, AniList resolution, HLS playback, and AniSkip intro detection.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body suppressHydrationWarning className="bg-[#000000] text-white antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
