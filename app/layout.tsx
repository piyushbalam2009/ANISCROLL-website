import type { Metadata } from 'next';
import './globals.css';
import { AppShell } from '@/components/layout/AppShell';
import { AuthProvider } from '@/contexts/AuthContext';
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_NAME,
  DEFAULT_SITE_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_MIME_TYPE,
  OG_IMAGE_WIDTH,
  resolveCanonicalOrigin,
} from '@/lib/social-metadata';

const siteOrigin = resolveCanonicalOrigin();
const siteOgImage = `${siteOrigin}/api/og/site`;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: {
    default: DEFAULT_SITE_TITLE,
    template: '%s — AniScroll',
  },
  description: DEFAULT_SITE_DESCRIPTION,
  applicationName: DEFAULT_SITE_NAME,
  alternates: {
    canonical: siteOrigin,
  },
  openGraph: {
    title: DEFAULT_SITE_TITLE,
    description: DEFAULT_SITE_DESCRIPTION,
    type: 'website',
    siteName: DEFAULT_SITE_NAME,
    url: siteOrigin,
    images: [
      {
        url: siteOgImage,
        secureUrl: siteOgImage,
        alt: DEFAULT_SITE_TITLE,
        type: OG_IMAGE_MIME_TYPE,
        width: OG_IMAGE_WIDTH,
        height: OG_IMAGE_HEIGHT,
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: DEFAULT_SITE_TITLE,
    description: DEFAULT_SITE_DESCRIPTION,
    images: [
      {
        url: siteOgImage,
        alt: DEFAULT_SITE_TITLE,
      },
    ],
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
