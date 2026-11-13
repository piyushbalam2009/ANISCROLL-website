import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  CollectionReference,
  collectionGroup,
  query,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { OperationType, handleFirestoreError } from '../firestore';
import {
  AdminRecord,
  AdminRole,
  AdminPermissions,
  DEFAULT_ROLE_PERMISSIONS,
} from './admin-permissions';
import {
  CustomLogoItem,
  FanartLogoItem,
  LogoDisplaySettings,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  AnimeLogoStatus,
  SelectedLogoMetadata,
} from '@/types/artwork';
import { redactSensitiveText } from './redaction';

// ============================================================================
// INTERFACES MATCHING FIREBASE-BLUEPRINT.JSON & FIRESTORE.RULES
// ============================================================================

export interface AnimeArtworkFirestoreDoc {
  hoshikaId: number;
  tvdbId: number;
  tmdbId: number;
  title: string;
  selectedLogoUrl: string;
  selectedLogoSource: 'fanart_hdtvlogo' | 'fanart_clearlogo' | 'custom_upload' | 'typography_fallback';
  selectedLogoLanguage: string;
  selectionMode: 'auto' | 'manual';
  selectedLogo?: SelectedLogoMetadata | null;
  availableLogos: FanartLogoItem[];
  customLogos: CustomLogoItem[];
  hiddenLogoIds: string[];
  logoDisplay: LogoDisplaySettings;
  logoStatus: AnimeLogoStatus;
  backgroundUrl: string;
  posterUrl: string;
  hasEnglishLogo: boolean;
  hasJapaneseLogo: boolean;
  reviewed: boolean;
  updatedBy: string;
  updatedByEmail: string;
  lastChecked: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ArtworkAuditLogEntry {
  id: string;
  hoshikaId: number;
  animeTitle: string;
  previousLogoUrl: string;
  newLogoUrl: string;
  previousSource: string;
  newSource: string;
  selectionMode: 'auto' | 'manual';
  action:
    | 'select_logo'
    | 'upload_logo'
    | 'delete_logo'
    | 'reset_auto'
    | 'restore_previous'
    | 'update_display'
    | 'hide_logo'
    | 'mark_reviewed';
  changedByUid: string;
  changedByEmail: string;
  timestamp: string;
  createdAt?: unknown;
}

export type AdminActivityCategory =
  | 'artwork'
  | 'users'
  | 'anime'
  | 'announcements'
  | 'admins'
  | 'settings'
  | 'security'
  | 'scanner'
  | 'moderation'
  | 'cache'
  | 'monitoring'
  | 'homepage'
  | 'episodes'
  | 'errors';

export interface AdminActivityLogEntry {
  id: string;
  adminUid: string;
  adminEmail: string;
  adminRole?: string;
  category: AdminActivityCategory;
  action: string;
  targetId: string;
  targetName: string;
  details: string;
  status?: string;
  timestamp: string;
  createdAt?: unknown;
}

export interface AnnouncementFirestoreDoc {
  id: string;
  title: string;
  message: string;
  type: 'feature' | 'maintenance' | 'notice' | 'alert';
  status: 'draft' | 'published' | 'scheduled' | 'archived';
  priority?: 'normal' | 'high';
  dismissible: boolean;
  ctaText: string;
  ctaLink: string;
  startsAt: string;
  expiresAt: string;
  createdByUid: string;
  createdByEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface FeaturedAnimeItem {
  hoshikaId: number;
  title: string;
  coverImage: string;
  bannerImage: string;
  format: string;
  rating: number;
  order: number;
}

export interface CustomAnimeCollection {
  id: string;
  title: string;
  subtitle: string;
  animeIds: number[];
  animeItems: FeaturedAnimeItem[];
}

export interface PromoBannerConfig {
  enabled: boolean;
  title: string;
  subtitle: string;
  badgeText: string;
  hoshikaId: number;
  backgroundUrl: string;
  ctaText: string;
}

export type HomepageSectionKey =
  | 'continue_watching'
  | 'trending'
  | 'seasonal'
  | 'popular'
  | 'recent'
  | 'collections'
  | 'promo_banner';

export interface AnimeManagementFirestoreDoc {
  configId: string;
  featuredAnimeIds: number[];
  featuredAnime: FeaturedAnimeItem[];
  pinnedSeasonalIds: number[];
  pinnedSeasonal: FeaturedAnimeItem[];
  collections: CustomAnimeCollection[];
  promoBanner: PromoBannerConfig;
  sectionOrder?: string[];
  enabledSections?: Record<string, boolean>;
  updatedByUid: string;
  updatedByEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PlayerSettingsConfig {
  defaultAudio: 'sub' | 'dub';
  defaultQuality: 'auto' | '1080p' | '720p' | '480p';
  autoPlayNext: boolean;
  autoSkipIntro: boolean;
  autoSkipOutro: boolean;
}

export interface ProviderSettingsConfig {
  seriesProvider: 'megaplay';
  movieProvider: 'zokoanime';
  allowStreamFallback: boolean;
  streamTimeoutMs: number;
}

export interface PerformanceSettingsConfig {
  catalogCacheTtlSeconds: number;
  episodeCacheTtlSeconds: number;
  enableEdgeCaching: boolean;
}

export interface SiteConfigFirestoreDoc {
  configId: string;
  siteName: string;
  siteDescription: string;
  preferEnglishLogos: boolean;
  autoArtworkScan: boolean;
  artworkCacheTtlMinutes: number;
  maintenanceMode: boolean;
  maintenanceMessage?: string;
  require2FAForAdmins: boolean;
  sessionTimeoutMinutes: number;
  playerSettings?: PlayerSettingsConfig;
  providerSettings?: ProviderSettingsConfig;
  performanceSettings?: PerformanceSettingsConfig;
  updatedByUid: string;
  updatedByEmail: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface StreamingMonitorLogEntry {
  id: string;
  provider: 'aniscroll' | 'hoshika' | 'anilist' | 'aniskip' | 'fanart' | 'megaplay' | 'zokoanime';
  endpoint: string;
  status: 'operational' | 'degraded' | 'outage';
  responseTimeMs: number;
  statusCode: number;
  errorMessage: string;
  checkedAt: string;
  createdAt?: unknown;
}

export interface ModerationReportDoc {
  id: string;
  reporterUid: string;
  reporterLabel?: string;
  targetType: 'user' | 'anime' | 'episode' | 'other';
  targetId: string;
  targetName?: string;
  reason: string;
  details?: string;
  status: 'open' | 'in_review' | 'resolved' | 'dismissed';
  actionTaken?: string;
  resolutionNote?: string;
  resolvedByUid?: string;
  resolvedByEmail?: string;
  resolvedAt?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ErrorLogDoc {
  id: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  category: 'api' | 'stream' | 'artwork' | 'auth' | 'database' | 'system';
  provider: string;
  endpoint?: string;
  code?: string;
  statusCode?: number;
  message: string;
  timestamp: string;
  createdAt?: unknown;
}

export interface AdminManagedUserRecord {
  uid: string;
  displayName: string;
  username?: string;
  email: string;
  photoURL: string;
  provider: 'password' | 'google';
  status: 'active' | 'disabled' | 'banned';
  role: 'member' | 'mod' | 'admin' | 'owner' | 'user';
  migrationCompleted?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
}

// ============================================================================
// SANITIZATION HELPERS
// ============================================================================

function cleanString(val: unknown, maxLen: number, fallback = ''): string {
  const str = typeof val === 'string' ? val.trim() : fallback;
  return (str || fallback).slice(0, maxLen);
}

function makeDocId(prefix = 'log'): string {
  const rand = Math.random().toString(36).slice(2, 9);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
}

// ============================================================================
// 1. ACTIVITY & ARTWORK AUDIT LOGS
// ============================================================================

export async function recordAdminActivity(params: {
  category: AdminActivityLogEntry['category'];
  action: string;
  targetId: string | number;
  targetName: string;
  details: string;
  adminRole?: string;
  status?: string;
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const id = makeDocId('act');
  const path = `adminActivityLogs/${id}`;
  const payload: Omit<AdminActivityLogEntry, 'createdAt'> & { createdAt: unknown } = {
    id,
    adminUid: user.uid,
    adminEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
    ...(params.adminRole ? { adminRole: cleanString(params.adminRole, 32, 'staff') } : {}),
    category: params.category,
    action: redactSensitiveText(cleanString(params.action, 120, 'Admin Action'), 120),
    targetId: cleanString(String(params.targetId), 128, 'global'),
    targetName: redactSensitiveText(cleanString(params.targetName, 300, 'System'), 300),
    details: redactSensitiveText(cleanString(params.details, 2000, ''), 2000),
    ...(params.status ? { status: cleanString(params.status, 32, 'success') } : {}),
    timestamp: new Date().toISOString(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'adminActivityLogs', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function recordArtworkAuditLog(params: {
  hoshikaId: number;
  animeTitle: string;
  previousLogoUrl: string;
  newLogoUrl: string;
  previousSource: string;
  newSource: string;
  selectionMode: 'auto' | 'manual';
  action: ArtworkAuditLogEntry['action'];
}): Promise<void> {
  const user = auth.currentUser;
  if (!user) return;

  const id = makeDocId('artlog');
  const path = `artworkAuditLogs/${id}`;
  const payload: Omit<ArtworkAuditLogEntry, 'createdAt'> & { createdAt: unknown } = {
    id,
    hoshikaId: Math.max(1, Number(params.hoshikaId) || 1),
    animeTitle: cleanString(params.animeTitle, 300, `Anime #${params.hoshikaId}`),
    previousLogoUrl: cleanString(params.previousLogoUrl, 2048, ''),
    newLogoUrl: cleanString(params.newLogoUrl, 2048, ''),
    previousSource: cleanString(params.previousSource, 64, 'none'),
    newSource: cleanString(params.newSource, 64, 'none'),
    selectionMode: params.selectionMode,
    action: params.action,
    changedByUid: user.uid,
    changedByEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
    timestamp: new Date().toISOString(),
    createdAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'artworkAuditLogs', id), payload);
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listAdminActivityLogs(maxItems = 100): Promise<AdminActivityLogEntry[]> {
  const path = 'adminActivityLogs';
  try {
    const q = query(collection(db, 'adminActivityLogs'), orderBy('timestamp', 'desc'), limit(maxItems));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as AdminActivityLogEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listArtworkAuditLogs(maxItems = 100): Promise<ArtworkAuditLogEntry[]> {
  const path = 'artworkAuditLogs';
  try {
    const q = query(collection(db, 'artworkAuditLogs'), orderBy('timestamp', 'desc'), limit(maxItems));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ArtworkAuditLogEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ============================================================================
// 2. ANIME ARTWORK MANAGEMENT (/animeArtwork/{hoshikaId})
// ============================================================================

export async function getAnimeArtworkOverride(
  hoshikaId: number
): Promise<AnimeArtworkFirestoreDoc | null> {
  const docId = String(hoshikaId);
  const path = `animeArtwork/${docId}`;
  try {
    const snap = await getDoc(doc(db, 'animeArtwork', docId));
    if (!snap.exists()) return null;
    return snap.data() as AnimeArtworkFirestoreDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function listAllAnimeArtworkOverrides(): Promise<AnimeArtworkFirestoreDoc[]> {
  const path = 'animeArtwork';
  try {
    const snap = await getDocs(collection(db, 'animeArtwork'));
    const items = snap.docs.map((d) => d.data() as AnimeArtworkFirestoreDoc);
    return items.sort((a, b) => (b.lastChecked || '').localeCompare(a.lastChecked || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (value && typeof value === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== null && proto !== Object.prototype) {
      return value;
    }
    const cleaned: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        cleaned[k] = stripUndefinedDeep(v);
      }
    }
    return cleaned as T;
  }
  return value;
}

export async function saveAnimeArtworkOverride(
  input: Omit<AnimeArtworkFirestoreDoc, 'createdAt' | 'updatedAt' | 'updatedBy' | 'updatedByEmail' | 'lastChecked'> & {
    lastChecked?: string;
  }
): Promise<AnimeArtworkFirestoreDoc> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required to modify anime artwork');
  }

  const docId = String(input.hoshikaId);
  const path = `animeArtwork/${docId}`;
  const docRef = doc(db, 'animeArtwork', docId);
  const nowIso = input.lastChecked || new Date().toISOString();

  const validStatuses: AnimeLogoStatus[] = [
    'valid',
    'missing',
    'japanese_only',
    'no_english',
    'low_resolution',
    'broken',
    'typography_fallback',
    'custom_override',
  ];
  const safeLogoStatus: AnimeLogoStatus = validStatuses.includes(input.logoStatus)
    ? input.logoStatus
    : input.selectedLogoUrl
    ? 'valid'
    : 'missing';

  const sanitized: Omit<AnimeArtworkFirestoreDoc, 'createdAt' | 'updatedAt'> = stripUndefinedDeep({
    hoshikaId: Math.max(1, Number(input.hoshikaId) || 1),
    tvdbId: Number(input.tvdbId) || 0,
    tmdbId: Number(input.tmdbId) || 0,
    title: cleanString(input.title, 300, `Anime #${input.hoshikaId}`),
    selectedLogoUrl: cleanString(input.selectedLogoUrl, 2048, ''),
    selectedLogoSource: input.selectedLogoSource || 'typography_fallback',
    selectedLogoLanguage: cleanString(input.selectedLogoLanguage, 16, 'en'),
    selectionMode: input.selectionMode === 'manual' ? 'manual' : 'auto',
    selectedLogo: input.selectedLogo ? stripUndefinedDeep(input.selectedLogo) : null,
    availableLogos: (input.availableLogos || []).slice(0, 60).map((item) => stripUndefinedDeep(item)),
    customLogos: (input.customLogos || []).slice(0, 30).map((item) => stripUndefinedDeep(item)),
    hiddenLogoIds: (input.hiddenLogoIds || []).slice(0, 100).filter((id): id is string => typeof id === 'string'),
    logoDisplay: {
      width: Number(input.logoDisplay?.width) || DEFAULT_LOGO_DISPLAY_SETTINGS.width,
      scale: Number(input.logoDisplay?.scale) || DEFAULT_LOGO_DISPLAY_SETTINGS.scale,
      horizontalPosition:
        Number(input.logoDisplay?.horizontalPosition) ||
        DEFAULT_LOGO_DISPLAY_SETTINGS.horizontalPosition,
      verticalPosition:
        Number(input.logoDisplay?.verticalPosition) ||
        DEFAULT_LOGO_DISPLAY_SETTINGS.verticalPosition,
    },
    logoStatus: safeLogoStatus,
    backgroundUrl: cleanString(input.backgroundUrl, 2048, ''),
    posterUrl: cleanString(input.posterUrl, 2048, ''),
    hasEnglishLogo: Boolean(input.hasEnglishLogo),
    hasJapaneseLogo: Boolean(input.hasJapaneseLogo),
    reviewed: Boolean(input.reviewed),
    updatedBy: user.uid,
    updatedByEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
    lastChecked: nowIso,
  });

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ...sanitized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      const rawCreatedAt = existingData?.createdAt;
      const isValidFirestoreTimestamp =
        rawCreatedAt &&
        typeof rawCreatedAt === 'object' &&
        (typeof (rawCreatedAt as { toMillis?: unknown }).toMillis === 'function' ||
          typeof (rawCreatedAt as { seconds?: unknown }).seconds === 'number');

      await setDoc(docRef, {
        ...sanitized,
        previousLogoUrl: cleanString(existingData?.selectedLogoUrl, 2048, ''),
        previousLogoSource: cleanString(existingData?.selectedLogoSource, 64, 'typography_fallback'),
        createdAt: isValidFirestoreTimestamp ? rawCreatedAt : serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    // Trigger immediate server-side artwork cache invalidation
    try {
      const token = await user.getIdToken();
      await fetch('/api/admin/artwork', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'invalidate_cache',
          hoshikaId: input.hoshikaId,
          override: sanitized,
        }),
      });
    } catch {
      // Non-fatal if background cache bust request fails
    }

    return sanitized;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 3. SUPABASE STORAGE CUSTOM LOGO UPLOAD & DELETE (VIA SECURE NEXT.JS API)
// ============================================================================

export async function uploadCustomAnimeLogoFile(params: {
  hoshikaId: number;
  anilistId?: number;
  file: Blob;
  fileName: string;
  mimeType: 'image/png' | 'image/webp';
  width: number;
  height: number;
  selectImmediately?: boolean;
}): Promise<{
  customLogo: CustomLogoItem;
  artworkDoc?: AnimeArtworkFirestoreDoc;
}> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required to upload custom logos');
  }

  const token = await user.getIdToken();
  const formData = new FormData();
  formData.append('file', params.file, params.fileName);
  formData.append('hoshikaId', String(params.hoshikaId));
  if (params.anilistId && params.anilistId > 0) {
    formData.append('anilistId', String(params.anilistId));
  }
  formData.append('fileName', params.fileName);
  formData.append('mimeType', params.mimeType);
  formData.append('width', String(params.width));
  formData.append('height', String(params.height));
  formData.append(
    'selectImmediately',
    params.selectImmediately !== false ? 'true' : 'false'
  );

  const res = await fetch('/api/admin/artwork/upload', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok || !data?.customLogo) {
    throw new Error(
      data?.error || `Failed to upload custom logo (${res.status})`
    );
  }

  return {
    customLogo: data.customLogo as CustomLogoItem,
    artworkDoc: data.artworkDoc as AnimeArtworkFirestoreDoc | undefined,
  };
}

export async function deleteCustomLogoFromStorage(
  storagePath: string,
  options?: { hoshikaId?: number; anilistId?: number; logoId?: string }
): Promise<{ artworkDoc?: AnimeArtworkFirestoreDoc }> {
  if (!storagePath) return {};
  const user = auth.currentUser;
  if (!user) {
    throw new Error('Authentication required to delete custom logos');
  }

  const token = await user.getIdToken();
  const res = await fetch('/api/admin/artwork/delete', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      storagePath,
      hoshikaId: options?.hoshikaId,
      anilistId: options?.anilistId,
      logoId: options?.logoId,
    }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(
      data?.error || `Failed to delete custom logo (${res.status})`
    );
  }

  return {
    artworkDoc: data.artworkDoc as AnimeArtworkFirestoreDoc | undefined,
  };
}

// ============================================================================
// 4. ADMIN MANAGEMENT (/admins/{adminUid})
// ============================================================================

export async function listAllAdmins(): Promise<AdminRecord[]> {
  const path = 'admins';
  try {
    const snap = await getDocs(collection(db, 'admins'));
    const list = snap.docs.map((d) => d.data() as AdminRecord);
    return list.sort((a, b) => {
      if (a.role === 'owner') return -1;
      if (b.role === 'owner') return 1;
      return (a.email || '').localeCompare(b.email || '');
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveAdminRecord(params: {
  uid: string;
  email: string;
  displayName: string;
  role: AdminRole;
  permissions?: AdminPermissions;
  status: 'active' | 'invited' | 'revoked';
}): Promise<AdminRecord> {
  const user = auth.currentUser;
  if (!user) throw new Error('Must be signed in as Owner');

  const safeUid = params.uid.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
  const path = `admins/${safeUid}`;
  const docRef = doc(db, 'admins', safeUid);
  const nowIso = new Date().toISOString();

  const permissions = params.permissions || { ...DEFAULT_ROLE_PERMISSIONS[params.role] };
  const record: AdminRecord = {
    uid: safeUid,
    email: cleanString(params.email.toLowerCase(), 256),
    displayName: cleanString(params.displayName, 120, params.email.split('@')[0] || 'Admin'),
    role: params.role,
    permissions,
    status: params.status,
    addedBy: user.email || user.uid,
    addedAt: nowIso,
    lastLogin: nowIso,
  };

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ...record,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      await setDoc(docRef, {
        ...record,
        addedBy: existingData.addedBy || record.addedBy,
        addedAt: existingData.addedAt || record.addedAt,
        lastLogin: existingData.lastLogin || record.lastLogin,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminActivity({
      category: 'admins',
      action: existing.exists() ? `Updated admin (${params.role})` : `Added admin (${params.role})`,
      targetId: safeUid,
      targetName: record.email,
      details: `Role: ${params.role}, Status: ${params.status}`,
    });

    return record;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function removeAdminRecord(adminUid: string, adminEmail: string): Promise<void> {
  const path = `admins/${adminUid}`;
  try {
    await deleteDoc(doc(db, 'admins', adminUid));
    await recordAdminActivity({
      category: 'admins',
      action: 'Revoked and removed administrator',
      targetId: adminUid,
      targetName: adminEmail,
      details: `Removed administrator record ${adminUid}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ============================================================================
// 5. ANNOUNCEMENTS (/announcements/{announcementId})
// ============================================================================

export async function listAnnouncements(): Promise<AnnouncementFirestoreDoc[]> {
  const path = 'announcements';
  try {
    const snap = await getDocs(collection(db, 'announcements'));
    const items = snap.docs.map((d) => d.data() as AnnouncementFirestoreDoc);
    return items.sort((a, b) => (b.startsAt || '').localeCompare(a.startsAt || ''));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function getActiveAnnouncementsForPublic(): Promise<AnnouncementFirestoreDoc[]> {
  try {
    const snap = await getDocs(collection(db, 'announcements'));
    const nowIso = new Date().toISOString();
    return snap.docs
      .map((d) => d.data() as AnnouncementFirestoreDoc)
      .filter((item) => {
        if (item.status === 'draft' || item.status === 'archived') return false;
        if (item.startsAt && item.startsAt > nowIso && item.status === 'scheduled') return false;
        if (item.expiresAt && item.expiresAt < nowIso) return false;
        return item.status === 'published' || (item.status === 'scheduled' && item.startsAt <= nowIso);
      });
  } catch {
    return [];
  }
}

export async function saveAnnouncement(
  input: Omit<AnnouncementFirestoreDoc, 'id' | 'createdByUid' | 'createdByEmail' | 'createdAt' | 'updatedAt'> & {
    id?: string;
  }
): Promise<AnnouncementFirestoreDoc> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');

  const id = input.id ? input.id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128) : makeDocId('ann');
  const path = `announcements/${id}`;
  const docRef = doc(db, 'announcements', id);

  const payload: Omit<AnnouncementFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    id,
    title: cleanString(input.title, 200, 'Announcement'),
    message: cleanString(input.message, 2000, ''),
    type: input.type || 'notice',
    status: input.status || 'draft',
    priority: input.priority === 'high' ? 'high' : 'normal',
    dismissible: Boolean(input.dismissible),
    ctaText: cleanString(input.ctaText, 80, ''),
    ctaLink: cleanString(input.ctaLink, 512, ''),
    startsAt: cleanString(input.startsAt, 64, new Date().toISOString()),
    expiresAt: cleanString(input.expiresAt, 64, ''),
    createdByUid: user.uid,
    createdByEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
  };

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      await setDoc(docRef, {
        ...payload,
        createdByUid: existingData.createdByUid || payload.createdByUid,
        createdByEmail: existingData.createdByEmail || payload.createdByEmail,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminActivity({
      category: 'announcements',
      action: existing.exists() ? 'Updated announcement' : 'Created announcement',
      targetId: id,
      targetName: payload.title,
      details: `Type: ${payload.type}, Status: ${payload.status}`,
    });

    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteAnnouncement(id: string, title: string): Promise<void> {
  const path = `announcements/${id}`;
  try {
    await deleteDoc(doc(db, 'announcements', id));
    await recordAdminActivity({
      category: 'announcements',
      action: 'Deleted announcement',
      targetId: id,
      targetName: title,
      details: `Deleted announcement ${id}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ============================================================================
// 6. ANIME MANAGEMENT (/animeManagement/homepage)
// ============================================================================

export const DEFAULT_ANIME_MANAGEMENT_CONFIG: Omit<
  AnimeManagementFirestoreDoc,
  'createdAt' | 'updatedAt'
> = {
  configId: 'homepage',
  featuredAnimeIds: [],
  featuredAnime: [],
  pinnedSeasonalIds: [],
  pinnedSeasonal: [],
  collections: [],
  promoBanner: {
    enabled: false,
    title: '',
    subtitle: '',
    badgeText: 'FEATURED SPOTLIGHT',
    hoshikaId: 0,
    backgroundUrl: '',
    ctaText: 'Watch Now',
  },
  sectionOrder: [
    'continue_watching',
    'trending',
    'seasonal',
    'popular',
    'recent',
    'collections',
    'promo_banner',
  ],
  enabledSections: {
    continue_watching: true,
    trending: true,
    seasonal: true,
    popular: true,
    recent: true,
    collections: true,
    promo_banner: true,
  },
  updatedByUid: 'system',
  updatedByEmail: 'system@aniscroll.app',
};

export async function getAnimeManagementDoc(): Promise<AnimeManagementFirestoreDoc> {
  try {
    const snap = await getDoc(doc(db, 'animeManagement', 'homepage'));
    if (!snap.exists()) return DEFAULT_ANIME_MANAGEMENT_CONFIG;
    const raw = snap.data() as Partial<AnimeManagementFirestoreDoc>;
    return {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG,
      ...raw,
      promoBanner: {
        ...DEFAULT_ANIME_MANAGEMENT_CONFIG.promoBanner,
        ...(raw.promoBanner || {}),
      },
      sectionOrder:
        Array.isArray(raw.sectionOrder) && raw.sectionOrder.length > 0
          ? raw.sectionOrder
          : DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder,
      enabledSections: {
        ...DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections,
        ...(raw.enabledSections || {}),
      },
    };
  } catch {
    return DEFAULT_ANIME_MANAGEMENT_CONFIG;
  }
}

export async function saveAnimeManagementDoc(
  input: Omit<AnimeManagementFirestoreDoc, 'configId' | 'updatedByUid' | 'updatedByEmail' | 'createdAt' | 'updatedAt'>
): Promise<AnimeManagementFirestoreDoc> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');

  const path = 'animeManagement/homepage';
  const docRef = doc(db, 'animeManagement', 'homepage');

  const payload: Omit<AnimeManagementFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    configId: 'homepage',
    featuredAnimeIds: (input.featuredAnimeIds || []).slice(0, 30),
    featuredAnime: (input.featuredAnime || []).slice(0, 30),
    pinnedSeasonalIds: (input.pinnedSeasonalIds || []).slice(0, 30),
    pinnedSeasonal: (input.pinnedSeasonal || []).slice(0, 30),
    collections: (input.collections || []).slice(0, 20),
    promoBanner: input.promoBanner || DEFAULT_ANIME_MANAGEMENT_CONFIG.promoBanner,
    sectionOrder:
      Array.isArray(input.sectionOrder) && input.sectionOrder.length > 0
        ? input.sectionOrder.slice(0, 20)
        : DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder,
    enabledSections:
      input.enabledSections || DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections,
    updatedByUid: user.uid,
    updatedByEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
  };

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      await setDoc(docRef, {
        ...payload,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminActivity({
      category: 'homepage',
      action: 'Updated homepage anime curation',
      targetId: 'homepage',
      targetName: 'Homepage Curation & Collections',
      details: `${payload.featuredAnimeIds.length} featured, ${payload.pinnedSeasonalIds.length} pinned seasonal, ${payload.collections.length} custom collections`,
    });

    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 7. SITE CONFIGURATION (/siteConfig/global)
// ============================================================================

export const DEFAULT_SITE_CONFIG: Omit<SiteConfigFirestoreDoc, 'createdAt' | 'updatedAt'> = {
  configId: 'global',
  siteName: 'AniScroll',
  siteDescription: 'Cinematic High-Contrast Anime Streaming Platform',
  preferEnglishLogos: true,
  autoArtworkScan: true,
  artworkCacheTtlMinutes: 60,
  maintenanceMode: false,
  maintenanceMessage:
    'AniScroll is undergoing scheduled maintenance. Streaming and metadata endpoints will resume shortly.',
  require2FAForAdmins: true,
  sessionTimeoutMinutes: 120,
  playerSettings: {
    defaultAudio: 'sub',
    defaultQuality: 'auto',
    autoPlayNext: true,
    autoSkipIntro: true,
    autoSkipOutro: false,
  },
  providerSettings: {
    seriesProvider: 'megaplay',
    movieProvider: 'zokoanime',
    allowStreamFallback: false,
    streamTimeoutMs: 8500,
  },
  performanceSettings: {
    catalogCacheTtlSeconds: 300,
    episodeCacheTtlSeconds: 180,
    enableEdgeCaching: true,
  },
  updatedByUid: 'system',
  updatedByEmail: 'system@aniscroll.app',
};

export async function getSiteConfigDoc(): Promise<SiteConfigFirestoreDoc> {
  try {
    const snap = await getDoc(doc(db, 'siteConfig', 'global'));
    if (!snap.exists()) return DEFAULT_SITE_CONFIG;
    const raw = snap.data() as Partial<SiteConfigFirestoreDoc>;
    return {
      ...DEFAULT_SITE_CONFIG,
      ...raw,
      playerSettings: {
        ...DEFAULT_SITE_CONFIG.playerSettings!,
        ...(raw.playerSettings || {}),
      },
      providerSettings: {
        ...DEFAULT_SITE_CONFIG.providerSettings!,
        ...(raw.providerSettings || {}),
      },
      performanceSettings: {
        ...DEFAULT_SITE_CONFIG.performanceSettings!,
        ...(raw.performanceSettings || {}),
      },
    };
  } catch {
    return DEFAULT_SITE_CONFIG;
  }
}

export async function saveSiteConfigDoc(
  input: Omit<SiteConfigFirestoreDoc, 'configId' | 'updatedByUid' | 'updatedByEmail' | 'createdAt' | 'updatedAt'>
): Promise<SiteConfigFirestoreDoc> {
  const user = auth.currentUser;
  if (!user) throw new Error('Authentication required');

  const path = 'siteConfig/global';
  const docRef = doc(db, 'siteConfig', 'global');

  const payload: Omit<SiteConfigFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    configId: 'global',
    siteName: cleanString(input.siteName, 80, 'AniScroll'),
    siteDescription: cleanString(input.siteDescription, 500, 'Cinematic Anime Streaming Platform'),
    preferEnglishLogos: Boolean(input.preferEnglishLogos),
    autoArtworkScan: Boolean(input.autoArtworkScan),
    artworkCacheTtlMinutes: Math.min(10080, Math.max(1, Number(input.artworkCacheTtlMinutes) || 60)),
    maintenanceMode: Boolean(input.maintenanceMode),
    maintenanceMessage: cleanString(
      input.maintenanceMessage,
      500,
      DEFAULT_SITE_CONFIG.maintenanceMessage || ''
    ),
    require2FAForAdmins: Boolean(input.require2FAForAdmins),
    sessionTimeoutMinutes: Math.min(10080, Math.max(5, Number(input.sessionTimeoutMinutes) || 120)),
    playerSettings: input.playerSettings || DEFAULT_SITE_CONFIG.playerSettings,
    providerSettings: input.providerSettings || DEFAULT_SITE_CONFIG.providerSettings,
    performanceSettings: input.performanceSettings || DEFAULT_SITE_CONFIG.performanceSettings,
    updatedByUid: user.uid,
    updatedByEmail: cleanString(user.email, 256, 'admin@aniscroll.app'),
  };

  try {
    const existing = await getDoc(docRef);
    if (!existing.exists()) {
      await setDoc(docRef, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const existingData = existing.data();
      await setDoc(docRef, {
        ...payload,
        createdAt: existingData.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminActivity({
      category: 'settings',
      action: 'Updated global site configuration',
      targetId: 'global',
      targetName: 'Site Settings',
      details: `English Logo Priority: ${payload.preferEnglishLogos}, Cache TTL: ${payload.artworkCacheTtlMinutes}m, Maintenance: ${payload.maintenanceMode}`,
    });

    return payload;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ============================================================================
// 8. STREAMING MONITOR LOGS (/streamingLogs/{logId})
// ============================================================================

export async function recordStreamingMonitorLog(
  entry: Omit<StreamingMonitorLogEntry, 'id' | 'createdAt'>
): Promise<void> {
  const id = makeDocId('smon');
  const path = `streamingLogs/${id}`;
  try {
    await setDoc(doc(db, 'streamingLogs', id), {
      id,
      provider: entry.provider,
      endpoint: redactSensitiveText(cleanString(entry.endpoint, 512, '/api'), 512),
      status: entry.status,
      responseTimeMs: Math.max(0, Math.round(Number(entry.responseTimeMs) || 0)),
      statusCode: Math.max(0, Math.round(Number(entry.statusCode) || 200)),
      errorMessage: redactSensitiveText(cleanString(entry.errorMessage, 1024, ''), 1024),
      checkedAt: entry.checkedAt || new Date().toISOString(),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listStreamingMonitorLogs(maxItems = 50): Promise<StreamingMonitorLogEntry[]> {
  const path = 'streamingLogs';
  try {
    const q = query(collection(db, 'streamingLogs'), orderBy('checkedAt', 'desc'), limit(maxItems));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as StreamingMonitorLogEntry);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ============================================================================
// 8b. MODERATION REPORTS (/reports/{reportId}) & ERROR LOGS (/errorLogs/{logId})
// ============================================================================

export async function listModerationReports(maxItems = 100): Promise<ModerationReportDoc[]> {
  const path = 'reports';
  try {
    const q = query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(maxItems));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ModerationReportDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function listErrorLogs(maxItems = 100): Promise<ErrorLogDoc[]> {
  const path = 'errorLogs';
  try {
    const q = query(collection(db, 'errorLogs'), orderBy('timestamp', 'desc'), limit(maxItems));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as ErrorLogDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ============================================================================
// 9. USER MANAGEMENT HELPERS (CollectionGroup query on 'profile')
// ============================================================================

export async function listManagedUsers(): Promise<AdminManagedUserRecord[]> {
  const path = 'users/*/profile';
  try {
    const snap = await getDocs(collectionGroup(db, 'profile'));
    const users: AdminManagedUserRecord[] = [];
    snap.forEach((docSnap) => {
      if (docSnap.id === 'details') {
        const d = docSnap.data();
        if (d && d.uid && d.email) {
          users.push({
            uid: d.uid,
            displayName: d.displayName || 'AniScroll Member',
            username: d.username || '',
            email: d.email,
            photoURL: d.photoURL || '',
            provider: d.provider || 'password',
            status: d.status || 'active',
            role: d.role || 'member',
            migrationCompleted: d.migrationCompleted,
            createdAt: d.createdAt,
            updatedAt: d.updatedAt,
          });
        }
      }
    });
    return users;
  } catch (error) {
    console.warn('CollectionGroup profile query fallback:', error);
    return [];
  }
}

export async function updateManagedUserStatus(
  targetUid: string,
  targetEmail: string,
  status: 'active' | 'disabled' | 'banned'
): Promise<void> {
  const path = `users/${targetUid}/profile/details`;
  const docRef = doc(db, 'users', targetUid, 'profile', 'details');
  try {
    const snap = await getDoc(docRef);
    if (!snap.exists()) {
      throw new Error('User profile document not found');
    }
    const existing = snap.data();
    await updateDoc(docRef, {
      ...existing,
      status,
      updatedAt: serverTimestamp(),
    });

    await recordAdminActivity({
      category: 'users',
      action: `Changed user status to ${status}`,
      targetId: targetUid,
      targetName: targetEmail,
      details: `Updated account status for ${targetEmail} (${targetUid}) to ${status}`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteManagedUserAccount(
  targetUid: string,
  targetEmail: string
): Promise<void> {
  const path = `users/${targetUid}/profile/details`;
  try {
    await deleteDoc(doc(db, 'users', targetUid, 'profile', 'details'));
    await recordAdminActivity({
      category: 'users',
      action: 'Deleted user profile',
      targetId: targetUid,
      targetName: targetEmail,
      details: `Removed Firestore profile for ${targetEmail} (${targetUid})`,
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
