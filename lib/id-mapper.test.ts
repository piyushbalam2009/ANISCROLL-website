import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTitle, calculateStringSimilarity, scoreAniListCandidate } from './id-mapper';
import { AniListMedia } from './anilist';

test('normalizeTitle strips punctuation and lowercases', () => {
  assert.equal(
    normalizeTitle('Demon Slayer: Kimetsu no Yaiba - Entertainment District Arc!'),
    'demon slayer kimetsu no yaiba entertainment district arc'
  );
  assert.equal(normalizeTitle(''), '');
  assert.equal(normalizeTitle(null), '');
});

test('calculateStringSimilarity accurately measures title match', () => {
  const simExact = calculateStringSimilarity('Attack on Titan', 'Attack on Titan');
  assert.equal(simExact, 1.0);

  const simSubstring = calculateStringSimilarity(
    'Demon Slayer: Kimetsu no Yaiba',
    'Demon Slayer'
  );
  assert.ok(simSubstring > 0.8, 'Expected strong match for substring');

  const simDifferent = calculateStringSimilarity('Naruto', 'One Piece');
  assert.ok(simDifferent < 0.2, 'Expected low similarity for different anime');
});

test('scoreAniListCandidate ranks matches with year, format and episodes', () => {
  const candidate: AniListMedia = {
    id: 101922,
    idMal: 38000,
    title: {
      english: 'Demon Slayer: Kimetsu no Yaiba',
      romaji: 'Kimetsu no Yaiba',
      native: '鬼滅の刃',
    },
    format: 'TV',
    seasonYear: 2019,
    episodes: 26,
    status: 'FINISHED',
  };

  const hoshikaMeta = {
    titles: ['Demon Slayer: Kimetsu no Yaiba', 'Kimetsu no Yaiba'],
    year: 2019,
    format: 'TV',
    episodes: 26,
  };

  const { score, bestTitle } = scoreAniListCandidate(candidate, hoshikaMeta);
  assert.ok(score >= 0.95, `Expected near-perfect score, got ${score}`);
  assert.equal(bestTitle, 'Demon Slayer: Kimetsu no Yaiba');
});
