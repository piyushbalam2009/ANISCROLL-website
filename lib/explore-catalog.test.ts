import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_PER_PAGE,
  UPSTREAM_CATALOG_PAGE_SIZE,
  resolveHoshikaCatalogSort,
  parseGenresParam,
  normalizeCatalogQuery,
  buildCatalogCacheKey,
  sanitizePageNumber,
  computeUpstreamWindowForPage,
  buildPaginatedResponse,
  generatePaginationRange,
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

test('sanitizePageNumber handles invalid, negative, zero, and valid page inputs safely', () => {
  assert.equal(sanitizePageNumber(undefined), 1);
  assert.equal(sanitizePageNumber(null), 1);
  assert.equal(sanitizePageNumber(''), 1);
  assert.equal(sanitizePageNumber('abc'), 1);
  assert.equal(sanitizePageNumber(0), 1);
  assert.equal(sanitizePageNumber(-5), 1);
  assert.equal(sanitizePageNumber('3'), 3);
  assert.equal(sanitizePageNumber(12), 12);
});

test('normalizeCatalogQuery validates formats, statuses, years, seasons, pages, and multi-genres with perPage=30', () => {
  const normalized = normalizeCatalogQuery({
    q: '  bleach  ',
    genre: ['Action', 'Adventure'],
    format: 'tv',
    status: 'finished',
    year: '2024',
    season: 'fall',
    sort: 'top',
    minScore: '75',
    page: '3',
  });

  assert.equal(normalized.q, 'bleach');
  assert.equal(normalized.genre, 'Action,Adventure');
  assert.equal(normalized.format, 'TV');
  assert.equal(normalized.status, 'FINISHED');
  assert.equal(normalized.year, '2024');
  assert.equal(normalized.season, 'FALL');
  assert.equal(normalized.upstreamSort, 'score');
  assert.equal(normalized.requestedSort, 'top');
  assert.equal(normalized.minScore, 75);
  assert.equal(normalized.page, 3);
  assert.equal(normalized.perPage, DEFAULT_PER_PAGE);
});

test('buildCatalogCacheKey produces distinct keys per filter combination, season, and page', () => {
  const p1 = normalizeCatalogQuery({
    genre: 'Action',
    year: '2024',
    season: 'WINTER',
    page: 1,
  });
  const p2 = normalizeCatalogQuery({
    genre: 'Action',
    year: '2024',
    season: 'WINTER',
    page: 2,
  });
  const pSpring = normalizeCatalogQuery({
    genre: 'Action',
    year: '2024',
    season: 'SPRING',
    page: 1,
  });

  assert.notEqual(buildCatalogCacheKey(p1), buildCatalogCacheKey(p2));
  assert.notEqual(buildCatalogCacheKey(p1), buildCatalogCacheKey(pSpring));
});

test('computeUpstreamWindowForPage maps 30-item logical pages across 24-item upstream pages with zero overlap or gaps', () => {
  // Simulate 200 sequential upstream items split into 24-item upstream pages
  const totalSimulated = 200;
  const allUpstreamItems = Array.from({ length: totalSimulated }, (_, idx) => ({
    id: `id-${idx + 1}`,
    shortId: idx + 1,
    slug: `anime-${idx + 1}`,
    titleEnglish: `Anime #${idx + 1}`,
  }));

  const getUpstreamPage = (upPage: number) => {
    const start = (upPage - 1) * UPSTREAM_CATALOG_PAGE_SIZE;
    return allUpstreamItems.slice(start, start + UPSTREAM_CATALOG_PAGE_SIZE);
  };

  const seenIds = new Set<number>();

  for (let logicalPage = 1; logicalPage <= 5; logicalPage++) {
    const win = computeUpstreamWindowForPage(
      logicalPage,
      DEFAULT_PER_PAGE,
      UPSTREAM_CATALOG_PAGE_SIZE
    );
    const combined = win.upstreamPages.flatMap((up) => getUpstreamPage(up));
    const pageItems = combined.slice(
      win.localOffset,
      win.localOffset + win.perPage
    );

    assert.equal(
      pageItems.length,
      30,
      `Logical page ${logicalPage} should have 30 items`
    );

    const expectedFirstId = (logicalPage - 1) * 30 + 1;
    const expectedLastId = logicalPage * 30;
    assert.equal(pageItems[0].shortId, expectedFirstId);
    assert.equal(pageItems[pageItems.length - 1].shortId, expectedLastId);

    for (const item of pageItems) {
      assert.equal(
        seenIds.has(item.shortId),
        false,
        `Duplicate shortId ${item.shortId} on page ${logicalPage}`
      );
      seenIds.add(item.shortId);
    }
  }

  assert.equal(seenIds.size, 150);
});

test('buildPaginatedResponse calculates totalPages, hasNextPage, and hasPreviousPage accurately', () => {
  const dummyItems: HoshikaAnimeItem[] = Array.from({ length: 30 }, (_, i) => ({
    id: `${i + 1}`,
    shortId: i + 1,
    slug: `s-${i + 1}`,
  }));

  const page1 = buildPaginatedResponse({
    results: dummyItems,
    currentPage: 1,
    perPage: 30,
    totalItems: 1000,
  });

  assert.equal(page1.currentPage, 1);
  assert.equal(page1.perPage, 30);
  assert.equal(page1.totalPages, 34);
  assert.equal(page1.hasNextPage, true);
  assert.equal(page1.hasPreviousPage, false);
  assert.equal(page1.results.length, 30);

  const finalPage = buildPaginatedResponse({
    results: dummyItems.slice(0, 10),
    currentPage: 34,
    perPage: 30,
    totalItems: 1000,
  });

  assert.equal(finalPage.currentPage, 34);
  assert.equal(finalPage.totalPages, 34);
  assert.equal(finalPage.hasNextPage, false);
  assert.equal(finalPage.hasPreviousPage, true);
});

test('generatePaginationRange produces numbered sequence with ellipsis for large page counts', () => {
  assert.deepEqual(generatePaginationRange(1, 5, true), [1, 2, 3, 4, 5]);
  assert.deepEqual(generatePaginationRange(1, 20, true), [
    1,
    2,
    3,
    4,
    5,
    'ellipsis',
    20,
  ]);
  assert.deepEqual(generatePaginationRange(10, 20, true), [
    1,
    'ellipsis',
    9,
    10,
    11,
    'ellipsis',
    20,
  ]);
  assert.deepEqual(generatePaginationRange(19, 20, true), [
    1,
    'ellipsis',
    16,
    17,
    18,
    19,
    20,
  ]);
});

test('deduplicateAnimeList appends new pages without duplicating anime by shortId or id', () => {
  const page1: HoshikaAnimeItem[] = [
    { id: 'uuid-1', shortId: 101, slug: 'a', titleEnglish: 'Anime A' },
    { id: 'uuid-2', shortId: 102, slug: 'b', titleEnglish: 'Anime B' },
  ];
  const page2: HoshikaAnimeItem[] = [
    {
      id: 'uuid-2',
      shortId: 102,
      slug: 'b',
      titleEnglish: 'Anime B Duplicate',
    },
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
    {
      id: '1',
      shortId: 1,
      slug: 'z',
      titleEnglish: 'Zeta Anime',
      averageScore: 85,
    },
    {
      id: '2',
      shortId: 2,
      slug: 'a',
      titleEnglish: 'Alpha Anime',
      averageScore: 92,
    },
    {
      id: '3',
      shortId: 3,
      slug: 'm',
      titleEnglish: 'Mid Anime',
      averageScore: 65,
    },
  ];

  const filtered = processCatalogItems(items, {
    requestedSort: 'title',
    minScore: 80,
  });

  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].titleEnglish, 'Alpha Anime');
  assert.equal(filtered[1].titleEnglish, 'Zeta Anime');
});
