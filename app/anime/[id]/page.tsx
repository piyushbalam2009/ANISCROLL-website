import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getHoshikaAnime, getHoshikaEpisodes } from '@/lib/hoshika';
import { EpisodeList } from '@/components/anime/EpisodeList';
import { CharacterList } from '@/components/anime/CharacterList';
import { AnimeDetailActions } from '@/components/anime/AnimeDetailActions';
import { Star, Film, ChevronRight } from 'lucide-react';

interface AnimePageProps {
  params: Promise<{ id: string }>;
}

export const revalidate = 300;

export default async function AnimePage({ params }: AnimePageProps) {
  const { id } = await params;
  const [anime, episodeData] = await Promise.all([
    getHoshikaAnime(id, 'en'),
    getHoshikaEpisodes(id, 'en'),
  ]);

  if (!anime) {
    notFound();
  }

  const title =
    anime.titleEnglish ||
    anime.titleRomaji ||
    anime.titleLocalized ||
    'Anime Details';

  const backdrop = anime.bannerImage || anime.coverImage;

  return (
    <div className="space-y-10 pb-20">
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

      {/* Hero Banner with Measured Scrim */}
      <div className="relative w-full rounded-2xl overflow-hidden bg-[#0A0A0A] border border-[#292929] min-h-[360px] md:min-h-[440px] flex items-end">
        {backdrop && (
          <div className="absolute inset-0 z-0">
            <Image
              src={backdrop}
              alt={title}
              fill
              priority
              sizes="100vw"
              className="object-cover object-top opacity-40 filter brightness-75"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/80 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black via-black/60 to-transparent" />
          </div>
        )}

        {/* Header Content */}
        <div className="relative z-10 p-6 md:p-10 flex flex-col md:flex-row gap-6 md:gap-8 items-start md:items-end w-full">
          {/* Poster Card */}
          <div className="relative w-36 sm:w-44 md:w-52 aspect-[3/4] bg-[#141414] rounded-xl overflow-hidden shadow-2xl border border-[#292929] shrink-0">
            {anime.coverImage ? (
              <Image
                src={anime.coverImage}
                alt={title}
                fill
                priority
                sizes="210px"
                className="object-cover"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-[#707070]">
                <Film size={32} />
              </div>
            )}
          </div>

          {/* Details Intro */}
          <div className="flex-1 min-w-0">
            {/* Metadata Line (Clean unboxed text) */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-[#A0A0A0] mb-2.5">
              <span className="font-semibold text-white uppercase tracking-wider">
                {anime.format || 'TV'}
              </span>
              {anime.seasonYear && (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <span>{anime.seasonYear}</span>
                </>
              )}
              {anime.season && (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <span className="capitalize">{anime.season.toLowerCase()}</span>
                </>
              )}
              {anime.status && (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <span className="text-[11px] uppercase tracking-wider font-mono">
                    {anime.status}
                  </span>
                </>
              )}
              {anime.averageScore ? (
                <>
                  <span aria-hidden="true" className="text-[#707070]">·</span>
                  <div className="flex items-center gap-1 text-white font-mono">
                    <Star size={13} fill="currentColor" />
                    <span>{(anime.averageScore / 10).toFixed(1)}/10</span>
                  </div>
                </>
              ) : null}
            </div>

            <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-white tracking-tight leading-tight">
              {title}
            </h1>

            {anime.titleJapanese && (
              <div className="text-sm md:text-base text-[#707070] mt-1 font-sans">
                {anime.titleJapanese}
              </div>
            )}

            {/* Genres */}
            {anime.genres && anime.genres.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 mt-4 text-xs text-[#A0A0A0]">
                {anime.genres.map((g, idx) => (
                  <React.Fragment key={g.slug || idx}>
                    <Link
                      href={`/genres/${g.slug}`}
                      className="hover:text-white transition-colors"
                    >
                      {g.name}
                    </Link>
                    {idx < anime.genres!.length - 1 && (
                      <span aria-hidden="true" className="text-[#707070]">·</span>
                    )}
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* CTA Actions */}
            <AnimeDetailActions anime={anime} />
          </div>
        </div>
      </div>

      {/* Main Grid: Details Sidebar & Episodes */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left Column: Metadata & Studios */}
        <div className="lg:col-span-1 space-y-6">
          <div className="p-5 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-4 text-xs">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider pb-2 border-b border-[#292929]">
              Information
            </h3>

            {anime.titleRomaji && anime.titleRomaji !== title && (
              <div>
                <span className="text-[#707070] block mb-0.5">Romaji Title</span>
                <span className="text-white font-medium">{anime.titleRomaji}</span>
              </div>
            )}

            {anime.studios && anime.studios.length > 0 && (
              <div>
                <span className="text-[#707070] block mb-0.5">Studios</span>
                <div className="text-white font-medium">
                  {anime.studios.map((s) => s.name).join(', ')}
                </div>
              </div>
            )}

            {anime.episodes && (
              <div>
                <span className="text-[#707070] block mb-0.5">Episodes</span>
                <span className="text-white font-mono font-medium">{anime.episodes}</span>
              </div>
            )}

            {anime.episodeDuration && (
              <div>
                <span className="text-[#707070] block mb-0.5">Episode Duration</span>
                <span className="text-white font-mono">{anime.episodeDuration} minutes</span>
              </div>
            )}

            {anime.rating && (
              <div>
                <span className="text-[#707070] block mb-0.5">Age Rating</span>
                <span className="text-white">{anime.rating}</span>
              </div>
            )}

            {anime.startedAiring && (
              <div>
                <span className="text-[#707070] block mb-0.5">Premiered</span>
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
                <span className="text-[#707070] block mb-0.5">Hoshika Canon Score</span>
                <span className="text-white font-mono">{anime.canonScore}/100</span>
              </div>
            )}
          </div>

          {/* YouTube Trailer Embed if available */}
          {anime.trailerId && (
            <div className="p-4 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-2">
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                Official Trailer
              </h4>
              <div className="aspect-video rounded-xl overflow-hidden bg-black border border-[#292929]">
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

        {/* Right Column: Synopsis, Episode List & Characters */}
        <div className="lg:col-span-3 space-y-10">
          {/* Synopsis */}
          {anime.synopsis && (
            <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929] space-y-2">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                Synopsis
              </h3>
              <p className="text-sm text-[#A0A0A0] leading-relaxed whitespace-pre-line">
                {anime.synopsis}
              </p>
            </div>
          )}

          {/* Episode List */}
          <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
            <EpisodeList
              animeId={anime.shortId}
              episodes={episodeData.items}
              totalEpisodes={anime.episodes || episodeData.total}
            />
          </div>

          {/* Characters and Seiyuu */}
          {anime.characters && anime.characters.length > 0 && (
            <div className="p-6 rounded-2xl bg-[#0A0A0A] border border-[#292929]">
              <CharacterList characters={anime.characters} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
