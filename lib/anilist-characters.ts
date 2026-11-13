import { appCache } from './cache';

const ANILIST_GRAPHQL_URL = 'https://graphql.anilist.co';
const ANILIST_CHARACTERS_TIMEOUT_MS = 7000;

export interface AnimeCharacterAvatar {
  id: number;
  name: string;
  nativeName: string | null;
  imageUrl: string;
  animeId: number | null;
  animeTitle: string;
  favourites: number;
  siteUrl: string | null;
}

export interface CharacterGalleryPageResult {
  characters: AnimeCharacterAvatar[];
  page: number;
  perPage: number;
  hasNextPage: boolean;
  total: number | null;
  source: 'anilist_popular' | 'anilist_search' | 'anilist_series';
}

export const POPULAR_ANIME_AVATAR_SERIES: readonly string[] = [
  'All Popular',
  'Naruto',
  'One Piece',
  'Jujutsu Kaisen',
  'Attack on Titan',
  'Demon Slayer',
  'Solo Leveling',
  'Dragon Ball',
  'Bleach',
  'Death Note',
  'My Hero Academia',
  'Hunter x Hunter',
  'Chainsaw Man',
  'Fullmetal Alchemist',
  'Spy x Family',
  'Frieren',
];

export interface RawAniListCharacterNode {
  id: number;
  name?: {
    full?: string | null;
    native?: string | null;
  } | null;
  image?: {
    large?: string | null;
    medium?: string | null;
  } | null;
  favourites?: number | null;
  siteUrl?: string | null;
  media?: {
    nodes?: Array<{
      id: number;
      title?: {
        english?: string | null;
        romaji?: string | null;
      } | null;
    }> | null;
  } | null;
}

export function isValidAniListCharacterImage(url?: string | null): url is string {
  if (!url || typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed.startsWith('https://')) return false;
  // Filter AniList's generic grey silhouette placeholder
  if (trimmed.includes('/default.jpg') || trimmed.includes('/default.png')) {
    return false;
  }
  return true;
}

export function mapAniListCharacterNode(
  node: RawAniListCharacterNode,
  fallbackAnime?: { id?: number | null; title?: string | null }
): AnimeCharacterAvatar | null {
  if (!node || !node.id) return null;
  const imageUrl = node.image?.large || node.image?.medium || '';
  if (!isValidAniListCharacterImage(imageUrl)) return null;

  const fullName = node.name?.full?.trim();
  if (!fullName) return null;

  const firstMedia = node.media?.nodes?.[0];
  const mediaTitle =
    firstMedia?.title?.english?.trim() ||
    firstMedia?.title?.romaji?.trim() ||
    fallbackAnime?.title?.trim() ||
    'Popular Anime';

  return {
    id: Number(node.id),
    name: fullName,
    nativeName: node.name?.native?.trim() || null,
    imageUrl,
    animeId: firstMedia?.id || fallbackAnime?.id || null,
    animeTitle: mediaTitle,
    favourites: Math.max(0, Number(node.favourites) || 0),
    siteUrl: node.siteUrl?.trim() || null,
  };
}

export function mergeAndDeduplicateCharacters(
  lists: AnimeCharacterAvatar[][]
): AnimeCharacterAvatar[] {
  const seen = new Set<number>();
  const merged: AnimeCharacterAvatar[] = [];

  for (const list of lists) {
    for (const item of list) {
      if (!item || !item.id || seen.has(item.id)) continue;
      seen.add(item.id);
      merged.push(item);
    }
  }

  return merged;
}

async function queryAniListCharactersGraphQL<T>(
  query: string,
  variables: Record<string, unknown>
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    ANILIST_CHARACTERS_TIMEOUT_MS
  );

  try {
    const res = await fetch(ANILIST_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ query, variables }),
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) return null;
    const json = await res.json();
    if (!json || typeof json !== 'object' || json.errors) return null;
    return (json.data as T) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const POPULAR_OR_SEARCH_CHARACTERS_QUERY = `
  query ($page: Int, $perPage: Int, $search: String) {
    Page(page: $page, perPage: $perPage) {
      pageInfo {
        total
        currentPage
        lastPage
        hasNextPage
        perPage
      }
      characters(search: $search, sort: [FAVOURITES_DESC]) {
        id
        name {
          full
          native
        }
        image {
          large
          medium
        }
        favourites
        siteUrl
        media(sort: [POPULARITY_DESC], type: ANIME, page: 1, perPage: 2) {
          nodes {
            id
            title {
              english
              romaji
            }
          }
        }
      }
    }
  }
`;

const ANIME_SERIES_CHARACTERS_QUERY = `
  query ($search: String, $charPage: Int, $charPerPage: Int) {
    Page(page: 1, perPage: 4) {
      media(search: $search, type: ANIME, sort: [POPULARITY_DESC]) {
        id
        title {
          english
          romaji
        }
        characters(sort: [FAVOURITES_DESC, ROLE], page: $charPage, perPage: $charPerPage) {
          pageInfo {
            currentPage
            lastPage
            hasNextPage
            total
          }
          nodes {
            id
            name {
              full
              native
            }
            image {
              large
              medium
            }
            favourites
            siteUrl
          }
        }
      }
    }
  }
`;

export async function fetchAniListCharacters(options?: {
  page?: number;
  perPage?: number;
  search?: string;
  series?: string;
  forceRefresh?: boolean;
}): Promise<CharacterGalleryPageResult> {
  const page = Math.max(1, Number(options?.page) || 1);
  const perPage = Math.min(36, Math.max(6, Number(options?.perPage) || 24));
  const rawSearch = (options?.search || '').trim();
  const rawSeries = (options?.series || '').trim();
  const activeSeries =
    rawSeries && rawSeries.toLowerCase() !== 'all popular' ? rawSeries : '';

  const cacheKey = `anilist:characters:v1:p${page}:n${perPage}:q=${rawSearch.toLowerCase()}:s=${activeSeries.toLowerCase()}`;

  return appCache.getOrSet(
    cacheKey,
    async () => {
      // Case 1: Specific Anime Series Selected (with optional text filter)
      if (activeSeries) {
        const seriesData = await queryAniListCharactersGraphQL<{
          Page?: {
            media?: Array<{
              id: number;
              title?: { english?: string | null; romaji?: string | null };
              characters?: {
                pageInfo?: { hasNextPage?: boolean; total?: number | null };
                nodes?: RawAniListCharacterNode[];
              };
            }>;
          };
        }>(ANIME_SERIES_CHARACTERS_QUERY, {
          search: activeSeries,
          charPage: page,
          charPerPage: perPage,
        });

        const mediaList = seriesData?.Page?.media || [];
        let hasNextPage = false;
        let total: number | null = null;
        const seriesCharacters: AnimeCharacterAvatar[] = [];

        for (const m of mediaList) {
          const animeTitle =
            m.title?.english?.trim() || m.title?.romaji?.trim() || activeSeries;
          if (m.characters?.pageInfo?.hasNextPage) {
            hasNextPage = true;
          }
          if (typeof m.characters?.pageInfo?.total === 'number' && total === null) {
            total = m.characters.pageInfo.total;
          }
          for (const node of m.characters?.nodes || []) {
            const mapped = mapAniListCharacterNode(node, {
              id: m.id,
              title: animeTitle,
            });
            if (mapped) seriesCharacters.push(mapped);
          }
        }

        let deduped = mergeAndDeduplicateCharacters([seriesCharacters]);
        if (rawSearch) {
          const needle = rawSearch.toLowerCase();
          deduped = deduped.filter(
            (c) =>
              c.name.toLowerCase().includes(needle) ||
              c.animeTitle.toLowerCase().includes(needle) ||
              (c.nativeName && c.nativeName.toLowerCase().includes(needle))
          );
        }

        return {
          characters: deduped.slice(0, perPage),
          page,
          perPage,
          hasNextPage: hasNextPage && !rawSearch,
          total,
          source: 'anilist_series',
        };
      }

      // Case 2: Free-text search (match both Character names AND Anime titles in parallel)
      if (rawSearch) {
        const [charRes, animeRes] = await Promise.all([
          queryAniListCharactersGraphQL<{
            Page?: {
              pageInfo?: { hasNextPage?: boolean; total?: number | null };
              characters?: RawAniListCharacterNode[];
            };
          }>(POPULAR_OR_SEARCH_CHARACTERS_QUERY, {
            page,
            perPage,
            search: rawSearch,
          }),
          queryAniListCharactersGraphQL<{
            Page?: {
              media?: Array<{
                id: number;
                title?: { english?: string | null; romaji?: string | null };
                characters?: {
                  pageInfo?: { hasNextPage?: boolean };
                  nodes?: RawAniListCharacterNode[];
                };
              }>;
            };
          }>(ANIME_SERIES_CHARACTERS_QUERY, {
            search: rawSearch,
            charPage: page,
            charPerPage: 12,
          }),
        ]);

        const directMatches: AnimeCharacterAvatar[] = [];
        for (const node of charRes?.Page?.characters || []) {
          const mapped = mapAniListCharacterNode(node);
          if (mapped) directMatches.push(mapped);
        }

        const seriesMatches: AnimeCharacterAvatar[] = [];
        let seriesHasMore = false;
        for (const m of animeRes?.Page?.media || []) {
          const animeTitle =
            m.title?.english?.trim() || m.title?.romaji?.trim() || rawSearch;
          if (m.characters?.pageInfo?.hasNextPage) seriesHasMore = true;
          for (const node of m.characters?.nodes || []) {
            const mapped = mapAniListCharacterNode(node, {
              id: m.id,
              title: animeTitle,
            });
            if (mapped) seriesMatches.push(mapped);
          }
        }

        const merged = mergeAndDeduplicateCharacters([
          directMatches,
          seriesMatches,
        ]);

        return {
          characters: merged.slice(0, perPage),
          page,
          perPage,
          hasNextPage:
            Boolean(charRes?.Page?.pageInfo?.hasNextPage) || seriesHasMore,
          total: charRes?.Page?.pageInfo?.total ?? merged.length,
          source: 'anilist_search',
        };
      }

      // Case 3: Default Popular Characters
      const popularRes = await queryAniListCharactersGraphQL<{
        Page?: {
          pageInfo?: { hasNextPage?: boolean; total?: number | null };
          characters?: RawAniListCharacterNode[];
        };
      }>(POPULAR_OR_SEARCH_CHARACTERS_QUERY, {
        page,
        perPage,
      });

      const popularCharacters: AnimeCharacterAvatar[] = [];
      for (const node of popularRes?.Page?.characters || []) {
        const mapped = mapAniListCharacterNode(node);
        if (mapped) popularCharacters.push(mapped);
      }

      return {
        characters: mergeAndDeduplicateCharacters([popularCharacters]),
        page,
        perPage,
        hasNextPage: Boolean(popularRes?.Page?.pageInfo?.hasNextPage),
        total: popularRes?.Page?.pageInfo?.total ?? null,
        source: 'anilist_popular',
      };
    },
    {
      ttlSeconds: 15 * 60,
      staleWhileRevalidateSeconds: 60 * 60,
      forceRefresh: options?.forceRefresh,
      shouldCache: (result) =>
        Boolean(result && Array.isArray(result.characters) && result.characters.length > 0),
    }
  );
}
