import { appCache } from './cache';
import { getHoshikaAnime } from './hoshika';
import { searchAniList, AniListMedia } from './anilist';
import { IdMappingResult } from '@/types/anime';

// Helper to normalize strings for comparison (lowercase, remove punctuation, strip accents, normalize spaces)
export function normalizeTitle(str?: string | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Compute bigram-based Sørensen-Dice similarity coefficient (0 to 1)
export function calculateStringSimilarity(str1: string, str2: string): number {
  const s1 = normalizeTitle(str1);
  const s2 = normalizeTitle(str2);

  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;
  if (s1.includes(s2) || s2.includes(s1)) {
    const longer = Math.max(s1.length, s2.length);
    const shorter = Math.min(s1.length, s2.length);
    return 0.8 + 0.2 * (shorter / longer);
  }

  const getBigrams = (str: string): Map<string, number> => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bigram = str.substring(i, i + 2);
      bigrams.set(bigram, (bigrams.get(bigram) || 0) + 1);
    }
    return bigrams;
  };

  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);

  if (b1.size === 0 || b2.size === 0) return 0;

  let intersection = 0;
  for (const [bigram, count1] of b1.entries()) {
    const count2 = b2.get(bigram) || 0;
    intersection += Math.min(count1, count2);
  }

  const total = (s1.length - 1) + (s2.length - 1);
  return (2.0 * intersection) / total;
}

export function scoreAniListCandidate(
  candidate: AniListMedia,
  hoshikaMeta: {
    titles: string[];
    year?: number | null;
    format?: string | null;
    episodes?: number | null;
  }
): { score: number; bestTitle: string } {
  let maxTitleSim = 0;
  let bestTitle = candidate.title.english || candidate.title.romaji || candidate.title.userPreferred || '';

  const candidateTitles = [
    candidate.title.english,
    candidate.title.romaji,
    candidate.title.userPreferred,
    ...(candidate.synonyms || []),
  ].filter(Boolean) as string[];

  for (const hTitle of hoshikaMeta.titles) {
    for (const cTitle of candidateTitles) {
      const sim = calculateStringSimilarity(hTitle, cTitle);
      if (sim > maxTitleSim) {
        maxTitleSim = sim;
        bestTitle = cTitle;
      }
    }
  }

  // Base score comes 60% from best title match
  let score = maxTitleSim * 0.6;

  // Format bonus: 15%
  if (hoshikaMeta.format && candidate.format) {
    const hFormat = hoshikaMeta.format.toUpperCase().replace(/[^A-Z]/g, '');
    const cFormat = candidate.format.toUpperCase().replace(/[^A-Z]/g, '');
    if (hFormat === cFormat) {
      score += 0.15;
    } else if (hFormat.includes('TV') && cFormat.includes('TV')) {
      score += 0.12;
    }
  }

  // Year bonus: 15%
  if (hoshikaMeta.year && candidate.seasonYear) {
    const diff = Math.abs(hoshikaMeta.year - candidate.seasonYear);
    if (diff === 0) {
      score += 0.15;
    } else if (diff === 1) {
      score += 0.08;
    }
  }

  // Episode count bonus: 10%
  if (hoshikaMeta.episodes && candidate.episodes) {
    if (hoshikaMeta.episodes === candidate.episodes) {
      score += 0.1;
    } else if (Math.abs(hoshikaMeta.episodes - candidate.episodes) <= 2) {
      score += 0.05;
    }
  }

  return { score: Math.min(score, 1.0), bestTitle };
}

export async function resolveAnimeIds(hoshikaAnimeId: string | number): Promise<IdMappingResult> {
  const cacheKey = `id-mapping:${hoshikaAnimeId}`;
  const cached = appCache.get<IdMappingResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // STEP 1: Retrieve anime details from Hoshika
  const hoshikaAnime = await getHoshikaAnime(hoshikaAnimeId);
  if (!hoshikaAnime) {
    return {
      hoshikaId: hoshikaAnimeId,
      anilistId: null,
      malId: null,
      mappingStatus: 'failed',
      confidence: 0,
    };
  }

  // Collect potential titles
  const titlesToSearch: string[] = [
    hoshikaAnime.titleEnglish,
    hoshikaAnime.titleRomaji,
    hoshikaAnime.titleLocalized,
    hoshikaAnime.titleJapanese,
  ].filter((t): t is string => Boolean(t && t.trim().length > 0));

  if (titlesToSearch.length === 0) {
    return {
      hoshikaId: hoshikaAnimeId,
      anilistId: null,
      malId: null,
      mappingStatus: 'failed',
      confidence: 0,
    };
  }

  // STEP 4: Query AniList GraphQL API using primary and alternative titles
  const candidatePool = new Map<number, AniListMedia>();

  for (const title of titlesToSearch) {
    const results = await searchAniList(title, hoshikaAnime.format || undefined);
    for (const r of results) {
      if (!candidatePool.has(r.id)) {
        candidatePool.set(r.id, r);
      }
    }
    // If we have strong candidates, break early
    if (candidatePool.size >= 8) break;
  }

  // If still empty, try searching the first word or main title without punctuation
  if (candidatePool.size === 0 && titlesToSearch[0]) {
    const simplified = titlesToSearch[0].split(/[:\-\(]/)[0].trim();
    if (simplified.length > 2 && simplified !== titlesToSearch[0]) {
      const results = await searchAniList(simplified);
      for (const r of results) {
        if (!candidatePool.has(r.id)) {
          candidatePool.set(r.id, r);
        }
      }
    }
  }

  const candidates = Array.from(candidatePool.values());

  // STEP 5: Compare AniList search results against Hoshika metadata
  let bestCandidate: AniListMedia | null = null;
  let highestScore = 0;
  let bestMatchedTitle = '';

  const hoshikaMeta = {
    titles: titlesToSearch,
    year: hoshikaAnime.seasonYear,
    format: hoshikaAnime.format,
    episodes: hoshikaAnime.episodes,
  };

  for (const candidate of candidates) {
    const { score, bestTitle } = scoreAniListCandidate(candidate, hoshikaMeta);
    if (score > highestScore) {
      highestScore = score;
      bestCandidate = candidate;
      bestMatchedTitle = bestTitle;
    }
  }

  // STEP 7: Verify result before accepting
  if (!bestCandidate || highestScore < 0.45) {
    // If confidence is low, return failed
    const failedResult: IdMappingResult = {
      hoshikaId: hoshikaAnimeId,
      anilistId: null,
      malId: null,
      mappingStatus: 'failed',
      confidence: highestScore,
    };
    appCache.set(cacheKey, failedResult, 300); // short cache for failures
    return failedResult;
  }

  const status: 'verified' | 'provisional' = highestScore >= 0.65 ? 'verified' : 'provisional';

  const result: IdMappingResult = {
    hoshikaId: hoshikaAnimeId,
    anilistId: bestCandidate.id,
    malId: bestCandidate.idMal || null,
    mappingStatus: status,
    matchedTitle: bestMatchedTitle,
    confidence: Math.round(highestScore * 100) / 100,
  };

  // STEP 8: Save verified mapping in cache
  appCache.set(cacheKey, result, 86400 * 7); // cache for 7 days
  return result;
}
