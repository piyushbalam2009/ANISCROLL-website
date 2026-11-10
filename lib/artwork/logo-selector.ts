import {
  AnimeLogoStatus,
  CustomLogoItem,
  DEFAULT_LOGO_DISPLAY_SETTINGS,
  FanartLogoItem,
  LogoDisplaySettings,
} from '@/types/artwork';
import { sortLogosByPriority } from '@/lib/fanart';

export interface LogoSelectionInput {
  availableLogos: FanartLogoItem[];
  customLogos?: CustomLogoItem[];
  hiddenLogoIds?: string[];
  selectionMode?: 'auto' | 'manual';
  manualLogoUrl?: string | null;
  manualLogoSource?:
    | 'fanart_hdtvlogo'
    | 'fanart_clearlogo'
    | 'custom_upload'
    | 'typography_fallback';
  manualLogoLanguage?: string;
  logoDisplay?: LogoDisplaySettings;
  preferEnglish?: boolean;
}

export interface LogoSelectionResult {
  logoUrl: string | null;
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
 * Pure, deterministic logo selector enforcing the exact priority rules:
 * 1. Admin-selected logo (selectionMode === 'manual') -> NEVER overridden by automatic selection
 * 2. Fanart.tv English hdtvlogo
 * 3. Fanart.tv English clearlogo
 * 4. Fanart.tv Japanese hdtvlogo
 * 5. Fanart.tv Japanese clearlogo
 * 6. Other available Fanart.tv logos
 * 7. Hoshika title typography fallback (logoUrl: null)
 *
 * NOTE: AniZip logos are NEVER accepted or used anywhere in this selector.
 */
export function resolveAnimeLogoSelection(input: LogoSelectionInput): LogoSelectionResult {
  const hiddenSet = new Set(input.hiddenLogoIds || []);
  const customLogos = input.customLogos || [];
  const preferEnglish = input.preferEnglish !== false;

  // Filter out hidden Fanart logos and sort by priority
  const visibleFanartLogos = sortLogosByPriority(
    (input.availableLogos || []).filter((logo) => !hiddenSet.has(logo.id)),
    preferEnglish
  );

  const hasEnglishLogo =
    visibleFanartLogos.some((l) => l.lang === 'en' || l.lang === '00' || l.lang === '') ||
    customLogos.some((c) => c.lang === 'en');
  const hasJapaneseLogo = visibleFanartLogos.some((l) => l.lang === 'ja');

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

  // 1. Admin-selected manual override ALWAYS takes top priority and is never overridden
  if (input.selectionMode === 'manual') {
    if (
      input.manualLogoSource === 'typography_fallback' ||
      !input.manualLogoUrl ||
      !input.manualLogoUrl.trim()
    ) {
      return {
        logoUrl: null,
        selectedLogoSource: 'typography_fallback',
        selectedLogoLanguage: input.manualLogoLanguage || 'en',
        selectionMode: 'manual',
        availableLogos: visibleFanartLogos,
        customLogos,
        hiddenLogoIds: Array.from(hiddenSet),
        logoDisplay,
        logoStatus: 'typography_fallback',
        hasEnglishLogo,
        hasJapaneseLogo,
      };
    }

    const manualUrl = input.manualLogoUrl.trim();
    const isCustom =
      input.manualLogoSource === 'custom_upload' ||
      customLogos.some((c) => c.url === manualUrl || c.proxyUrl === manualUrl);

    return {
      logoUrl: manualUrl,
      selectedLogoSource: isCustom
        ? 'custom_upload'
        : input.manualLogoSource || 'fanart_hdtvlogo',
      selectedLogoLanguage: input.manualLogoLanguage || 'en',
      selectionMode: 'manual',
      availableLogos: visibleFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus: isCustom ? 'custom_override' : 'valid',
      hasEnglishLogo,
      hasJapaneseLogo,
    };
  }

  // 2. Automatic priority selection from Fanart.tv candidates
  if (visibleFanartLogos.length > 0) {
    const topLogo = visibleFanartLogos[0];
    let logoStatus: AnimeLogoStatus = 'valid';
    if (!hasEnglishLogo && hasJapaneseLogo) {
      logoStatus = 'japanese_only';
    } else if (!hasEnglishLogo) {
      logoStatus = 'no_english';
    }

    return {
      logoUrl: topLogo.proxyUrl || topLogo.url,
      selectedLogoSource: topLogo.source,
      selectedLogoLanguage: topLogo.lang || 'en',
      selectionMode: 'auto',
      availableLogos: visibleFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus,
      hasEnglishLogo,
      hasJapaneseLogo,
    };
  }

  // 3. If no Fanart.tv logo exists, check if a custom uploaded logo exists
  if (customLogos.length > 0) {
    const latestCustom = customLogos[customLogos.length - 1];
    return {
      logoUrl: latestCustom.proxyUrl || latestCustom.url,
      selectedLogoSource: 'custom_upload',
      selectedLogoLanguage: latestCustom.lang || 'en',
      selectionMode: 'auto',
      availableLogos: visibleFanartLogos,
      customLogos,
      hiddenLogoIds: Array.from(hiddenSet),
      logoDisplay,
      logoStatus: 'custom_override',
      hasEnglishLogo: true,
      hasJapaneseLogo,
    };
  }

  // 4. Hoshika title typography fallback
  return {
    logoUrl: null,
    selectedLogoSource: 'typography_fallback',
    selectedLogoLanguage: 'en',
    selectionMode: 'auto',
    availableLogos: [],
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

