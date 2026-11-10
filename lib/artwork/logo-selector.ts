import {
  AnimeLogoStatus,
  CustomLogoItem,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  FanartLogoItem,
  LogoDisplaySettings,
  SelectedLogoMetadata,
} from '@/types/artwork';
import { sortLogosByPriority } from '@/lib/fanart';

export interface LogoSelectionInput {
  availableLogos: FanartLogoItem[];
  customLogos?: CustomLogoItem[];
  hiddenLogoIds?: string[];
  selectionMode?: 'auto' | 'manual';
  manualLogoId?: string | null;
  manualLogoUrl?: string | null;
  manualLogoSource?:
    | 'fanart_hdtvlogo'
    | 'fanart_clearlogo'
    | 'custom_upload'
    | 'typography_fallback';
  manualLogoLanguage?: string;
  selectedLogo?: SelectedLogoMetadata | null;
  logoDisplay?: LogoDisplaySettings;
  preferEnglish?: boolean;
}

export interface LogoSelectionResult {
  logoUrl: string | null;
  selectedLogo: SelectedLogoMetadata | null;
  selectedLogoSource:
    | 'fanart_hdtvlogo'
    | 'fanart_clearlogo'
    | 'custom_upload'
    | 'typography_fallback';
  selectedLogoLanguage: string;
  selectionMode: 'auto' | 'manual';
  availableLogos: FanartLogoItem[];
  customLogos: CustomLogoItem[];
  hiddenLogoIds: string[];
  logoDisplay: LogoDisplaySettings;
  logoStatus: AnimeLogoStatus;
  hasEnglishLogo: boolean;
  hasJapaneseLogo: boolean;
}

/**
 * Pure, deterministic logo selector enforcing the exact 8-step priority rules:
 * 1. Administrator-selected custom logo (selectionMode === 'manual', source === 'custom_upload')
 * 2. Administrator-selected Fanart.tv logo (selectionMode === 'manual')
 * 3. Automatic English Fanart.tv HDTV logo
 * 4. Automatic English Fanart.tv clear logo
 * 5. Automatic Japanese Fanart.tv HDTV logo
 * 6. Automatic Japanese Fanart.tv clear logo
 * 7. Other available Fanart.tv logos
 * 8. Hoshika typography fallback (logoUrl: null)
 *
 * NOTE:
 * - AniZip logos are NEVER accepted or used anywhere in this selector.
 * - All valid Fanart.tv logos are preserved in `availableLogos` so the Admin Panel
 *   always displays every single logo variant retrieved for the anime.
 */
export function resolveAnimeLogoSelection(
  input: LogoSelectionInput
): LogoSelectionResult {
  const hiddenSet = new Set(input.hiddenLogoIds || []);
  const customLogos = input.customLogos || [];
  const preferEnglish = input.preferEnglish !== false;

  // All valid Fanart logos sorted by priority (always returned in full for the Admin Panel)
  const allSortedFanartLogos = sortLogosByPriority(
    input.availableLogos || [],
    preferEnglish
  );

  // Visible (non-hidden) Fanart logos used for automatic selection
  const visibleFanartLogos = allSortedFanartLogos.filter(
    (logo) => !hiddenSet.has(logo.id)
  );

  const hasEnglishLogo =
    visibleFanartLogos.some((l) => {
      const lang = (l.lang || l.language || 'en').toLowerCase();
      return lang === 'en' || lang === '00' || lang === '';
    }) || customLogos.some((c) => (c.lang || 'en').toLowerCase() === 'en');

  const hasJapaneseLogo = visibleFanartLogos.some(
    (l) => (l.lang || l.language || '').toLowerCase() === 'ja'
  );

  const logoDisplay: LogoDisplaySettings = {
    width: input.logoDisplay?.width || DEFAULT_LOGO_DISPLAY_SETTINGS.width,
    scale: input.logoDisplay?.scale || DEFAULT_LOGO_DISPLAY_SETTINGS.scale,
    horizontalPosition:
      input.logoDisplay?.horizontalPosition ??
      DEFAULT_LOGO_DISPLAY_SETTINGS.horizontalPosition,
    verticalPosition:
      input.logoDisplay?.verticalPosition ??
      DEFAULT_LOGO_DISPLAY_SETTINGS.verticalPosition,
  };

  // 1 & 2. Administrator-selected manual override ALWAYS takes top priority and is never overridden
  if (input.selectionMode === 'manual') {
    const manualUrl = (
      input.manualLogoUrl ||
      input.selectedLogo?.proxyUrl ||
      input.selectedLogo?.url ||
      ''
    ).trim();
    const manualId = input.manualLogoId || input.selectedLogo?.id || null;

    if (
      input.manualLogoSource === 'typography_fallback' ||
      input.selectedLogo?.source === 'typography' ||
      (!manualUrl && !manualId)
    ) {
      return {
        logoUrl: null,
        selectedLogo: {
          source: 'typography',
          logoSource: 'typography_fallback',
          url: '',
          proxyUrl: '',
          type: 'typography',
          language: input.manualLogoLanguage || 'en',
          storageProvider: 'none',
          selectedAt: input.selectedLogo?.selectedAt || new Date().toISOString(),
          selectedBy: input.selectedLogo?.selectedBy,
          selectedByEmail: input.selectedLogo?.selectedByEmail,
        },
        selectedLogoSource: 'typography_fallback',
        selectedLogoLanguage: input.manualLogoLanguage || 'en',
        selectionMode: 'manual',
        availableLogos: allSortedFanartLogos,
        customLogos,
        hiddenLogoIds: Array.from(hiddenSet),
        logoDisplay,
        logoStatus: 'typography_fallback',
        hasEnglishLogo,
        hasJapaneseLogo,
      };
    }

    // Check if the manual selection matches one of the custom uploaded logos
    const matchedCustom = customLogos.find(
      (c) =>
        (manualId && c.id === manualId) ||
        (manualUrl &&
          (c.url === manualUrl ||
            c.proxyUrl === manualUrl ||
            c.logoUrl === manualUrl))
    );

    if (matchedCustom || input.manualLogoSource === 'custom_upload') {
      const effectiveUrl =
        matchedCustom?.url || matchedCustom?.proxyUrl || manualUrl;
      const effectiveLang =
        matchedCustom?.lang || input.manualLogoLanguage || 'en';
      return {
        logoUrl: effectiveUrl,
        selectedLogo: {
          id: matchedCustom?.id || manualId || undefined,
          source: 'custom',
          logoSource: 'custom_upload',
          url: matchedCustom?.url || effectiveUrl,
          proxyUrl: matchedCustom?.proxyUrl || effectiveUrl,
          type: 'custom',
          language: effectiveLang,
          storageProvider: matchedCustom?.storageProvider === 'supabase' ? 'supabase' : 'supabase',
          storageBucket: matchedCustom?.storageBucket,
          storagePath: matchedCustom?.storagePath,
          selectedAt:
            input.selectedLogo?.selectedAt ||
            matchedCustom?.updatedAt ||
            matchedCustom?.uploadedAt ||
            new Date().toISOString(),
          selectedBy: input.selectedLogo?.selectedBy || matchedCustom?.uploadedBy,
          selectedByEmail:
            input.selectedLogo?.selectedByEmail || matchedCustom?.uploadedByEmail,
        },
        selectedLogoSource: 'custom_upload',
        selectedLogoLanguage: effectiveLang,
        selectionMode: 'manual',
        availableLogos: allSortedFanartLogos,
        customLogos,
        hiddenLogoIds: Array.from(hiddenSet),
        logoDisplay,
        logoStatus: 'custom_override',
        hasEnglishLogo,
        hasJapaneseLogo,
      };
    }

    // Check if the manual selection matches one of the Fanart.tv logo candidates
    const matchedFanart = allSortedFanartLogos.find(
      (l) =>
        (manualId && l.id === manualId) ||
        (manualUrl && (l.url === manualUrl || l.proxyUrl === manualUrl))
    );

    const effectiveLogoUrl = matchedFanart
      ? matchedFanart.proxyUrl || matchedFanart.url
      : manualUrl;
    const effectiveRawUrl = matchedFanart ? matchedFanart.url : manualUrl;
    const effectiveSource =
      matchedFanart?.source || input.manualLogoSource || 'fanart_hdtvlogo';
    const effectiveLang =
      matchedFanart?.lang ||
      matchedFanart?.language ||
      input.manualLogoLanguage ||
      'en';
    const effectiveCategory =
      matchedFanart?.category ||
      (effectiveSource === 'fanart_clearlogo' ? 'clearlogo' : 'hdtvlogo');

    return {
      logoUrl: effectiveLogoUrl,
      selectedLogo: {
        id: matchedFanart?.id || manualId || undefined,
        source: 'fanart',
        logoSource: effectiveSource,
        url: effectiveRawUrl,
        proxyUrl: effectiveLogoUrl,
        type: effectiveCategory === 'clearlogo' ? 'clearlogo' : 'hdtvlogo',
        language: effectiveLang,
        storageProvider: 'fanart',
        selectedAt: input.selectedLogo?.selectedAt || new Date().toISOString(),
        selectedBy: input.selectedLogo?.selectedBy,
        selectedByEmail: input.selectedLogo?.selectedByEmail,
      },
      selectedLogoSource: effectiveSource,
      selectedLogoLanguage: effectiveLang,
      selectionMode: 'manual',
      availableLogos: allSortedFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus: 'valid',
      hasEnglishLogo,
      hasJapaneseLogo,
    };
  }

  // 3–7. Automatic priority selection from Fanart.tv candidates
  if (visibleFanartLogos.length > 0) {
    const topLogo = visibleFanartLogos[0]!;
    let logoStatus: AnimeLogoStatus = 'valid';
    if (!hasEnglishLogo && hasJapaneseLogo) {
      logoStatus = 'japanese_only';
    } else if (!hasEnglishLogo) {
      logoStatus = 'no_english';
    }

    const effectiveUrl = topLogo.proxyUrl || topLogo.url;
    const effectiveLang = topLogo.lang || topLogo.language || 'en';

    return {
      logoUrl: effectiveUrl,
      selectedLogo: {
        id: topLogo.id,
        source: 'fanart',
        logoSource: topLogo.source,
        url: topLogo.url,
        proxyUrl: effectiveUrl,
        type: topLogo.category === 'clearlogo' ? 'clearlogo' : 'hdtvlogo',
        language: effectiveLang,
        storageProvider: 'fanart',
        selectedAt: new Date().toISOString(),
      },
      selectedLogoSource: topLogo.source,
      selectedLogoLanguage: effectiveLang,
      selectionMode: 'auto',
      availableLogos: allSortedFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus,
      hasEnglishLogo,
      hasJapaneseLogo,
    };
  }

  // Fallback if no Fanart.tv logo exists but a custom uploaded logo is explicitly marked selected
  const selectedCustom = customLogos.find((c) => c.selected);
  if (selectedCustom) {
    const effectiveUrl = selectedCustom.proxyUrl || selectedCustom.url;
    return {
      logoUrl: effectiveUrl,
      selectedLogo: {
        id: selectedCustom.id,
        source: 'custom',
        logoSource: 'custom_upload',
        url: selectedCustom.url,
        proxyUrl: effectiveUrl,
        type: 'custom',
        language: selectedCustom.lang || 'en',
        storageProvider: 'supabase',
        storageBucket: selectedCustom.storageBucket,
        storagePath: selectedCustom.storagePath,
        selectedAt: selectedCustom.updatedAt || selectedCustom.uploadedAt,
        selectedBy: selectedCustom.uploadedBy,
        selectedByEmail: selectedCustom.uploadedByEmail,
      },
      selectedLogoSource: 'custom_upload',
      selectedLogoLanguage: selectedCustom.lang || 'en',
      selectionMode: 'auto',
      availableLogos: allSortedFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus: 'custom_override',
      hasEnglishLogo: true,
      hasJapaneseLogo,
    };
  }

  // 8. Hoshika title typography fallback
  return {
    logoUrl: null,
    selectedLogo: null,
    selectedLogoSource: 'typography_fallback',
    selectedLogoLanguage: 'en',
    selectionMode: 'auto',
    availableLogos: allSortedFanartLogos,
    customLogos,
    hiddenLogoIds: Array.from(hiddenSet),
    logoDisplay,
    logoStatus: 'missing',
    hasEnglishLogo: false,
    hasJapaneseLogo: false,
  };
}

/**
 * Maps LogoDisplaySettings (width, scale, horizontalPosition, verticalPosition)
 * to deterministic Tailwind utility classes (no inline styles).
 */
export function getLogoDisplayTailwindClasses(
  display?: LogoDisplaySettings,
  variant: 'home' | 'details' = 'home'
): string {
  const width = display?.width || DEFAULT_LOGO_DISPLAY_SETTINGS.width;
  const scale = display?.scale || DEFAULT_LOGO_DISPLAY_SETTINGS.scale;
  const x = display?.horizontalPosition || 0;
  const y = display?.verticalPosition || 0;

  let widthClass =
    variant === 'details'
      ? 'max-w-[320px] sm:max-w-[420px] md:max-w-[500px] lg:max-w-[580px] h-20 sm:h-24 md:h-28 lg:h-32'
      : 'max-w-[340px] sm:max-w-[440px] md:max-w-[520px] h-20 sm:h-24 md:h-28 lg:h-32';

  if (width <= 280) {
    widthClass = 'max-w-[220px] sm:max-w-[260px] md:max-w-[280px] h-16 sm:h-20 md:h-22';
  } else if (width <= 360) {
    widthClass = 'max-w-[260px] sm:max-w-[320px] md:max-w-[360px] h-18 sm:h-22 md:h-24';
  } else if (width <= 460) {
    widthClass = 'max-w-[320px] sm:max-w-[400px] md:max-w-[460px] h-20 sm:h-24 md:h-28';
  } else if (width <= 540) {
    widthClass = 'max-w-[340px] sm:max-w-[460px] md:max-w-[540px] h-22 sm:h-26 md:h-30 lg:h-32';
  } else {
    widthClass = 'max-w-[360px] sm:max-w-[500px] md:max-w-[620px] h-24 sm:h-28 md:h-32 lg:h-36';
  }

  let scaleClass = 'scale-100';
  if (scale <= 75) scaleClass = 'scale-75 origin-left';
  else if (scale <= 90) scaleClass = 'scale-90 origin-left';
  else if (scale >= 125) scaleClass = 'scale-125 origin-left';
  else if (scale >= 110) scaleClass = 'scale-110 origin-left';

  let translateXClass = '';
  if (x <= -32) translateXClass = '-translate-x-8';
  else if (x <= -16) translateXClass = '-translate-x-4';
  else if (x >= 32) translateXClass = 'translate-x-8';
  else if (x >= 16) translateXClass = 'translate-x-4';

  let translateYClass = '';
  if (y <= -24) translateYClass = '-translate-y-6';
  else if (y <= -12) translateYClass = '-translate-y-3';
  else if (y >= 24) translateYClass = 'translate-y-6';
  else if (y >= 12) translateYClass = 'translate-y-3';

  return `${widthClass} ${scaleClass} ${translateXClass} ${translateYClass}`.trim();
}
