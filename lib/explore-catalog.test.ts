import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveHoshikaCatalogSort,
  parseGenresParam,
  normalizeCatalogQuery,
  buildCatalogCacheKey,
  deduplicateAnimeList,
  processCatalogItems,
} from './explore-catalog';
import { HoshikaAnimeItem } from '@/types/anime';

test('resolveHoshikaCatalogSort maps top, score, trending, recent, popular, newest, and title to valid Hoshika upstream sort', () => {
  assert.deepEqual(resolveHoshikaCatalogSort('top'), {
    upstreamSort: 'score',
    requestedSort: 'top',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('score'), {
    upstreamSort: 'score',
    requestedSort: 'score',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('trending'), {
    upstreamSort: 'score',
    requestedSort: 'trending',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('recent'), {
    upstreamSort: 'newest',
    requestedSort: 'recent',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('popular'), {
    upstreamSort: 'popular',
    requestedSort: 'popular',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('newest'), {
    upstreamSort: 'newest',
    requestedSort: 'newest',
  });
  assert.deepEqual(resolveHoshikaCatalogSort('title'), {
    upstreamSort: 'score',
    requestedSort: 'title',
  });
});

test('parseGenresParam deduplicates and normalizes comma-separated and array genres', () => {
  assert.deepEqual(parseGenresParam('Action, Adventure , action, Fantasy'), [
    'Action',
    'Adventure',
    'Fantasy',
  ]);
  assert.deepEqual(parseGenresParam(['Romance,Comedy', 'Romance', 'Isekai']), [
    'Romance',
    'Comedy',
    'Isekai',
  ]);
  assert.deepEqual(parseGenresParam(''), []);
  assert.deepEqual(parseGenresParam(null), []);
});

test('normalizeCatalogQuery validates formats, statuses, years, pages, and multi-genres', () => {
  const normalized = normalizeCatalogQuery({
    q: '  bleach  ',
    genre: ['Action', 'Adventure'],
    format: 'tv',
    status: 'finished',
    year: '2024',
    sort: 'top',
    minScore: '75',
    page: '3',
  });

  assert.equal(normalized.q, 'bleach');
  assert.equal(normalized.genre, 'Action,Adventure');
  assert.equal(normalized.format, 'TV');
  assert.equal(normalized.status, 'FINISHED');
  assert.equal(normalized.year, '2024');
  assert.equal(normalized.upstreamSort, 'score');
  assert.equal(normalized.requestedSort, 'top');
  assert.equal(normalized.minScore, 75);
  assert.equal(normalized.page, 3);
});

test('buildCatalogCacheKey produces distinct keys per filter combination and page', () => {
  const p1 = normalizeCatalogQuery({ genre: 'Action', year: '2024', page: 1 });
  const p2 = normalizeCatalogQuery({ genre: 'Action', year: '2024', page: 2 });
  const pOther = normalizeCatalogQuery({ genre: 'Action,Fantasy', year: '2024', page: 1 });

  assert.notEqual(buildCatalogCacheKey(p1), buildCatalogCacheKey(p2));
  assert.notEqual(buildCatalogCacheKey(p1), buildCatalogCacheKey(pOther));
});

test('deduplicateAnimeList appends new pages without duplicating anime by shortId or id', () => {
  const page1: HoshikaAnimeItem[] = [
    { id: 'uuid-1', shortId: 101, slug: 'a', titleEnglish: 'Anime A' },
    { id: 'uuid-2', shortId: 102, slug: 'b', titleEnglish: 'Anime B' },
  ];
  const page2: HoshikaAnimeItem[] = [
    { id: 'uuid-2', shortId: 102, slug: 'b', titleEnglish: 'Anime B Duplicate' },
    { id: 'uuid-3', shortId: 103, slug: 'c', titleEnglish: 'Anime C' },
  ];

  const merged = deduplicateAnimeList(page1, page2);
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.map((i) => i.shortId),
    [101, 102, 103]
  );
  assert.equal(merged[1].titleEnglish, 'Anime B');
});

test('processCatalogItems filters by minScore and sorts alphabetically when requestedSort is title', () => {
  const items: HoshikaAnimeItem[] = [
    { id: '1', shortId: 1, slug: 'z', titleEnglish: 'Zeta Anime', averageScore: 85 },
    { id: '2', shortId: 2, slug: 'a', titleEnglish: 'Alpha Anime', averageScore: 92 },
    { id: '3', shortId: 3, slug: 'm', titleEnglish: 'Mid Anime', averageScore: 65 },
  ];

  const filtered = processCatalogItems(items, {
    requestedSort: 'title',
    minScore: 80,
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].titleEnglish, 'Alpha Anime');
  assert.equal(filtered[1].titleEnglish, 'Zeta Anime');
});
