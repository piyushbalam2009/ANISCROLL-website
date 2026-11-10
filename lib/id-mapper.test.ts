import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  normalizeExactTitle,
  normalizeTransliteration,
  stripSubtitle,
  computeSimilarity,
  collectSearchTitles,
  scoreCandidate,
  resolveAnimeIds,
} from './id-mapper.ts';
import { HoshikaAnimeItem } from '../types/anime.ts';
import { AniListMedia } from './anilist.ts';

test('normalizeTitle & normalizeTransliteration handle case, punctuation, subtitles, and transliteration', () => {
  assert.equal(normalizeTitle('Attack on Titan!'), 'attack on titan');
  assert.equal(
    normalizeTitle('Kaguya-sama: Love is War - Ultra Romantic'),
    'kaguya sama love is war ultra romantic'
  );
  assert.equal(
    normalizeTransliteration('Temppal'),
    normalizeTransliteration('Tempal')
  );
  assert.equal(
    stripSubtitle('Tempal: Item no Chikara'),
    'Tempal'
  );
  assert.equal(
    stripSubtitle('テムパル～アイテムの力～'),
    'テムパル'
  );
  assert.equal(normalizeExactTitle('템빨'), '템빨');
});

test('collectSearchTitles gathers English, Romaji, Japanese, native, synonyms, and simplified variants', () => {
  const overgearedHoshika: HoshikaAnimeItem = {
    id: 'overgeared_1',
    shortId: 50001,
    slug: 'overgeared',
    titleEnglish: 'Overgeared',
    titleRomaji: 'Tempal: Item no Chikara',
    titleJapanese: 'テムパル～アイテムの力～',
    nativeTitle: '템빨',
    synonyms: ['Temppal'],
    format: 'TV',
    seasonYear: 2026,
  };

  const collected = collectSearchTitles(overgearedHoshika);
  assert.ok(collected.englishTitles.includes('Overgeared'));
  assert.ok(collected.romajiTitles.includes('Tempal: Item no Chikara'));
  assert.ok(collected.nativeTitles.includes('テムパル～アイテムの力～'));
  assert.ok(collected.nativeTitles.includes('템빨'));
  assert.ok(collected.synonymTitles.includes('Temppal'));
  assert.ok(collected.simplifiedTitles.includes('Tempal'));
});

test('scoreCandidate resolves Overgeared (AniList ID 212888) across English, Romaji, Korean, and Japanese titles', () => {
  const overgearedCandidate212888: AniListMedia = {
    id: 212888,
    title: {
      romaji: 'Tempal: Item no Chikara',
      english: 'Overgeared',
      native: 'テムパル～アイテムの力～',
      userPreferred: 'Tempal: Item no Chikara',
    },
    synonyms: ['템빨', 'Temppal', 'Tempal - Item no Chikara'],
    format: 'ONA',
    seasonYear: 2026,
    episodes: 12,
    status: 'RELEASING',
  };

  // Case 1: Hoshika only has English title "Overgeared" and format "TV"
  const byEnglishOnly: HoshikaAnimeItem = {
    id: 'og_en',
    shortId: 50001,
    slug: 'overgeared',
    titleEnglish: 'Overgeared',
    format: 'TV',
    seasonYear: 2026,
  };
  const evalEn = scoreCandidate(byEnglishOnly, overgearedCandidate212888);
  assert.ok(
    evalEn.score >= 0.9,
    `Expected Overgeared English match >= 0.90, got ${evalEn.score}`
  );
  assert.equal(evalEn.matchType, 'english');

  // Case 2: Hoshika only has Romaji title "Tempal: Item no Chikara"
  const byRomajiOnly: HoshikaAnimeItem = {
    id: 'og_romaji',
    shortId: 50002,
    slug: 'tempal-item-no-chikara',
    titleRomaji: 'Tempal: Item no Chikara',
    format: 'ONA',
    seasonYear: 2026,
  };
  const evalRomaji = scoreCandidate(byRomajiOnly, overgearedCandidate212888);
  assert.ok(
    evalRomaji.score >= 0.9,
    `Expected Overgeared Romaji match >= 0.90, got ${evalRomaji.score}`
  );
  assert.equal(evalRomaji.matchType, 'romaji');

  // Case 3: Hoshika has alternative transliteration "Temppal" or Korean "템빨"
  const bySynonym: HoshikaAnimeItem = {
    id: 'og_syn',
    shortId: 50003,
    slug: 'temppal',
    titleRomaji: 'Temppal',
    synonyms: ['템빨'],
    format: 'TV',
    seasonYear: 2026,
  };
  const evalSyn = scoreCandidate(bySynonym, overgearedCandidate212888);
  assert.ok(
    evalSyn.score >= 0.9,
    `Expected Overgeared Synonym match >= 0.90, got ${evalSyn.score}`
  );
  assert.equal(evalSyn.matchType, 'synonym');

  // Case 4: Hoshika has Japanese title "テムパル～アイテムの力～"
  const byJapanese: HoshikaAnimeItem = {
    id: 'og_ja',
    shortId: 50004,
    slug: 'tempal',
    titleJapanese: 'テムパル～アイテムの力～',
    format: 'ONA',
    seasonYear: 2026,
  };
  const evalJa = scoreCandidate(byJapanese, overgearedCandidate212888);
  assert.ok(
    evalJa.score >= 0.9,
    `Expected Overgeared Native match >= 0.90, got ${evalJa.score}`
  );
  assert.equal(evalJa.matchType, 'native');
});

test('scoreCandidate disambiguates anime with similar names and different release years / seasons', () => {
  const hxh2011Query: HoshikaAnimeItem = {
    id: 'hxh_2011',
    shortId: 11240,
    slug: 'hunter-x-hunter-2011',
    titleEnglish: 'Hunter x Hunter (2011)',
    titleRomaji: 'Hunter x Hunter',
    format: 'TV',
    seasonYear: 2011,
    episodes: 148,
  };

  const hxh1999Candidate: AniListMedia = {
    id: 136,
    title: {
      english: 'Hunter x Hunter',
      romaji: 'Hunter x Hunter',
    },
    format: 'TV',
    seasonYear: 1999,
    episodes: 62,
  };

  const hxh2011Candidate: AniListMedia = {
    id: 11061,
    title: {
      english: 'Hunter x Hunter (2011)',
      romaji: 'Hunter x Hunter (2011)',
    },
    synonyms: ['HxH (2011)'],
    format: 'TV',
    seasonYear: 2011,
    episodes: 148,
  };

  const score1999 = scoreCandidate(hxh2011Query, hxh1999Candidate);
  const score2011 = scoreCandidate(hxh2011Query, hxh2011Candidate);
  assert.ok(
    score2011.score > score1999.score,
    `2011 candidate (${score2011.score}) must score higher than 1999 candidate (${score1999.score})`
  );
  assert.ok(score2011.score >= 0.95);
});

test('resolveAnimeIds rejects uncertain matches (< 0.60) instead of selecting an unrelated anime', async () => {
  const unrelatedCandidate: AniListMedia = {
    id: 16498,
    title: {
      english: 'Attack on Titan',
      romaji: 'Shingeki no Kyojin',
    },
    format: 'TV',
    seasonYear: 2013,
    episodes: 25,
  };

  const completelyDifferentQuery: HoshikaAnimeItem = {
    id: 'nonexistent_xyz',
    shortId: 888881,
    slug: 'quantum-nebula-chronicles-9999',
    titleEnglish: 'Quantum Nebula Chronicles ZZZ',
    format: 'MOVIE',
    seasonYear: 2025,
  };

  const evaluation = scoreCandidate(completelyDifferentQuery, unrelatedCandidate);
  assert.ok(
    evaluation.score < 0.6,
    `Unrelated anime must score below 0.60 threshold, got ${evaluation.score}`
  );
});

test('resolveAnimeIds dynamically resolves Overgeared to AniList ID 212888 without Firebase storage', async () => {
  const overgearedItem: HoshikaAnimeItem = {
    id: 'overgeared_live',
    shortId: 777212,
    slug: 'overgeared',
    titleEnglish: 'Overgeared',
    titleRomaji: 'Tempal: Item no Chikara',
    synonyms: ['Temppal', '템빨', 'テムパル～アイテムの力～'],
    format: 'TV',
    seasonYear: 2026,
  };

  const resolved = await resolveAnimeIds(777212, overgearedItem);
  assert.equal(resolved.aniListId, 212888, 'Must resolve Overgeared to AniList ID 212888');
  assert.equal(resolved.anilistId, 212888, 'Backward-compatible anilistId must equal 212888');
  assert.equal(resolved.status, 'verified');
  assert.ok(
    (resolved.confidence || 0) >= 0.9,
    `Expected confidence >= 0.90, got ${resolved.confidence}`
  );
});

test('computeSimilarity handles exact, normalized, and partial matches', () => {
  assert.equal(computeSimilarity('Solo Leveling', 'Solo Leveling'), 1.0);
  assert.ok(computeSimilarity('Solo Leveling!', 'solo-leveling') >= 0.98);
  assert.equal(computeSimilarity('One Piece', 'Naruto'), 0);
});
