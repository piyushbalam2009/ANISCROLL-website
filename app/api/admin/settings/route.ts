import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import {
  fetchFirestoreDocumentServer,
  verifyAdminRequest,
  writeFirestoreDocumentServer,
} from '@/lib/firebase-admin';
import { hasAdminPermission } from '@/lib/admin/admin-permissions';
import {
  DEFAULT_SITE_CONFIG,
  SiteConfigFirestoreDoc,
} from '@/lib/admin/admin-firestore';
import { logAdminActionServer } from '@/lib/admin/server-audit';

export async function GET(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageSettings')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const raw = (await fetchFirestoreDocumentServer(
    'siteConfig',
    'global',
    verified.idToken
  )) as Partial<SiteConfigFirestoreDoc> | null;

  const config: Omit<SiteConfigFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    ...DEFAULT_SITE_CONFIG,
    ...(raw || {}),
    playerSettings: {
      ...DEFAULT_SITE_CONFIG.playerSettings!,
      ...(raw?.playerSettings || {}),
    },
    providerSettings: {
      ...DEFAULT_SITE_CONFIG.providerSettings!,
      ...(raw?.providerSettings || {}),
    },
    performanceSettings: {
      ...DEFAULT_SITE_CONFIG.performanceSettings!,
      ...(raw?.performanceSettings || {}),
    },
  };

  return NextResponse.json({ ok: true, config });
}

export async function POST(req: NextRequest) {
  const verified = await verifyAdminRequest(req);
  if (!verified || !hasAdminPermission(verified.admin, 'manageSettings')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const siteName = String(body?.siteName || 'AniScroll').trim().slice(0, 120) || 'AniScroll';
  const siteDescription = String(
    body?.siteDescription ?? DEFAULT_SITE_CONFIG.siteDescription
  )
    .trim()
    .slice(0, 500);

  const payload: Omit<SiteConfigFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    configId: 'global',
    siteName,
    siteDescription,
    preferEnglishLogos: body?.preferEnglishLogos !== false,
    autoArtworkScan: body?.autoArtworkScan !== false,
    artworkCacheTtlMinutes: Math.min(
      10080,
      Math.max(1, Number(body?.artworkCacheTtlMinutes) || 60)
    ),
    maintenanceMode: Boolean(body?.maintenanceMode),
    maintenanceMessage: String(
      body?.maintenanceMessage ?? DEFAULT_SITE_CONFIG.maintenanceMessage ?? ''
    )
      .trim()
      .slice(0, 500),
    require2FAForAdmins: body?.require2FAForAdmins !== false,
    sessionTimeoutMinutes: Math.min(
      10080,
      Math.max(5, Number(body?.sessionTimeoutMinutes) || 120)
    ),
    playerSettings: {
      defaultAudio: body?.playerSettings?.defaultAudio === 'dub' ? 'dub' : 'sub',
      defaultQuality: ['auto', '1080p', '720p', '480p'].includes(
        String(body?.playerSettings?.defaultQuality)
      )
        ? body.playerSettings.defaultQuality
        : 'auto',
      autoPlayNext: body?.playerSettings?.autoPlayNext !== false,
      autoSkipIntro: body?.playerSettings?.autoSkipIntro !== false,
      autoSkipOutro: Boolean(body?.playerSettings?.autoSkipOutro),
    },
    providerSettings: {
      seriesProvider: 'megaplay',
      movieProvider: 'zokoanime',
      allowStreamFallback: Boolean(body?.providerSettings?.allowStreamFallback),
      streamTimeoutMs: Math.min(
        20000,
        Math.max(2000, Number(body?.providerSettings?.streamTimeoutMs) || 8500)
      ),
    },
    performanceSettings: {
      catalogCacheTtlSeconds: Math.min(
        86400,
        Math.max(30, Number(body?.performanceSettings?.catalogCacheTtlSeconds) || 300)
      ),
      episodeCacheTtlSeconds: Math.min(
        86400,
        Math.max(30, Number(body?.performanceSettings?.episodeCacheTtlSeconds) || 180)
      ),
      enableEdgeCaching: body?.performanceSettings?.enableEdgeCaching !== false,
    },
    updatedByUid: verified.uid,
    updatedByEmail: (verified.email || 'admin@aniscroll.app').slice(0, 256),
  };

  await writeFirestoreDocumentServer({
    collectionPath: 'siteConfig',
    docId: 'global',
    data: payload,
    idToken: verified.idToken,
  });

  try {
    revalidatePath('/');
  } catch {
    // Ignore outside request context
  }

  await logAdminActionServer(verified, {
    category: 'settings',
    action: 'Updated global website settings',
    targetId: 'global',
    targetName: siteName,
    details: `Maintenance: ${payload.maintenanceMode}, English Logos: ${payload.preferEnglishLogos}, Default Audio: ${payload.playerSettings?.defaultAudio}`,
  });

  return NextResponse.json({ ok: true, config: payload });
}
