'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import Image from 'next/image';
import { buildResilientImageCandidates } from '@/lib/image-url';

export interface ResilientImageProps {
  src?: string | null;
  fallbackSrcs?: Array<string | null | undefined>;
  alt: string;
  fill?: boolean;
  width?: number;
  height?: number;
  sizes?: string;
  priority?: boolean;
  className?: string;
  fallback?: React.ReactNode;
  onAllFailed?: () => void;
}

/**
 * Renders Next.js <Image> with optimization enabled by default, and transparently
 * recovers from Vercel /_next/image failures (402 quota, 401 Deployment Protection,
 * 502/504 upstream timeout, 400 pattern mismatch) by retrying the direct URL and
 * ordered fallback candidates before cleanly rendering the provided fallback UI.
 */
export function ResilientImage({
  src,
  fallbackSrcs,
  alt,
  fill = false,
  width,
  height,
  sizes,
  priority = false,
  className = '',
  fallback = null,
  onAllFailed,
}: ResilientImageProps) {
  const candidatesKeyRaw = [src || '', ...(fallbackSrcs || [])]
    .filter(Boolean)
    .join('|');

  const candidates = useMemo(
    () => buildResilientImageCandidates(src, fallbackSrcs),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [candidatesKeyRaw]
  );

  const candidatesKey = candidates.join('|');
  const [attemptIndex, setAttemptIndex] = useState(0);
  const [useDirectImg, setUseDirectImg] = useState(false);
  const [exhausted, setExhausted] = useState(false);

  const onAllFailedRef = useRef(onAllFailed);
  useEffect(() => {
    onAllFailedRef.current = onAllFailed;
  }, [onAllFailed]);

  useEffect(() => {
    setAttemptIndex(0);
    setUseDirectImg(false);
    setExhausted(false);
  }, [candidatesKey]);

  if (exhausted || candidates.length === 0) {
    return <>{fallback}</>;
  }

  const activeSrc = candidates[attemptIndex];
  if (!activeSrc) {
    return <>{fallback}</>;
  }

  const handleNextImageError = () => {
    // First failure on Next.js /_next/image: retry same URL directly in browser
    // (bypasses Vercel Image Optimization 402/401/504/400 issues)
    if (!useDirectImg) {
      setUseDirectImg(true);
      return;
    }
    handleDirectImgError();
  };

  const handleDirectImgError = () => {
    if (attemptIndex + 1 < candidates.length) {
      setAttemptIndex((prev) => prev + 1);
      setUseDirectImg(true);
    } else {
      setExhausted(true);
      onAllFailedRef.current?.();
    }
  };

  if (useDirectImg) {
    const directClassName = fill
      ? `absolute inset-0 w-full h-full ${className}`.trim()
      : className;

    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        key={`direct-${activeSrc}`}
        src={activeSrc}
        alt={alt}
        width={!fill ? width : undefined}
        height={!fill ? height : undefined}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        referrerPolicy="no-referrer"
        className={directClassName}
        onError={handleDirectImgError}
      />
    );
  }

  return (
    <Image
      key={`next-${activeSrc}`}
      src={activeSrc}
      alt={alt}
      fill={fill}
      width={!fill ? width : undefined}
      height={!fill ? height : undefined}
      sizes={sizes}
      priority={priority}
      className={className}
      referrerPolicy="no-referrer"
      onError={handleNextImageError}
    />
  );
}
