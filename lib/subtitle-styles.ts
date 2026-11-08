import React from 'react';
import { SubtitlePreferences } from '@/types/streaming';

export function getSubtitleFontFamilyCss(family: SubtitlePreferences['fontFamily']): string {
  switch (family) {
    case 'Arial':
      return 'Arial, "Helvetica Neue", Helvetica, sans-serif';
    case 'Roboto':
      return '"Roboto", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
    case 'Verdana':
      return 'Verdana, Geneva, Tahoma, sans-serif';
    case 'Georgia':
      return 'Georgia, "Times New Roman", Times, serif';
    case 'Monospace':
      return '"JetBrains Mono", "Courier New", Courier, monospace';
    case 'System default':
    default:
      return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  }
}

export function getSubtitleOutlineCss(outline: SubtitlePreferences['outline']): string {
  switch (outline) {
    case 'Thin':
      return (
        '-1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000, 1px 1px 0 #000000, ' +
        '0px -1px 0 #000000, 0px 1px 0 #000000, -1px 0px 0 #000000, 1px 0px 0 #000000'
      );
    case 'Thick':
      return (
        '-2px -2px 0 #000000, 2px -2px 0 #000000, -2px 2px 0 #000000, 2px 2px 0 #000000, ' +
        '-1px -1px 0 #000000, 1px -1px 0 #000000, -1px 1px 0 #000000, 1px 1px 0 #000000, ' +
        '0px -2px 0 #000000, 0px 2px 0 #000000, -2px 0px 0 #000000, 2px 0px 0 #000000'
      );
    case 'None':
    default:
      return 'none';
  }
}

export function getSubtitleShadowCss(shadow: SubtitlePreferences['shadow']): string {
  switch (shadow) {
    case 'Light':
      return '0 2px 4px rgba(0, 0, 0, 0.8)';
    case 'Strong':
      return '0 3px 8px rgba(0, 0, 0, 0.95), 0 0 5px rgba(0, 0, 0, 0.9)';
    case 'Off':
    default:
      return 'none';
  }
}

export function getSubtitleCombinedTextShadow(
  outline: SubtitlePreferences['outline'],
  shadow: SubtitlePreferences['shadow']
): string {
  const outlineCss = getSubtitleOutlineCss(outline);
  const shadowCss = getSubtitleShadowCss(shadow);

  if (outlineCss !== 'none' && shadowCss !== 'none') {
    return `${outlineCss}, ${shadowCss}`;
  }
  if (outlineCss !== 'none') return outlineCss;
  if (shadowCss !== 'none') return shadowCss;
  return 'none';
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  let clean = hex.replace('#', '');
  if (clean.length === 3) {
    clean = clean
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

export function getSubtitleBackgroundCss(
  color: string,
  opacity: number,
  isTransparent: boolean
): string {
  if (isTransparent || opacity <= 0) {
    return 'transparent';
  }
  const { r, g, b } = hexToRgb(color);
  const alpha = Math.min(1, Math.max(0, opacity / 100));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Returns inline CSS styles for rendering subtitle cue text.
 */
export function getSubtitleCueStyles(
  prefs: SubtitlePreferences,
  scale: number = 1
): React.CSSProperties {
  const fontSizePx = Math.round(prefs.fontSize * scale);
  const background = getSubtitleBackgroundCss(
    prefs.backgroundColor,
    prefs.backgroundOpacity,
    prefs.isBackgroundTransparent
  );
  const textShadow = getSubtitleCombinedTextShadow(prefs.outline, prefs.shadow);

  return {
    fontFamily: getSubtitleFontFamilyCss(prefs.fontFamily),
    fontSize: `${fontSizePx}px`,
    fontWeight: prefs.fontWeight === 'Bold' ? 700 : 400,
    color: prefs.textColor,
    backgroundColor: background,
    textShadow: textShadow,
    lineHeight: 1.35,
    padding: background !== 'transparent' ? '4px 12px' : '0 4px',
    borderRadius: background !== 'transparent' ? '4px' : '0px',
    textAlign: prefs.alignment.toLowerCase() as React.CSSProperties['textAlign'],
    display: 'inline-block',
    maxWidth: '90%',
    whiteSpace: 'pre-line',
    wordBreak: 'break-word',
    userSelect: 'none',
    pointerEvents: 'none',
  };
}
