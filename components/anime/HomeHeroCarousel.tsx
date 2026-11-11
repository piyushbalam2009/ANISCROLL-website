'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { HoshikaAnimeItem } from '@/types/anime';
import { AnimeArtworkResult } from '@/types/artwork';
import { CinematicHeroBanner } from './CinematicHeroBanner';

export interface HeroSlideItem {
  anime: HoshikaAnimeItem;
  artwork?: AnimeArtworkResult | null;
}

interface HomeHeroCarouselProps {
  slides: HeroSlideItem[];
  intervalMs?: number;
}

export function HomeHeroCarousel({
  slides,
  intervalMs = 7000,
}: HomeHeroCarouselProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [isPaused, setIsPaused] = useState(false);

  // Swipe gestures
  const touchStartX = useRef<number | null>(null);
  const touchEndX = useRef<number | null>(null);

  const total = slides.length;

  const goToNext = useCallback(() => {
    if (total <= 1) return;
    setDirection(1);
    setCurrentIndex((prev) => (prev + 1) % total);
  }, [total]);

  const goToPrev = useCallback(() => {
    if (total <= 1) return;
    setDirection(-1);
    setCurrentIndex((prev) => (prev - 1 + total) % total);
  }, [total]);

  const goToSlide = (idx: number) => {
    if (idx === currentIndex) return;
    setDirection(idx > currentIndex ? 1 : -1);
    setCurrentIndex(idx);
  };

  // Autoplay timer with pause on hover or interaction
  useEffect(() => {
    if (isPaused || total <= 1) return;

    const timer = setInterval(() => {
      goToNext();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [goToNext, isPaused, intervalMs, total]);

  // Keyboard navigation (ArrowLeft & ArrowRight)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      if (e.key === 'ArrowRight') {
        goToNext();
      } else if (e.key === 'ArrowLeft') {
        goToPrev();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [goToNext, goToPrev]);

  // Touch handlers for mobile swipe
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchEndX.current = null;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchEndX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current === null || touchEndX.current === null) return;
    const diff = touchStartX.current - touchEndX.current;
    const minSwipeDistance = 45;

    if (diff > minSwipeDistance) {
      goToNext();
    } else if (diff < -minSwipeDistance) {
      goToPrev();
    }

    touchStartX.current = null;
    touchEndX.current = null;
  };

  if (!slides || slides.length === 0) {
    return null;
  }

  const currentSlide = slides[currentIndex];
  const nextSlide = total > 1 ? slides[(currentIndex + 1) % total] : null;
  const nextBackdropUrl =
    nextSlide?.artwork?.backgroundUrl ||
    nextSlide?.anime.bannerImage ||
    nextSlide?.anime.coverImage ||
    null;

  return (
    <div
      className="relative w-full select-none overflow-hidden bg-black"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      aria-roledescription="carousel"
      aria-label="Featured Anime Carousel"
    >
      <div className="relative w-full overflow-hidden">
        <AnimatePresence mode="wait" initial={false} custom={direction}>
          <motion.div
            key={currentSlide.anime.shortId}
            custom={direction}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
            className="w-full"
          >
            <CinematicHeroBanner
              anime={currentSlide.anime}
              artwork={currentSlide.artwork}
              mode="home"
              priority={true}
            />
          </motion.div>
        </AnimatePresence>

        {/* Preload next slide's primary backdrop image off-screen for zero-flash transitions */}
        {nextBackdropUrl && (
          <div
            className="pointer-events-none fixed -left-[9999px] -top-[9999px] w-1 h-1 overflow-hidden opacity-0"
            aria-hidden="true"
          >
            <Image
              src={nextBackdropUrl}
              alt=""
              width={1280}
              height={720}
              sizes="100vw"
              referrerPolicy="no-referrer"
            />
          </div>
        )}

        {/* Carousel Navigation Arrow Controls on Left and Right Edges */}
        {total > 1 && (
          <>
            {/* Left Prev Arrow Button */}
            <button
              type="button"
              onClick={goToPrev}
              className="absolute left-4 sm:left-6 md:left-8 top-1/2 -translate-y-1/2 z-30 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-xl border border-white/20 hover:border-white text-white flex items-center justify-center transition-all duration-200 active:scale-90 shadow-2xl"
              aria-label="Previous slide"
              title="Previous Slide"
            >
              <ChevronLeft size={22} />
            </button>

            {/* Right Next Arrow Button */}
            <button
              type="button"
              onClick={goToNext}
              className="absolute right-4 sm:right-6 md:right-8 top-1/2 -translate-y-1/2 z-30 w-11 h-11 sm:w-12 sm:h-12 rounded-full bg-black/60 hover:bg-black/90 backdrop-blur-xl border border-white/20 hover:border-white text-white flex items-center justify-center transition-all duration-200 active:scale-90 shadow-2xl"
              aria-label="Next slide"
              title="Next Slide"
            >
              <ChevronRight size={22} />
            </button>

            {/* Bottom-Center Pagination Indicators (Monochrome Dots + Active White Pill Dash) */}
            <div
              className="absolute bottom-6 sm:bottom-8 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 pointer-events-auto"
              role="tablist"
              aria-label="Carousel pagination"
            >
              {slides.map((s, idx) => {
                const isActive = idx === currentIndex;
                return (
                  <button
                    key={s.anime.shortId}
                    type="button"
                    onClick={() => goToSlide(idx)}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      isActive
                        ? 'w-6 bg-white shadow-md'
                        : 'w-2 bg-white/40 hover:bg-white/70'
                    }`}
                    aria-label={`Go to slide ${idx + 1}: ${
                      s.anime.titleEnglish || s.anime.titleRomaji
                    }`}
                    aria-selected={isActive}
                    role="tab"
                  />
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
