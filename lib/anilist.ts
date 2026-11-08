import { appCache } from './cache';

export interface AniListMedia {
  id: number;
  idMal: number | null;
  title: {
    romaji?: string | null;
    english?: string | null;
    native?: string | null;
    userPreferred?: string | null;
  };
  synonyms?: string[];
  format?: string | null;
  status?: string | null;
  episodes?: number | null;
  seasonYear?: number | null;
  season?: string | null;
  averageScore?: number | null;
  coverImage?: {
    large?: string | null;
    medium?: string | null;
  } | null;
  bannerImage?: string | null;
}

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';

const SEARCH_QUERY = `
  query ($search: String, $format: MediaFormat) {
    Page(page: 1, perPage: 10) {
      media(search: $search, type: ANIME, format: $format) {
        id
        idMal
        title {
          romaji
          english
          native
          userPreferred
        }
        synonyms
        format
        status
        episodes
        seasonYear
        season
        averageScore
        coverImage {
          large
          medium
        }
        bannerImage
      }
    }
  }
`;

export async function searchAniList(title: string, format?: string): Promise<AniListMedia[]> {
  if (!title || !title.trim()) return [];
  const cleanTitle = title.trim();
  const cacheKey = `anilist:search:${cleanTitle}:${format || 'any'}`;
  const cached = appCache.get<AniListMedia[]>(cacheKey);
  if (cached) return cached;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const variables: Record<string, any> = { search: cleanTitle };
    if (format && ['TV', 'TV_SHORT', 'MOVIE', 'SPECIAL', 'OVA', 'ONA', 'MUSIC'].includes(format)) {
      variables.format = format;
    }

    const res = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        query: SEARCH_QUERY,
        variables,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`AniList search failed: status ${res.status}`);
      return [];
    }

    const data = await res.json();
    const mediaList: AniListMedia[] = data?.data?.Page?.media || [];
    appCache.set(cacheKey, mediaList, 3600); // cache for 1 hour
    return mediaList;
  } catch (err: any) {
    console.error('Error querying AniList GraphQL:', err.message || err);
    return [];
  }
}

export async function getAniListById(anilistId: number): Promise<AniListMedia | null> {
  const cacheKey = `anilist:media:${anilistId}`;
  const cached = appCache.get<AniListMedia>(cacheKey);
  if (cached) return cached;

  const query = `
    query ($id: Int) {
      Media(id: $id, type: ANIME) {
        id
        idMal
        title {
          romaji
          english
          native
          userPreferred
        }
        synonyms
        format
        status
        episodes
        seasonYear
        season
        averageScore
      }
    }
  `;

  try {
    const res = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ query, variables: { id: anilistId } }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const media = data?.data?.Media || null;
    if (media) appCache.set(cacheKey, media, 86400);
    return media;
  } catch {
    return null;
  }
}
