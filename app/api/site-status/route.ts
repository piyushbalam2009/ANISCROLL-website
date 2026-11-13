import { NextResponse } from 'next/server';
import {
  fetchFirestoreDocumentServer,
  listFirestoreCollectionRest,
} from '@/lib/firebase-admin';
import { DEFAULT_SITE_CONFIG } from '@/lib/admin/admin-firestore';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const [siteConfig, announcementDocs] = await Promise.all([
      fetchFirestoreDocumentServer('siteConfig', 'global').catch(() => null),
      listFirestoreCollectionRest('announcements', 50).catch(() => []),
    ]);

    const nowIso = new Date().toISOString();
    const activeAnnouncements = announcementDocs
      .map((d) => d.data)
      .filter((item: any) => {
        if (!item) return false;
        if (item.status === 'draft' || item.status === 'archived') return false;
        if (item.startsAt && item.startsAt > nowIso && item.status === 'scheduled') {
          return false;
        }
        if (item.expiresAt && item.expiresAt < nowIso) return false;
        return (
          item.status === 'published' ||
          (item.status === 'scheduled' && item.startsAt <= nowIso)
        );
      })
      .sort((a: any, b: any) => {
        if (a.priority === 'high' && b.priority !== 'high') return -1;
        if (b.priority === 'high' && a.priority !== 'high') return 1;
        return String(b.startsAt || '').localeCompare(String(a.startsAt || ''));
      })
      .slice(0, 5);

    return NextResponse.json(
      {
        ok: true,
        siteName: siteConfig?.siteName || DEFAULT_SITE_CONFIG.siteName,
        maintenanceMode: Boolean(siteConfig?.maintenanceMode),
        maintenanceMessage:
          siteConfig?.maintenanceMessage ||
          DEFAULT_SITE_CONFIG.maintenanceMessage ||
          '',
        announcements: activeAnnouncements,
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch {
    return NextResponse.json(
      {
        ok: true,
        siteName: DEFAULT_SITE_CONFIG.siteName,
        maintenanceMode: false,
        maintenanceMessage: '',
        announcements: [],
      },
      {
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  }
}
