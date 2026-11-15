import React, { cache } from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHoshikaAnime, getHoshikaEpisodes } from '@/lib/hoshika';
import { resolveAnimeArtwork } from '@/lib/artwork-mapper';
import { getCachedOrWarmServerAudioAvailability } from '@/lib/aniscroll';
import { loadAnimeDetailData } from '@/lib/anime-detail-episodes';
import {
  buildAnimeJsonLd,
  buildAnimeSocialMetadata,
  resolveCanonicalOrigin,
  safeJsonLdStringify,
} from '@/lib/social-metadata';
import { AnimeDetailsHero } from '@/components/anime/AnimeDetailsHero';
import { EpisodeSection } from '@/components/episodes/EpisodeSection';
import { CharacterList } from '@/components/anime/CharacterList';
import { ChevronRight } from 'lucide-react';

interface AnimePageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 180;

const getCachedHoshikaAnime = cache((id: string) => getHoshikaAnime(id, 'en'));

export async function generateMetadata({
  params,
}: AnimePageProps): Promise<Metadata> {
  const { id } = await params;
  const anime = await getCachedHoshikaAnime(id).catch(() => null);
  return buildAnimeSocialMetadata(anime, id);
}

export default async function AnimePage({ params }: AnimePageProps) {
  const { id } = await params;
  const {
    anime,
    showEpisodesSection,
    episodes,
    totalEpisodes,
    initialAvailability,
    artwork,
  } = await loadAnimeDetailData(id, {
    getAnime: (animeId) => getCachedHoshikaAnime(animeId),
    getEpisodes: (animeId) => getHoshikaEpisodes(animeId, 'en', undefined, 50),
    resolveArtwork: (animeId, item) => resolveAnimeArtwork(animeId, item),
    getCachedAvailability: getCachedOrWarmServerAudioAvailability,
  });

  if (!anime) {
    notFound();
  }

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Anime Details';

  const origin = resolveCanonicalOrigin();
  const canonicalId = anime.shortId || id;
  const jsonLd = buildAnimeJsonLd({
    anime,
    canonicalUrl: `${origin}/anime/${canonicalId}`,
    imageUrl: `${origin}/api/og/anime/${canonicalId}`,
  });

  return (
    <div className="w-full">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLdStringify(jsonLd) }}
      />
      {/* Edge-to-Edge Cinematic Anime Details Hero Banner with Fanart.tv Artwork & Left Poster */}
      <AnimeDetailsHero
        anime={anime}
        artwork={artwork}
        availability={initialAvailability}
        priority={true}
      />

      {/* Content Below Hero: Constrained Padded Layout (No duplicate poster) */}
      <div className="w-full max-w-[1600px] mx-auto px-4 sm:px-6 md:px-10 lg:px-12 py-8 space-y-8 pb-24">
        {/* Breadcrumb Navigation */}
        <nav className="flex items-center gap-2 text-xs text-[#707070]">
          <Link href="/" className="hover:text-white transition-colors">
            Home
          </Link>
          <ChevronRight size={13} />
          <Link href="/explore" className="hover:text-white transition-colors">
            Anime
          </Link>
          <ChevronRight size={13} />
          <span className="text-white truncate max-w-xs">{title}</span>
        </nav>
        {/* 1. Full-Width Synopsis */}
        {anime.synopsis && (
          <section className="p-6 sm:p-8 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider">
              Synopsis
            </h2>
            <p className="text-sm sm:text-base text-[#B0B0B0] leading-relaxed whitespace-pre-line max-w-5xl">
              {anime.synopsis}
            </p>
          </section>
        )}

        {/* 2. Additional Information & Official Trailer Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Metadata Information Cards */}
          <div className={`${anime.trailerId ? 'lg:col-span-2' : 'lg:col-span-3'} p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-4`}>
            <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-2 border-b border-[#292929]">
              Series Details
            </h3>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
              {anime.titleRomaji && anime.titleRomaji !== title && (
                <div>
                  <span className="text-[#707070] block mb-1">Romaji Title</span>
                  <span className="text-white font-medium">{anime.titleRomaji}</span>
                </div>
              )}

              {anime.titleJapanese && (
                <div>
                  <span className="text-[#707070] block mb-1">Japanese Title</span>
                  <span className="text-white font-medium">{anime.titleJapanese}</span>
                </div>
              )}

              {anime.studios && anime.studios.length > 0 && (
                <div>
                  <span className="text-[#707070] block mb-1">Studios</span>
                  <div className="text-white font-medium">
                    {anime.studios.map((s) => s.name).join(', ')}
                  </div>
                </div>
              )}

              {anime.episodes && (
                <div>
                  <span className="text-[#707070] block mb-1">Total Episodes</span>
                  <span className="text-white font-mono font-medium">{anime.episodes}</span>
                </div>
              )}

              {anime.episodeDuration && (
                <div>
                  <span className="text-[#707070] block mb-1">Episode Duration</span>
                  <span className="text-white font-mono">{anime.episodeDuration} minutes</span>
                </div>
              )}

              {anime.rating && (
                <div>
                  <span className="text-[#707070] block mb-1">Age Rating</span>
                  <span className="text-white">{anime.rating}</span>
                </div>
              )}

              {anime.startedAiring && (
                <div>
                  <span className="text-[#707070] block mb-1">Premiered</span>
                  <span className="text-white">
                    {new Date(anime.startedAiring).toLocaleDateString([], {
                      year: 'numeric',
                      month: 'short',
                      day: 'numeric',
                    })}
                  </span>
                </div>
              )}

              {anime.canonScore && (
                <div>
                  <span className="text-[#707070] block mb-1">Canon Score</span>
                  <span className="text-white font-mono">{anime.canonScore}/100</span>
                </div>
              )}

              {anime.demographic && (
                <div>
                  <span className="text-[#707070] block mb-1">Demographic</span>
                  <span className="text-white font-medium">{anime.demographic}</span>
                </div>
              )}
            </div>
          </div>

          {/* Official YouTube Trailer if available */}
          {anime.trailerId && (
            <div className="lg:col-span-1 p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-3 flex flex-col">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-2 border-b border-[#292929]">
                Official Trailer
              </h3>
              <div className="relative aspect-video w-full rounded-xl overflow-hidden bg-black border border-[#292929] flex-1">
                <iframe
                  src={`https://www.youtube.com/embed/${anime.trailerId}`}
                  title={`${title} trailer`}
                  className="w-full h-full border-0"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>
          )}
        </div>

        {/* 3. Full-Width 50-Episode Pagination & Range Selector Section (Hidden for Movies) */}
        {showEpisodesSection && (
          <section
            data-testid="anime-episodes-section"
            className="p-4 sm:p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929]"
          >
            <EpisodeSection
              animeId={anime.shortId}
              episodes={episodes}
              totalEpisodes={totalEpisodes}
              format={anime.format}
              isStandaloneMovie={
                anime.isStandaloneMovie === true || anime.standaloneMovie === true
              }
              initialAvailability={initialAvailability}
            />
          </section>
        )}

        {/* 4. Full-Width Characters & Seiyuu */}
        {anime.characters && anime.characters.length > 0 && (
          <section className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
            <CharacterList characters={anime.characters} />
          </section>
        )}
      </div>
    </div>
  );
}
