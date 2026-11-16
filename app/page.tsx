import React from 'react';
import type { Metadata } from 'next';
import { unstable_noStore as noStore } from 'next/cache';
import Link from 'next/link';
import {
  ArrowRight,
  Flame,
  Sparkles,
  TrendingUp,
  Clock,
  Compass,
  FolderKanban,
} from 'lucide-react';
import {
  getHoshikaHomeDetailed,
  getHoshikaBrowseDetailed,
  getHoshikaAnime,
  getCachedHoshikaSummary,
  isHoshikaCooldownActive,
} from '@/lib/hoshika';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';
import { fetchFirestoreDocumentServer } from '@/lib/firebase-admin';
import {
  AnimeManagementFirestoreDoc,
  DEFAULT_ANIME_MANAGEMENT_CONFIG,
  FeaturedAnimeItem,
} from '@/lib/admin/admin-firestore';
import { HoshikaAnimeItem } from '@/types/anime';
import { HomeHeroCarousel, HeroSlideItem } from '@/components/anime/HomeHeroCarousel';
import { AnimeGrid } from '@/components/anime/AnimeGrid';
import { AnimeDetailErrorState } from '@/components/anime/AnimeDetailErrorState';
import { ContinueWatchingRow } from '@/components/anime/ContinueWatchingRow';
import { ResilientImage } from '@/components/ui/ResilientImage';
import {
  DEFAULT_SITE_DESCRIPTION,
  DEFAULT_SITE_TITLE,
  buildBrowseSocialMetadata,
} from '@/lib/social-metadata';

// Revalidate home page every 5 minutes
export const revalidate = 300;

export const metadata: Metadata = buildBrowseSocialMetadata({
  title: DEFAULT_SITE_TITLE,
  description: DEFAULT_SITE_DESCRIPTION,
  path: '/',
  absoluteTitle: true,
});

function featuredToHoshikaItem(item: FeaturedAnimeItem): HoshikaAnimeItem {
  return {
    id: String(item.hoshikaId),
    shortId: item.hoshikaId,
    slug: String(item.hoshikaId),
    titleEnglish: item.title,
    titleRomaji: item.title,
    coverImage: item.coverImage || null,
    bannerImage: item.bannerImage || item.coverImage || null,
    format: item.format || 'TV',
    averageScore: item.rating || null,
  };
}

export default async function HomePage() {
  const [homeSettled, topSettled, docSettled] = await Promise.allSettled([
    getHoshikaHomeDetailed('en'),
    getHoshikaBrowseDetailed('top', 'anime'),
    fetchFirestoreDocumentServer('animeManagement', 'homepage').catch(() => null),
  ]);

  const homeRes =
    homeSettled.status === 'fulfilled'
      ? homeSettled.value
      : ({
          ok: false as const,
          fromCache: false as const,
          error: {
            category: 'UPSTREAM_UNAVAILABLE' as const,
            status: 503,
            endpoint: '/api/v1/home',
            message: 'Home feed unavailable',
            retryable: true,
            durationMs: 0,
          },
        });

  const topRes =
    topSettled.status === 'fulfilled'
      ? topSettled.value
      : ({
          ok: false as const,
          fromCache: false as const,
          error: {
            category: 'UPSTREAM_UNAVAILABLE' as const,
            status: 503,
            endpoint: '/api/v1/browse',
            message: 'Popular feed unavailable',
            retryable: true,
            durationMs: 0,
          },
        });

  const rawHomepageDoc =
    docSettled.status === 'fulfilled' ? docSettled.value : null;

  if (!homeRes.ok || !topRes.ok) {
    noStore();
  }

  const homeData = homeRes.ok
    ? homeRes.data
    : { season: null, seasonal: [], trending: [], recentlyAdded: [] };
  const topAnime = topRes.ok ? topRes.data : [];

  const homepageConfig: Omit<AnimeManagementFirestoreDoc, 'createdAt' | 'updatedAt'> = {
    ...DEFAULT_ANIME_MANAGEMENT_CONFIG,
    ...((rawHomepageDoc || {}) as Partial<AnimeManagementFirestoreDoc>),
    promoBanner: {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG.promoBanner,
      ...(((rawHomepageDoc as any)?.promoBanner || {}) as any),
    },
    sectionOrder:
      Array.isArray((rawHomepageDoc as any)?.sectionOrder) &&
      (rawHomepageDoc as any).sectionOrder.length > 0
        ? (rawHomepageDoc as any).sectionOrder
        : DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder,
    enabledSections: {
      ...DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections,
      ...(((rawHomepageDoc as any)?.enabledSections || {}) as Record<string, boolean>),
    },
  };

  // Hero slides: prioritize Admin-curated featuredAnime, fallback to trending + seasonal
  const curatedFeatured = Array.isArray(homepageConfig.featuredAnime)
    ? homepageConfig.featuredAnime
    : [];

  let heroCandidates: HoshikaAnimeItem[] = [];
  if (curatedFeatured.length > 0) {
    const existingById = new Map<number, HoshikaAnimeItem>();
    for (const item of [
      ...homeData.trending,
      ...homeData.seasonal,
      ...homeData.recentlyAdded,
      ...topAnime,
    ]) {
      if (item?.shortId && !existingById.has(item.shortId)) {
        existingById.set(item.shortId, item);
      }
    }

    const fetchedFeatured: HoshikaAnimeItem[] = [];
    for (const f of curatedFeatured.slice(0, 6)) {
      const existing = existingById.get(f.hoshikaId) || getCachedHoshikaSummary(f.hoshikaId);
      if (existing) {
        fetchedFeatured.push(existing);
        continue;
      }
      if (isHoshikaCooldownActive()) {
        fetchedFeatured.push(featuredToHoshikaItem(f));
        continue;
      }
      const full = await getHoshikaAnime(f.hoshikaId, 'en').catch(() => null);
      fetchedFeatured.push(full || featuredToHoshikaItem(f));
    }
    heroCandidates = fetchedFeatured;
  }

  const fallbackCandidates = [
    ...homeData.trending.slice(0, 4),
    ...homeData.seasonal.slice(0, 3),
    ...topAnime.slice(0, 2),
  ];

  const mergedHeroCandidates = [...heroCandidates, ...fallbackCandidates]
    .filter(
      (item, index, self) => index === self.findIndex((t) => t.shortId === item.shortId)
    )
    .slice(0, 6);

  const heroSlides: HeroSlideItem[] = await Promise.all(
    mergedHeroCandidates.map(async (anime) => {
      const artwork = await resolveAnimeArtwork(anime.shortId, anime);
      return { anime, artwork };
    })
  );

  // Merge pinned seasonal items at front of Seasonal section (deduplicated)
  const pinnedSeasonalItems = (homepageConfig.pinnedSeasonal || []).map(featuredToHoshikaItem);
  const seasonal = [...pinnedSeasonalItems, ...homeData.seasonal]
    .filter(
      (item, index, self) => index === self.findIndex((t) => t.shortId === item.shortId)
    )
    .slice(0, 12);

  const trending = homeData.trending.slice(0, 12);
  const recent = homeData.recentlyAdded.slice(0, 12);
  const popular = topAnime.slice(0, 12);
  const hasCuratedCollections = Boolean(
    homepageConfig.collections?.some(
      (c) => Array.isArray(c.animeItems) && c.animeItems.length > 0
    )
  );
  const hasPromoBanner = Boolean(
    homepageConfig.promoBanner?.enabled && homepageConfig.promoBanner?.title
  );

  // Only show full-page error state if every catalogue & admin-curated section is empty
  if (
    !homeRes.ok &&
    !topRes.ok &&
    heroSlides.length === 0 &&
    trending.length === 0 &&
    seasonal.length === 0 &&
    popular.length === 0 &&
    recent.length === 0 &&
    !hasCuratedCollections &&
    !hasPromoBanner
  ) {
    return (
      <AnimeDetailErrorState
        title="AniScroll Catalogue Temporarily Unavailable"
        description="We could not load the anime catalogue right now due to an upstream connectivity issue. Please try again in a moment."
        code={homeRes.error.category}
      />
    );
  }

  const sectionOrder =
    homepageConfig.sectionOrder || DEFAULT_ANIME_MANAGEMENT_CONFIG.sectionOrder!;
  const enabledSections =
    homepageConfig.enabledSections || DEFAULT_ANIME_MANAGEMENT_CONFIG.enabledSections!;

  const renderSection = (key: string) => {
    if (enabledSections[key] === false) return null;

    switch (key) {
      case 'continue_watching':
        return <ContinueWatchingRow key="continue_watching" />;

      case 'trending':
        return (
          <section key="trending" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TrendingUp size={20} className="text-white" />
                <h2 className="text-xl font-bold tracking-tight text-white">Trending Now</h2>
              </div>
              <Link
                href="/trending"
                className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>View All</span>
                <ArrowRight size={14} />
              </Link>
            </div>
            <AnimeGrid animeList={trending} />
          </section>
        );

      case 'seasonal':
        return (
          <section key="seasonal" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={20} className="text-white" />
                <h2 className="text-xl font-bold tracking-tight text-white">
                  {homeData.season
                    ? `${homeData.season.season} ${homeData.season.year} Season`
                    : 'Current Season'}
                </h2>
              </div>
              <Link
                href="/explore?status=RELEASING"
                className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>Explore Seasonal</span>
                <ArrowRight size={14} />
              </Link>
            </div>
            <AnimeGrid animeList={seasonal} />
          </section>
        );

      case 'popular':
        return (
          <section key="popular" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Flame size={20} className="text-white" />
                <h2 className="text-xl font-bold tracking-tight text-white">All-Time Popular</h2>
              </div>
              <Link
                href="/popular"
                className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>View Top 60</span>
                <ArrowRight size={14} />
              </Link>
            </div>
            <AnimeGrid animeList={popular} />
          </section>
        );

      case 'recent':
        return (
          <section key="recent" className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={20} className="text-white" />
                <h2 className="text-xl font-bold tracking-tight text-white">Recently Updated</h2>
              </div>
              <Link
                href="/recent"
                className="text-xs font-medium text-[#A0A0A0] hover:text-white flex items-center gap-1 transition-colors"
              >
                <span>View All</span>
                <ArrowRight size={14} />
              </Link>
            </div>
            <AnimeGrid animeList={recent} />
          </section>
        );

      case 'collections':
        if (!homepageConfig.collections || homepageConfig.collections.length === 0) {
          return null;
        }
        return (
          <div key="collections" className="space-y-10">
            {homepageConfig.collections
              .filter((c) => Array.isArray(c.animeItems) && c.animeItems.length > 0)
              .map((col) => (
                <section key={col.id} className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <FolderKanban size={18} className="text-white" />
                        <h2 className="text-xl font-bold tracking-tight text-white">
                          {col.title}
                        </h2>
                      </div>
                      {col.subtitle && (
                        <p className="text-xs text-[#A0A0A0] mt-0.5">{col.subtitle}</p>
                      )}
                    </div>
                  </div>
                  <AnimeGrid animeList={col.animeItems.map(featuredToHoshikaItem)} />
                </section>
              ))}
          </div>
        );

      case 'promo_banner': {
        const promo = homepageConfig.promoBanner;
        if (!promo?.enabled || !promo?.title) return null;
        const targetHref =
          promo.hoshikaId && promo.hoshikaId > 0 ? `/anime/${promo.hoshikaId}` : '/explore';
        return (
          <section
            key="promo_banner"
            className="relative overflow-hidden rounded-2xl border border-[#292929] bg-[#0A0A0A] p-7 sm:p-10"
          >
            {promo.backgroundUrl && (
              <div className="absolute inset-0 opacity-25 pointer-events-none">
                <ResilientImage
                  src={promo.backgroundUrl}
                  alt={promo.title}
                  fill
                  sizes="100vw"
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black via-black/80 to-transparent" />
              </div>
            )}
            <div className="relative z-10 max-w-2xl space-y-3">
              {promo.badgeText && (
                <span className="inline-block px-2.5 py-1 rounded bg-white text-black font-mono text-[10px] font-bold uppercase tracking-wider">
                  {promo.badgeText}
                </span>
              )}
              <h2 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                {promo.title}
              </h2>
              {promo.subtitle && (
                <p className="text-xs sm:text-sm text-[#CCCCCC] leading-relaxed">
                  {promo.subtitle}
                </p>
              )}
              <div className="pt-2">
                <Link
                  href={targetHref}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-black hover:bg-neutral-200 font-bold text-xs transition-colors"
                >
                  <span>{promo.ctaText || 'Watch Now'}</span>
                  <ArrowRight size={14} />
                </Link>
              </div>
            </div>
          </section>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div className="w-full">
      {/* Edge-to-Edge Cinematic Featured Anime Hero Carousel */}
      {heroSlides.length > 0 && <HomeHeroCarousel slides={heroSlides} />}

      {/* Content Below Hero: Constrained Padded Layout */}
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 md:px-10 lg:px-12 py-10 space-y-12 pb-24">
        {sectionOrder.map((sectionKey) => renderSection(sectionKey))}

        {/* Category Discovery Kicker */}
        <section className="p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div>
            <h3 className="text-lg font-bold text-white mb-1">
              Looking for something specific?
            </h3>
            <p className="text-xs text-[#A0A0A0] max-w-lg">
              Filter through thousands of titles by genre, release year, airing status, or format with real-time Hoshika catalog filters.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/explore"
              className="px-5 py-2.5 rounded-xl bg-white text-black font-semibold text-xs hover:bg-neutral-200 transition-colors inline-flex items-center gap-2"
            >
              <Compass size={15} />
              <span>Explore Catalogue</span>
            </Link>
            <Link
              href="/schedule"
              className="px-5 py-2.5 rounded-xl bg-transparent border border-white text-white font-medium text-xs hover:bg-white/10 transition-colors"
            >
              Airing Schedule
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
