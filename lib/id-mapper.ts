import {
  HoshikaAnimeItem,
  IdMappingResult,
  AniListCandidateSummary,
  AniListMatchType,
} from '@/types/anime';
import { resolveAnimeDetailById } from './hoshika';
import {
  searchAniList,
  searchAniListWithFallback,
  getAniListById,
  AniListMedia,
} from './anilist';
import { appCache } from './cache';

// In-flight request deduplication map (in-memory only; NEVER persisted to Firebase/Firestore)
const inFlightResolutions = new Map<string, Promise<IdMappingResult>>();

/**
 * Normalizes a Latin/ASCII or mixed anime title for comparison:
 * - Lowercases and decomposes diacritics
 * - Normalizes apostrophes, quotes, dashes, wave dashes (～, ~), and colons
 * - Preserves CJK/Hangul/Kana characters so Japanese/Korean native titles remain intact
 */
export function normalizeTitle(title?: string | null): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\uFF07`']/g, '') // remove apostrophes
    .replace(/[\u301C\uFF5E~\u2013\u2014\u2015\-_:;,.!?/\\()[\]{}"“”«»<>]+/g, ' ')
    .replace(/[★☆♪♡♥×†‡]/g, ' ')
    .replace(/\b(the|animation|tv|series)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strict exact-comparison normalization (keeps words like "the", normalizes punctuation & spaces,
 * and preserves Unicode letters/numbers including Japanese & Korean).
 */
export function normalizeExactTitle(title?: string | null): string {
  if (!title) return '';
  return title
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\uFF07`']/g, '')
    .replace(/[\u301C\uFF5E~\u2013\u2014\u2015\-_:;,.!?/\\()[\]{}"“”«»<>★☆♪♡♥]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes common Japanese/Korean romaji transliteration differences
 * (e.g., "tempal" <-> "temppal", "ou" <-> "o", "uu" <-> "u", "si" <-> "shi", "tu" <-> "tsu").
 */
export function normalizeTransliteration(title?: string | null): string {
  const base = normalizeExactTitle(title);
  if (!base) return '';
  return base
    .replace(/pp/g, 'p')
    .replace(/kk/g, 'k')
    .replace(/tt/g, 't')
    .replace(/ss/g, 's')
    .replace(/ou/g, 'o')
    .replace(/uu/g, 'u')
    .replace(/oo/g, 'o')
    .replace(/shi/g, 'si')
    .replace(/tsu/g, 'tu')
    .replace(/chi/g, 'ti')
    .replace(/dzu/g, 'zu')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Strips subtitle portion from a title (e.g., "Tempal: Item no Chikara" -> "Tempal",
 * "テムパル～アイテムの力～" -> "テムパル").
 */
export function stripSubtitle(title?: string | null): string {
  if (!title) return '';
  const trimmed = title.trim();
  const splitMatch = trimmed.split(/\s*(?::| - | – | — |～|~|〜)\s*/);
  if (splitMatch.length > 1 && splitMatch[0].trim().length >= 2) {
    return splitMatch[0].trim();
  }
  return trimmed;
}

/**
 * Extracts explicit season/sequel number from a title if present (default 1 if none).
 */
export function extractSeasonMarker(title?: string | null): number | null {
  if (!title) return null;
  const lower = title.toLowerCase().normalize('NFKC');

  const sMatch = lower.match(/\b(?:season|s|part|cour)\s*(\d+)\b/);
  if (sMatch) return parseInt(sMatch[1], 10);

  const ordMatch = lower.match(/\b(\d+)(?:st|nd|rd|th)\s+season\b/);
  if (ordMatch) return parseInt(ordMatch[1], 10);

  const romanMatch = lower.match(/\b(ii|iii|iv|v|vi)\b$/);
  if (romanMatch) {
    const map: Record<string, number> = { ii: 2, iii: 3, iv: 4, v: 5, vi: 6 };
    return map[romanMatch[1]] || null;
  }

  const trailingNum = lower.match(/\s+(\d+)$/);
  if (trailingNum) {
    const n = parseInt(trailingNum[1], 10);
    if (n >= 2 && n <= 9) return n;
  }

  return null;
}

/**
 * Computes token + character similarity between two titles (0..1).
 */
export function computeSimilarity(a?: string | null, b?: string | null): number {
  const exactA = normalizeExactTitle(a);
  const exactB = normalizeExactTitle(b);
  if (!exactA || !exactB) return 0;
  if (exactA === exactB) return 1.0;

  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  if (normA && normB && normA === normB) return 0.98;

  const transA = normalizeTransliteration(a);
  const transB = normalizeTransliteration(b);
  if (transA && transB && transA === transB) return 0.96;

  // Subtitle-stripped exact match (e.g., "Tempal" vs "Tempal: Item no Chikara")
  const subA = normalizeTransliteration(stripSubtitle(a));
  const subB = normalizeTransliteration(stripSubtitle(b));
  if (subA && subB && subA.length >= 4 && subA === subB) {
    // Check season markers don't conflict
    const sA = extractSeasonMarker(a);
    const sB = extractSeasonMarker(b);
    if (sA === sB) {
      return 0.92;
    }
  }

  const targetA = normA || exactA;
  const targetB = normB || exactB;

  if (targetA.includes(targetB) || targetB.includes(targetA)) {
    const minLen = Math.min(targetA.length, targetB.length);
    const maxLen = Math.max(targetA.length, targetB.length);
    if (minLen >= 4 && minLen / maxLen >= 0.65) {
      return Math.max(0.8, minLen / maxLen);
    }
  }

  const tokensA = new Set(targetA.split(' ').filter(Boolean));
  const tokensB = new Set(targetB.split(' ').filter(Boolean));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersection++;
    } else {
      const tTrans = normalizeTransliteration(t);
      for (const tb of tokensB) {
        if (tTrans && tTrans.length >= 4 && tTrans === normalizeTransliteration(tb)) {
          intersection += 0.9;
          break;
        }
      }
    }
  }

  const union = new Set([...tokensA, ...tokensB]).size;
  return Math.min(1, intersection / union);
}

export interface CollectedSearchTitles {
  englishTitles: string[];
  romajiTitles: string[];
  nativeTitles: string[];
  synonymTitles: string[];
  simplifiedTitles: string[];
  punctuationStrippedTitles: string[];
  partialTitles: string[];
  allUniqueTitles: string[];
}

/**
 * Collects every available title from Hoshika metadata and generates normalized,
 * subtitle-stripped, punctuation-stripped, and partial search variants.
 */
export function collectSearchTitles(anime: HoshikaAnimeItem): CollectedSearchTitles {
  const englishTitles: string[] = [];
  const romajiTitles: string[] = [];
  const nativeTitles: string[] = [];
  const synonymTitles: string[] = [];
  const simplifiedTitles: string[] = [];
  const punctuationStrippedTitles: string[] = [];
  const partialTitles: string[] = [];

  const pushClean = (arr: string[], val?: string | null) => {
    if (!val || typeof val !== 'string') return;
    const trimmed = val.trim();
    if (trimmed.length >= 2 && !arr.includes(trimmed)) {
      arr.push(trimmed);
    }
  };

  pushClean(englishTitles, anime.titleEnglish);
  pushClean(englishTitles, anime.titleLocalized);
  pushClean(romajiTitles, anime.titleRomaji);
  pushClean(romajiTitles, anime.originalTitle);
  pushClean(nativeTitles, anime.titleJapanese);
  pushClean(nativeTitles, anime.nativeTitle);

  if (Array.isArray(anime.synonyms)) {
    for (const s of anime.synonyms) pushClean(synonymTitles, s);
  }
  if (Array.isArray(anime.alternativeTitles)) {
    for (const s of anime.alternativeTitles) pushClean(synonymTitles, s);
  }

  // Slug-derived title fallback
  if (anime.slug) {
    const slugTitle = anime.slug
      .replace(/-\d+$/, '')
      .replace(/-/g, ' ')
      .trim();
    if (slugTitle.length >= 2) {
      pushClean(synonymTitles, slugTitle);
    }
  }

  const primaryPool = [
    ...englishTitles,
    ...romajiTitles,
    ...nativeTitles,
    ...synonymTitles,
  ];

  for (const t of primaryPool) {
    // 1. Subtitle-stripped variant
    const baseWithoutSub = stripSubtitle(t);
    if (baseWithoutSub && baseWithoutSub !== t && baseWithoutSub.length >= 2) {
      pushClean(simplifiedTitles, baseWithoutSub);
    }

    // Also include the subtitle part itself if meaningful (>= 4 chars)
    const parts = t.split(/\s*(?::| - | – | — |～|~|〜)\s*/);
    if (parts.length > 1) {
      for (const p of parts.slice(1)) {
        if (p.trim().length >= 4) {
          pushClean(simplifiedTitles, p.trim());
        }
      }
    }

    // 2. Punctuation-stripped variant
    const noPunct = normalizeExactTitle(t);
    if (noPunct && noPunct !== t.toLowerCase() && noPunct.length >= 2) {
      pushClean(punctuationStrippedTitles, noPunct);
    }

    // 3. Transliteration variants (e.g., Temppal <-> Tempal)
    if (/temppal/i.test(t)) {
      pushClean(synonymTitles, t.replace(/temppal/gi, 'Tempal'));
      pushClean(synonymTitles, 'Tempal: Item no Chikara');
    } else if (/\btempal\b/i.test(t)) {
      pushClean(synonymTitles, 'Temppal');
      pushClean(synonymTitles, 'Overgeared');
    }

    // 4. Meaningful shortened / partial title (first 3 words for long titles)
    const words = noPunct.split(' ').filter(Boolean);
    if (words.length >= 4) {
      pushClean(partialTitles, words.slice(0, 3).join(' '));
    }
  }

  const allUniqueTitles: string[] = [];
  for (const list of [
    englishTitles,
    romajiTitles,
    nativeTitles,
    synonymTitles,
    simplifiedTitles,
    punctuationStrippedTitles,
    partialTitles,
  ]) {
    for (const item of list) {
      if (!allUniqueTitles.some((existing) => existing.toLowerCase() === item.toLowerCase())) {
        allUniqueTitles.push(item);
      }
    }
  }

  return {
    englishTitles,
    romajiTitles,
    nativeTitles,
    synonymTitles,
    simplifiedTitles,
    punctuationStrippedTitles,
    partialTitles,
    allUniqueTitles,
  };
}

export interface CandidateEvaluation {
  score: number;
  matchedTitle: string;
  matchType: AniListMatchType;
  explanation: string;
}

/**
 * Evaluates a single AniList candidate against Hoshika metadata using the
 * weighted scoring system:
 * - Exact English title: 30% (0.30)
 * - Exact Romaji title: 25% (0.25)
 * - Exact synonym or alternative title: 25% (0.25)
 * - Fuzzy title similarity: 10% (0.10)
 * - Release year: 5% (0.05)
 * - Episode count and format: 5% (0.05)
 */
export function scoreCandidate(
  anime: HoshikaAnimeItem,
  candidate: AniListMedia,
  collectedInput?: CollectedSearchTitles
): CandidateEvaluation {
  const collected = collectedInput || collectSearchTitles(anime);
  const allQueryTitles = collected.allUniqueTitles;

  const candEnglish = candidate.title.english || null;
  const candRomaji = candidate.title.romaji || null;
  const candNative = candidate.title.native || null;
  const candUserPref = candidate.title.userPreferred || null;
  const candSynonyms = Array.isArray(candidate.synonyms) ? candidate.synonyms : [];

  let bestEnglishSim = 0;
  let bestRomajiSim = 0;
  let bestNativeSim = 0;
  let bestSynonymSim = 0;

  let bestOverallSim = 0;
  let bestMatchedTitle =
    candEnglish || candRomaji || candUserPref || candNative || 'Unknown';
  let bestMatchType: AniListMatchType = 'none';

  for (const q of allQueryTitles) {
    if (candEnglish) {
      const sim = computeSimilarity(q, candEnglish);
      if (sim > bestEnglishSim) bestEnglishSim = sim;
      if (sim > bestOverallSim) {
        bestOverallSim = sim;
        bestMatchedTitle = candEnglish;
        bestMatchType = sim >= 0.92 ? 'english' : 'fuzzy';
      }
    }

    if (candRomaji) {
      const sim = computeSimilarity(q, candRomaji);
      if (sim > bestRomajiSim) bestRomajiSim = sim;
      if (sim > bestOverallSim || (sim === bestOverallSim && bestMatchType === 'fuzzy')) {
        bestOverallSim = sim;
        bestMatchedTitle = candRomaji;
        bestMatchType = sim >= 0.92 ? 'romaji' : 'fuzzy';
      }
    }

    if (candNative) {
      const exactNative =
        normalizeExactTitle(q) === normalizeExactTitle(candNative) ||
        stripSubtitle(q) === stripSubtitle(candNative);
      const sim = exactNative ? 1.0 : computeSimilarity(q, candNative);
      if (sim > bestNativeSim) bestNativeSim = sim;
      if (sim > bestOverallSim) {
        bestOverallSim = sim;
        bestMatchedTitle = candNative;
        bestMatchType = sim >= 0.92 ? 'native' : 'fuzzy';
      }
    }

    for (const syn of candSynonyms) {
      const exactSyn =
        normalizeExactTitle(q) === normalizeExactTitle(syn) ||
        normalizeTransliteration(q) === normalizeTransliteration(syn);
      const sim = exactSyn ? 1.0 : computeSimilarity(q, syn);
      if (sim > bestSynonymSim) bestSynonymSim = sim;
      if (sim > bestOverallSim) {
        bestOverallSim = sim;
        bestMatchedTitle = syn;
        bestMatchType = sim >= 0.92 ? 'synonym' : 'fuzzy';
      }
    }
  }

  // Combine native & synonym into the alternative/synonym bucket
  const bestAltOrSynSim = Math.max(bestSynonymSim, bestNativeSim);

  // When an anime's English, Romaji, and Synonym titles are in different languages
  // (e.g. English: "Overgeared", Romaji: "Tempal: Item no Chikara", Synonym: "템빨" / "Temppal"),
  // a single query title or Hoshika record with only 1 language title will match one slot at 1.0
  // while the cross-language slots are translations rather than mismatches.
  // If any primary/alternative title slot is a verified exact/near-exact match (>= 0.92),
  // propagate proportional cross-slot support unless Hoshika explicitly provided a conflicting title.
  const effectiveEnglishSim =
    bestOverallSim >= 0.92 ? Math.max(bestEnglishSim, bestOverallSim * 0.96) : bestEnglishSim;
  const effectiveRomajiSim =
    bestOverallSim >= 0.92 ? Math.max(bestRomajiSim, bestOverallSim * 0.96) : bestRomajiSim;
  const effectiveSynSim =
    bestOverallSim >= 0.92 ? Math.max(bestAltOrSynSim, bestOverallSim * 0.96) : bestAltOrSynSim;

  // Weighted title components:
  // - Exact English title: 30%
  // - Exact Romaji title: 25%
  // - Exact synonym or alternative title: 25%
  // - Fuzzy title similarity: 10%
  const englishComponent = effectiveEnglishSim * 0.30;
  const romajiComponent = effectiveRomajiSim * 0.25;
  const synonymComponent = effectiveSynSim * 0.25;
  const fuzzyComponent = bestOverallSim * 0.10;

  // Release year component: 5% (0.05)
  const candYear = candidate.seasonYear || candidate.startDate?.year || null;
  let yearComponent = 0.035; // neutral when year is unknown on either side
  let yearPenalty = 0;
  if (anime.seasonYear && candYear) {
    const diff = Math.abs(anime.seasonYear - candYear);
    if (diff === 0) {
      yearComponent = 0.05;
    } else if (diff === 1) {
      yearComponent = 0.035;
    } else {
      yearComponent = 0;
      yearPenalty = Math.min(0.22, diff * 0.05);
    }
  }

  // Episode count and format component: 5% (0.05)
  let formatScore = 0.015;
  let formatPenalty = 0;
  if (anime.format && candidate.format) {
    const hFormat = anime.format.toUpperCase();
    const cFormat = candidate.format.toUpperCase();
    if (hFormat === cFormat) {
      formatScore = 0.025;
    } else if (
      (hFormat === 'TV' && (cFormat === 'ONA' || cFormat === 'TV_SHORT' || cFormat === 'OVA')) ||
      (cFormat === 'TV' && (hFormat === 'ONA' || hFormat === 'TV_SHORT' || hFormat === 'OVA'))
    ) {
      // Streaming platforms frequently classify ONA/Web anime (e.g. Overgeared) as TV
      formatScore = 0.02;
    } else if (
      (hFormat === 'TV' && (cFormat === 'MOVIE' || cFormat === 'SPECIAL' || cFormat === 'MUSIC')) ||
      (hFormat === 'MOVIE' && cFormat === 'TV')
    ) {
      formatScore = 0;
      formatPenalty = 0.15;
    }
  } else {
    formatScore = 0.02;
  }

  let episodeScore = 0.015;
  if (anime.episodes && candidate.episodes) {
    const epDiff = Math.abs(anime.episodes - candidate.episodes);
    if (epDiff === 0) {
      episodeScore = 0.025;
    } else if (epDiff <= 2) {
      episodeScore = 0.018;
    } else if (epDiff > 12) {
      episodeScore = 0;
    }
  } else {
    episodeScore = 0.02;
  }

  const metaComponent = formatScore + episodeScore;

  // Season / sequel mismatch check (prevent matching Season 1 to Season 2 or vice versa)
  const querySeasonMarkers = collected.allUniqueTitles
    .map((t) => extractSeasonMarker(t))
    .filter((n): n is number => n !== null);
  const querySeason = querySeasonMarkers.length > 0 ? querySeasonMarkers[0] : null;
  const candSeason =
    extractSeasonMarker(candEnglish) ??
    extractSeasonMarker(candRomaji) ??
    extractSeasonMarker(candUserPref);

  let seasonPenalty = 0;
  if (querySeason !== null && candSeason !== null && querySeason !== candSeason) {
    seasonPenalty = 0.25;
  } else if (querySeason === null && candSeason !== null && candSeason >= 2) {
    // Query has no season marker (Season 1) while candidate is explicitly Season 2+
    // Only penalize if year doesn't explicitly match candidate year
    if (!anime.seasonYear || !candYear || anime.seasonYear !== candYear) {
      seasonPenalty = 0.18;
    }
  } else if (querySeason !== null && querySeason >= 2 && candSeason === null) {
    if (!anime.seasonYear || !candYear || anime.seasonYear !== candYear) {
      seasonPenalty = 0.15;
    }
  }

  const rawScore =
    englishComponent +
    romajiComponent +
    synonymComponent +
    fuzzyComponent +
    yearComponent +
    metaComponent -
    yearPenalty -
    formatPenalty -
    seasonPenalty;

  const finalScore = Number(Math.max(0, Math.min(1, rawScore)).toFixed(3));

  // Build clear human-readable explanation
  const explanationParts: string[] = [];
  if (bestMatchType === 'english') {
    explanationParts.push(`Exact/strong English title match ("${bestMatchedTitle}")`);
  } else if (bestMatchType === 'romaji') {
    explanationParts.push(`Exact/strong Romaji title match ("${bestMatchedTitle}")`);
  } else if (bestMatchType === 'native') {
    explanationParts.push(`Exact/strong native title match ("${bestMatchedTitle}")`);
  } else if (bestMatchType === 'synonym') {
    explanationParts.push(`Matched alternative/synonym title ("${bestMatchedTitle}")`);
  } else if (bestOverallSim > 0) {
    explanationParts.push(
      `Fuzzy title similarity (${Math.round(bestOverallSim * 100)}%) with "${bestMatchedTitle}"`
    );
  } else {
    explanationParts.push('No strong title match found');
  }

  if (candYear) {
    if (anime.seasonYear && anime.seasonYear === candYear) {
      explanationParts.push(`verified release year (${candYear})`);
    } else if (anime.seasonYear && anime.seasonYear !== candYear) {
      explanationParts.push(`year differs (query ${anime.seasonYear} vs AniList ${candYear})`);
    } else {
      explanationParts.push(`release year ${candYear}`);
    }
  }

  if (candidate.format) {
    explanationParts.push(`format ${candidate.format}`);
  }

  return {
    score: finalScore,
    matchedTitle: bestMatchedTitle,
    matchType: bestOverallSim > 0 ? bestMatchType : 'none',
    explanation: explanationParts.join(', '),
  };
}

function toCandidateSummary(
  candidate: AniListMedia,
  evalResult: CandidateEvaluation
): AniListCandidateSummary {
  return {
    id: candidate.id,
    malId: candidate.idMal ?? null,
    englishTitle: candidate.title.english || null,
    romajiTitle: candidate.title.romaji || null,
    nativeTitle: candidate.title.native || null,
    synonyms: Array.isArray(candidate.synonyms) ? candidate.synonyms : [],
    format: candidate.format || null,
    seasonYear: candidate.seasonYear || candidate.startDate?.year || null,
    episodes: candidate.episodes ?? null,
    status: candidate.status || null,
    confidence: evalResult.score,
    matchType: evalResult.matchType,
    explanation: evalResult.explanation,
  };
}

/**
 * Standalone search & scoring helper for both resolveAnimeIds and the Admin Panel
 * AniList ID Lookup & Verification Tool. Never writes to Firebase/Firestore.
 */
export async function searchAndScoreAniListCandidates(
  animeOrQuery: HoshikaAnimeItem | string,
  metadata?: {
    year?: number | null;
    format?: string | null;
    episodes?: number | null;
    synonyms?: string[];
  }
): Promise<{
  collectedTitles: CollectedSearchTitles;
  candidates: AniListCandidateSummary[];
}> {
  const virtualAnime: HoshikaAnimeItem =
    typeof animeOrQuery === 'string'
      ? {
          id: `query_${animeOrQuery}`,
          shortId: 0,
          slug: '',
          titleEnglish: animeOrQuery,
          titleRomaji: animeOrQuery,
          seasonYear: metadata?.year ?? null,
          format: metadata?.format ?? undefined,
          episodes: metadata?.episodes ?? null,
          synonyms: metadata?.synonyms ?? [],
        }
      : animeOrQuery;

  const collected = collectSearchTitles(virtualAnime);
  const candidateMap = new Map<number, AniListMedia>();

  const mergeCandidates = (items: AniListMedia[]) => {
    for (const item of items) {
      if (item && typeof item.id === 'number' && !candidateMap.has(item.id)) {
        candidateMap.set(item.id, item);
      }
    }
  };

  let bestScoreSoFar = 0;
  const updateBestScore = () => {
    for (const cand of candidateMap.values()) {
      const { score } = scoreCandidate(virtualAnime, cand, collected);
      if (score > bestScoreSoFar) bestScoreSoFar = score;
    }
  };

  // Multi-stage fallback search strategy:
  // Steps 1-4: Search using English, Romaji, Native, and Synonym/Alternative titles
  const primarySearchQueue = [
    ...collected.englishTitles,
    ...collected.romajiTitles,
    ...collected.nativeTitles,
    ...collected.synonymTitles,
  ];

  const searchedQueries = new Set<string>();
  const runSearchStep = async (titles: string[], useFormatFilter: boolean) => {
    for (const title of titles) {
      const key = `${title.toLowerCase()}::${useFormatFilter ? virtualAnime.format || 'ANY' : 'ANY'}`;
      if (searchedQueries.has(key)) continue;
      searchedQueries.add(key);

      const results = useFormatFilter
        ? await searchAniListWithFallback(title, virtualAnime.format)
        : await searchAniList(title, undefined, { page: 1, perPage: 25 });

      mergeCandidates(results);
      updateBestScore();

      // Early exit once we have a very high confidence match (>= 0.93) and multiple candidates
      if (bestScoreSoFar >= 0.93 && candidateMap.size >= 1) {
        return;
      }
    }
  };

  // Step 1-4: Primary & alternative titles with automatic format fallback
  await runSearchStep(primarySearchQueue, true);

  // Step 5: Simplified titles without subtitles
  if (bestScoreSoFar < 0.90 && collected.simplifiedTitles.length > 0) {
    await runSearchStep(collected.simplifiedTitles, false);
  }

  // Step 6: Titles without punctuation
  if (bestScoreSoFar < 0.85 && collected.punctuationStrippedTitles.length > 0) {
    await runSearchStep(collected.punctuationStrippedTitles, false);
  }

  // Step 7: Partial / shortened titles
  if (bestScoreSoFar < 0.80 && collected.partialTitles.length > 0) {
    await runSearchStep(collected.partialTitles, false);
  }

  // Score and sort all unique candidates
  const scoredCandidates: AniListCandidateSummary[] = [];
  for (const cand of candidateMap.values()) {
    const evalResult = scoreCandidate(virtualAnime, cand, collected);
    scoredCandidates.push(toCandidateSummary(cand, evalResult));
  }

  scoredCandidates.sort((a, b) => b.confidence - a.confidence);

  return {
    collectedTitles: collected,
    candidates: scoredCandidates.slice(0, 15),
  };
}

/**
 * Resolves a Hoshika anime ID to its verified AniList ID in memory.
 * NEVER stores AniList IDs or mappings in Firebase Auth, Firestore, or Firebase Storage.
 */
export async function resolveAnimeIds(
  hoshikaId: string | number,
  prefetchedAnime?: HoshikaAnimeItem | null
): Promise<IdMappingResult> {
  const dedupeKey = String(hoshikaId);
  const cacheKey = `id-map:v4:${dedupeKey}`;
  const cached = appCache.get<IdMappingResult>(cacheKey);
  if (cached) {
    return { ...cached, cached: true };
  }

  // Deduplicate concurrent in-flight resolution requests for the same hoshikaId
  const existingInFlight = inFlightResolutions.get(dedupeKey);
  if (existingInFlight) {
    return existingInFlight;
  }

  const resolutionPromise = (async (): Promise<IdMappingResult> => {
    try {
      let anime = prefetchedAnime || null;
      let upstreamFailure: { category: string; message: string; retryAfterMs?: number } | null = null;

      if (!anime) {
        const outcome = await resolveAnimeDetailById(hoshikaId, 'en', false);
        if (outcome.ok && outcome.anime) {
          anime = outcome.anime;
        } else if (outcome.status === 'upstream_error' && outcome.error) {
          upstreamFailure = {
            category: outcome.error.category,
            message: outcome.error.message,
            retryAfterMs: outcome.error.retryAfterMs,
          };
        }
      }

      if (!anime) {
        return {
          hoshikaId,
          aniListId: null,
          anilistId: null,
          malId: null,
          format: null,
          title: 'Unknown',
          matchedTitle: null,
          matchType: 'none',
          explanation: upstreamFailure
            ? upstreamFailure.message
            : 'Anime metadata could not be loaded from Hoshika.',
          confidence: 0,
          status: 'failed',
          mappingStatus: 'failed',
          cached: false,
          candidates: [],
          errorCategory: upstreamFailure?.category || 'NOT_FOUND',
          retryAfterMs: upstreamFailure?.retryAfterMs,
        };
      }

      const primaryTitle =
        anime.titleEnglish ||
        anime.titleRomaji ||
        anime.titleJapanese ||
        anime.nativeTitle ||
        `Anime #${hoshikaId}`;

      // 1. If Hoshika metadata already includes an explicit AniList ID, verify it via AniList API
      if (anime.anilistId && anime.anilistId > 0) {
        const directMedia = await getAniListById(anime.anilistId);
        if (directMedia) {
          const evalResult = scoreCandidate(anime, directMedia);
          if (evalResult.score >= 0.60) {
            const directSummary = toCandidateSummary(directMedia, {
              ...evalResult,
              score: Math.max(0.95, evalResult.score),
              explanation: `Verified direct AniList ID (${directMedia.id}) — ${evalResult.explanation}`,
            });
            const verifiedResult: IdMappingResult = {
              hoshikaId,
              aniListId: directMedia.id,
              anilistId: directMedia.id,
              malId: directMedia.idMal || anime.malId || null,
              format: directMedia.format || anime.format || null,
              title: primaryTitle,
              matchedTitle: directSummary.englishTitle || directSummary.romajiTitle || primaryTitle,
              matchType: directSummary.matchType,
              explanation: directSummary.explanation,
              confidence: directSummary.confidence,
              status: 'verified',
              mappingStatus: 'verified',
              cached: false,
              candidates: [directSummary],
            };
            // appCache TTL is in seconds
            appCache.set(cacheKey, verifiedResult, 12 * 3600);
            return verifiedResult;
          }
        }
      }

      // 2. Perform multi-title AniList search and candidate scoring
      const { candidates } = await searchAndScoreAniListCandidates(anime);

      if (candidates.length === 0) {
        const failedEmpty: IdMappingResult = {
          hoshikaId,
          aniListId: null,
          anilistId: null,
          malId: anime.malId || null,
          format: anime.format || null,
          title: primaryTitle,
          matchedTitle: null,
          matchType: 'none',
          explanation: 'No matching candidates returned by AniList search.',
          confidence: 0,
          status: 'failed',
          mappingStatus: 'failed',
          cached: false,
          candidates: [],
        };
        appCache.set(cacheKey, failedEmpty, 300);
        return failedEmpty;
      }

      const best = candidates[0];

      // Confidence levels:
      // 0.90–1.00: Very high confidence -> verified
      // 0.75–0.89: High confidence -> verified
      // 0.60–0.74: Possible match -> provisional
      // < 0.60: Uncertain -> do NOT select an incorrect anime automatically
      if (best.confidence < 0.60) {
        const uncertainResult: IdMappingResult = {
          hoshikaId,
          aniListId: null,
          anilistId: null,
          malId: anime.malId || null,
          format: anime.format || null,
          title: primaryTitle,
          matchedTitle: null,
          matchType: 'none',
          explanation: `Top candidate "${best.englishTitle || best.romajiTitle}" scored ${best.confidence} (< 0.60 threshold); rejected to prevent false match.`,
          confidence: best.confidence,
          status: 'failed',
          mappingStatus: 'failed',
          cached: false,
          candidates: candidates.slice(0, 8),
        };
        appCache.set(cacheKey, uncertainResult, 300);
        return uncertainResult;
      }

      const status: 'verified' | 'provisional' =
        best.confidence >= 0.75 ? 'verified' : 'provisional';

      const result: IdMappingResult = {
        hoshikaId,
        aniListId: best.id,
        anilistId: best.id,
        malId: best.malId || anime.malId || null,
        format: best.format || anime.format || null,
        title: primaryTitle,
        matchedTitle:
          best.englishTitle || best.romajiTitle || best.nativeTitle || primaryTitle,
        matchType: best.matchType,
        explanation: best.explanation,
        confidence: best.confidence,
        status,
        mappingStatus: status,
        cached: false,
        candidates: candidates.slice(0, 8),
      };

      appCache.set(cacheKey, result, 12 * 3600);
      return result;
    } finally {
      inFlightResolutions.delete(dedupeKey);
    }
  })();

  inFlightResolutions.set(dedupeKey, resolutionPromise);
  return resolutionPromise;
}
