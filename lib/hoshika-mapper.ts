import {
  HoshikaAnimeItem,
  HoshikaCharacter,
  HoshikaEpisodeItem,
  HoshikaGenre,
  HoshikaRecommendation,
  HoshikaRelation,
  HoshikaStreamingLink,
  HoshikaStudio,
  HoshikaVideo,
  ScheduleItem,
} from '@/types/anime';

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function cleanNumber(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function cleanPositiveInt(value: unknown): number | null {
  const num = cleanNumber(value);
  if (num === null || num <= 0) return null;
  return Math.floor(num);
}

function normalizeUrlField(value: unknown): string | null {
  const str = cleanString(value);
  if (!str) return null;
  if (str.startsWith('//')) return `https:${str}`;
  if (str.startsWith('http://')) return `https://${str.slice(7)}`;
  return str;
}

function extractUniqueStrings(...lists: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (typeof item !== 'string') continue;
      const trimmed = item.trim();
      if (!trimmed || seen.has(trimmed)) continue;
      seen.add(trimmed);
      out.push(trimmed);
    }
  }
  return out;
}

function mapGenres(rawGenres: unknown): HoshikaGenre[] | undefined {
  if (!Array.isArray(rawGenres)) return undefined;
  const out: HoshikaGenre[] = [];
  for (const g of rawGenres) {
    if (typeof g === 'string') {
      const name = g.trim();
      if (name) {
        out.push({
          name,
          slug: name.toLowerCase().replace(/[\s_]+/g, '-'),
        });
      }
      continue;
    }
    if (g && typeof g === 'object') {
      const name = cleanString((g as any).name);
      const slug =
        cleanString((g as any).slug) ||
        (name ? name.toLowerCase().replace(/[\s_]+/g, '-') : null);
      if (name && slug) {
        out.push({ name, slug });
      }
    }
  }
  return out;
}

function mapStudios(rawStudios: unknown): HoshikaStudio[] | undefined {
  if (!Array.isArray(rawStudios)) return undefined;
  const out: HoshikaStudio[] = [];
  for (const s of rawStudios) {
    if (typeof s === 'string') {
      const name = s.trim();
      if (name) {
        out.push({
          name,
          slug: name.toLowerCase().replace(/[\s_]+/g, '-'),
        });
      }
      continue;
    }
    if (s && typeof s === 'object') {
      const name = cleanString((s as any).name);
      const slug =
        cleanString((s as any).slug) ||
        (name ? name.toLowerCase().replace(/[\s_]+/g, '-') : null);
      if (name && slug) {
        out.push({ name, slug });
      }
    }
  }
  return out;
}

function mapCharacters(rawChars: unknown): HoshikaCharacter[] | undefined {
  if (!Array.isArray(rawChars)) return undefined;
  const out: HoshikaCharacter[] = [];
  for (const c of rawChars) {
    if (!c || typeof c !== 'object') continue;
    const obj = c as Record<string, any>;
    const name = cleanString(obj.name);
    if (!name) continue;
    const seiyuuObj =
      obj.seiyuu && typeof obj.seiyuu === 'object' ? obj.seiyuu : null;
    out.push({
      id: cleanString(obj.id) || name.toLowerCase().replace(/\s+/g, '-'),
      name,
      role: cleanString(obj.role) || 'SUPPORTING',
      avatar: normalizeUrlField(obj.avatar),
      seiyuu:
        seiyuuObj && cleanString(seiyuuObj.name)
          ? {
              id:
                cleanString(seiyuuObj.id) ||
                cleanString(seiyuuObj.name)!.toLowerCase().replace(/\s+/g, '-'),
              name: cleanString(seiyuuObj.name)!,
              avatar: normalizeUrlField(seiyuuObj.avatar),
            }
          : null,
    });
  }
  return out;
}

function mapRelations(rawRelations: unknown): HoshikaRelation[] | undefined {
  if (!Array.isArray(rawRelations)) return undefined;
  const out: HoshikaRelation[] = [];
  for (const r of rawRelations) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, any>;
    const shortId = cleanPositiveInt(obj.shortId ?? obj.id);
    if (!shortId) continue;
    const singleTitle = cleanString(obj.title);
    out.push({
      id: cleanString(obj.id) || String(shortId),
      shortId,
      slug: cleanString(obj.slug) || String(shortId),
      relationType: cleanString(obj.relationType) || 'RELATED',
      title: singleTitle,
      titleRomaji: cleanString(obj.titleRomaji) || singleTitle,
      titleEnglish: cleanString(obj.titleEnglish) || singleTitle,
      coverImage: normalizeUrlField(obj.coverImage),
      format: cleanString(obj.format),
    });
  }
  return out;
}

function mapRecommendations(
  rawRecs: unknown
): HoshikaRecommendation[] | undefined {
  if (!Array.isArray(rawRecs)) return undefined;
  const out: HoshikaRecommendation[] = [];
  for (const r of rawRecs) {
    if (!r || typeof r !== 'object') continue;
    const obj = r as Record<string, any>;
    const shortId = cleanPositiveInt(obj.shortId ?? obj.id);
    if (!shortId) continue;
    const singleTitle = cleanString(obj.title);
    out.push({
      id: cleanString(obj.id) || String(shortId),
      shortId,
      slug: cleanString(obj.slug) || String(shortId),
      title: singleTitle,
      titleRomaji: cleanString(obj.titleRomaji) || singleTitle,
      titleEnglish: cleanString(obj.titleEnglish) || singleTitle,
      coverImage: normalizeUrlField(obj.coverImage),
      averageScore: cleanNumber(obj.averageScore),
      format: cleanString(obj.format),
    });
  }
  return out;
}

function mapVideos(rawVideos: unknown): HoshikaVideo[] | undefined {
  if (!Array.isArray(rawVideos)) return undefined;
  const out: HoshikaVideo[] = [];
  for (const v of rawVideos) {
    if (!v || typeof v !== 'object') continue;
    const obj = v as Record<string, any>;
    const id = cleanString(obj.id) || cleanString(obj.youtubeId);
    if (!id) continue;
    out.push({
      id,
      title: cleanString(obj.title),
      youtubeId: cleanString(obj.youtubeId),
      image: normalizeUrlField(obj.image),
    });
  }
  return out;
}

function mapStreamingLinks(
  rawStreaming: unknown
): HoshikaStreamingLink[] | undefined {
  if (!Array.isArray(rawStreaming)) return undefined;
  const out: HoshikaStreamingLink[] = [];
  for (const item of rawStreaming) {
    if (!item || typeof item !== 'object') continue;
    const platform = cleanString((item as any).platform);
    const url = cleanString((item as any).url);
    if (platform && url) {
      out.push({ platform, url });
    }
  }
  return out;
}

/**
 * Safely maps any Hoshika v1 anime payload (detail, home, browse, catalog, search,
 * schedule, or genre-titles) into AniScroll's normalized HoshikaAnimeItem interface
 * without breaking backwards compatibility or failing on missing optional fields.
 */
export function mapHoshikaAnimeItem(raw: unknown): HoshikaAnimeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;

  const shortId = cleanPositiveInt(obj.shortId);
  const rawId = cleanString(obj.id) || (shortId ? String(shortId) : null);

  if (!shortId && !rawId) {
    return null;
  }

  const effectiveShortId = shortId ?? cleanPositiveInt(rawId) ?? 0;
  if (!effectiveShortId) {
    return null;
  }

  // `/api/v1/genre/{slug}` returns `title` rather than titleEnglish/titleRomaji/titleLocalized
  const fallbackTitle = cleanString(obj.title);
  const titleEnglish = cleanString(obj.titleEnglish);
  const titleRomaji = cleanString(obj.titleRomaji);
  const titleLocalized =
    cleanString(obj.titleLocalized) ||
    (!titleEnglish && !titleRomaji ? fallbackTitle : null);

  const mergedSynonyms = extractUniqueStrings(
    obj.synonyms,
    obj.alternativeTitles,
    obj.altTitles
  );

  const videos = mapVideos(obj.videos);
  let trailerId = cleanString(obj.trailerId);
  let trailerSite = cleanString(obj.trailerSite);
  if (!trailerId && videos && videos.length > 0) {
    const firstYt = videos.find((v) => v.youtubeId);
    if (firstYt?.youtubeId) {
      trailerId = firstYt.youtubeId;
      trailerSite = trailerSite || 'youtube';
    }
  }

  const mapped: HoshikaAnimeItem = {
    ...obj,
    id: rawId || String(effectiveShortId),
    shortId: effectiveShortId,
    slug: cleanString(obj.slug) || String(effectiveShortId),
    titleRomaji: titleRomaji ?? null,
    titleEnglish: titleEnglish ?? (!titleRomaji ? fallbackTitle : null),
    titleJapanese: cleanString(obj.titleJapanese),
    titleLocalized,
    nativeTitle: cleanString(obj.nativeTitle),
    originalTitle: cleanString(obj.originalTitle),
    synonyms: mergedSynonyms,
    alternativeTitles: mergedSynonyms,
    synopsis: cleanString(obj.synopsis),
    coverImage: normalizeUrlField(obj.coverImage),
    bannerImage: normalizeUrlField(obj.bannerImage),
    bannerFocusX: cleanNumber(obj.bannerFocusX),
    bannerFocusY: cleanNumber(obj.bannerFocusY),
    format: cleanString(obj.format),
    status: cleanString(obj.status),
    season: cleanString(obj.season),
    seasonYear: cleanPositiveInt(obj.seasonYear),
    source: cleanString(obj.source),
    episodes: cleanPositiveInt(obj.episodes),
    episodeDuration: cleanPositiveInt(obj.episodeDuration),
    averageScore: cleanNumber(obj.averageScore),
    canonScore: cleanNumber(obj.canonScore),
    canonCount: cleanNumber(obj.canonCount),
    rating: cleanString(obj.rating),
    demographic: cleanString(obj.demographic),
    favoriteCount: cleanNumber(obj.favoriteCount),
    trailerId,
    trailerSite,
    startedAiring: cleanString(obj.startedAiring),
    finishedAiring: cleanString(obj.finishedAiring),
    genres: mapGenres(obj.genres),
    studios: mapStudios(obj.studios),
    characters: mapCharacters(obj.characters),
    relations: mapRelations(obj.relations),
    recommendations: mapRecommendations(obj.recommendations),
    videos,
    pictures: Array.isArray(obj.pictures)
      ? obj.pictures
          .map((p) => normalizeUrlField(p))
          .filter((p): p is string => Boolean(p))
      : undefined,
    streaming: mapStreamingLinks(obj.streaming),
    stats: obj.stats && typeof obj.stats === 'object' ? obj.stats : null,
    nextEpisodeNumber: cleanPositiveInt(obj.nextEpisodeNumber),
    nextEpisodeAiringAt: cleanString(obj.nextEpisodeAiringAt),
    anilistId: cleanPositiveInt(obj.anilistId),
    malId: cleanPositiveInt(obj.malId),
    thetvdbId:
      typeof obj.thetvdbId === 'number' || typeof obj.thetvdbId === 'string'
        ? obj.thetvdbId
        : null,
    themoviedbId:
      typeof obj.themoviedbId === 'number' || typeof obj.themoviedbId === 'string'
        ? obj.themoviedbId
        : null,
    isStandaloneMovie:
      typeof obj.isStandaloneMovie === 'boolean' ? obj.isStandaloneMovie : null,
    standaloneMovie:
      typeof obj.standaloneMovie === 'boolean' ? obj.standaloneMovie : null,
  };

  return mapped;
}

export function mapHoshikaAnimeList(rawItems: unknown): HoshikaAnimeItem[] {
  if (!Array.isArray(rawItems)) return [];
  const out: HoshikaAnimeItem[] = [];
  for (const item of rawItems) {
    const mapped = mapHoshikaAnimeItem(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function mapHoshikaEpisodeItem(raw: unknown): HoshikaEpisodeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, any>;
  const num = cleanNumber(obj.number);
  if (num === null || num < 0) return null;

  return {
    id: cleanString(obj.id) || `ep-${num}`,
    number: num,
    title: cleanString(obj.title),
    synopsis: cleanString(obj.synopsis),
    thumbnail: normalizeUrlField(obj.thumbnail),
    aired: cleanString(obj.aired),
    filler: Boolean(obj.filler),
    recap: Boolean(obj.recap),
    averageScore: cleanNumber(obj.averageScore),
    youtubeId: cleanString(obj.youtubeId),
  };
}

export function mapHoshikaEpisodeList(rawItems: unknown): HoshikaEpisodeItem[] {
  if (!Array.isArray(rawItems)) return [];
  const out: HoshikaEpisodeItem[] = [];
  for (const item of rawItems) {
    const mapped = mapHoshikaEpisodeItem(item);
    if (mapped) out.push(mapped);
  }
  return out;
}

export function mapHoshikaScheduleItem(raw: unknown): ScheduleItem | null {
  const base = mapHoshikaAnimeItem(raw);
  if (!base) return null;
  const obj = raw as Record<string, any>;
  return {
    ...base,
    episode: cleanPositiveInt(obj.episode) ?? undefined,
    airingAt: cleanString(obj.airingAt) ?? undefined,
  };
}

export function validateHoshikaAnimeDetailPayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  if (!data.anime || typeof data.anime !== 'object') {
    return 'Missing required anime object in Hoshika response';
  }
  if (!cleanPositiveInt(data.anime.shortId) && !cleanString(data.anime.id)) {
    return 'Anime record missing required shortId/id';
  }
  return null;
}

export function validateHoshikaEpisodesPayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  if (!Array.isArray(data.items)) {
    return 'Missing required items array in Hoshika episodes response';
  }
  return null;
}

export function validateHoshikaHomePayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  const hasAnySection =
    Array.isArray(data.trending) ||
    Array.isArray(data.seasonal) ||
    Array.isArray(data.recentlyAdded);
  if (!hasAnySection) {
    return 'Missing home feed sections (trending/seasonal/recentlyAdded)';
  }
  return null;
}

export function validateHoshikaItemsPayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  if (!Array.isArray(data.items)) {
    return 'Missing required items array in Hoshika response';
  }
  return null;
}

export function validateHoshikaSearchPayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  if (!Array.isArray(data.anime)) {
    return 'Missing required anime array in Hoshika search response';
  }
  return null;
}

export function validateHoshikaGenresPayload(data: any): string | null {
  if (!data || typeof data !== 'object') return 'Response body is not a JSON object';
  if (data.ok === false) return `API ok=false (${data.code || 'unknown'})`;
  if (!Array.isArray(data.genres)) {
    return 'Missing required genres array in Hoshika response';
  }
  return null;
}
