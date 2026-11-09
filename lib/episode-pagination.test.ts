import test from 'node:test';
import assert from 'node:assert/strict';
import {
  generateEpisodeRanges,
  findRangeForEpisode,
  sliceEpisodesForRange,
  formatEpisodeNumber,
} from './episode-pagination.ts';

test('formatEpisodeNumber correctly pads numbers', () => {
  assert.equal(formatEpisodeNumber(1, 50), '001');
  assert.equal(formatEpisodeNumber(50, 50), '050');
  assert.equal(formatEpisodeNumber(1, 1180), '0001');
  assert.equal(formatEpisodeNumber(1180, 1180), '1180');
});

test('generateEpisodeRanges handles 12 episodes', () => {
  const ranges = generateEpisodeRanges(12);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 1);
  assert.equal(ranges[0].end, 12);
  assert.equal(ranges[0].label, '001–012');
});

test('generateEpisodeRanges handles 50 episodes', () => {
  const ranges = generateEpisodeRanges(50);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 1);
  assert.equal(ranges[0].end, 50);
  assert.equal(ranges[0].label, '001–050');
});

test('generateEpisodeRanges handles 51 episodes', () => {
  const ranges = generateEpisodeRanges(51);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].label, '001–050');
  assert.equal(ranges[0].start, 1);
  assert.equal(ranges[0].end, 50);

  assert.equal(ranges[1].label, '051–051');
  assert.equal(ranges[1].start, 51);
  assert.equal(ranges[1].end, 51);
});

test('generateEpisodeRanges handles 120 episodes', () => {
  const ranges = generateEpisodeRanges(120);
  assert.equal(ranges.length, 3);
  assert.equal(ranges[0].label, '001–050');
  assert.equal(ranges[1].label, '051–100');
  assert.equal(ranges[2].label, '101–120');
  assert.equal(ranges[2].start, 101);
  assert.equal(ranges[2].end, 120);
});

test('generateEpisodeRanges handles 500 episodes', () => {
  const ranges = generateEpisodeRanges(500);
  assert.equal(ranges.length, 10);
  assert.equal(ranges[0].label, '001–050');
  assert.equal(ranges[9].label, '451–500');
  assert.equal(ranges[9].start, 451);
  assert.equal(ranges[9].end, 500);
});

test('generateEpisodeRanges handles 1180 episodes (e.g. One Piece)', () => {
  const ranges = generateEpisodeRanges(1180);
  assert.equal(ranges.length, 24);
  assert.equal(ranges[0].label, '0001–0050');
  assert.equal(ranges[1].label, '0051–0100');
  assert.equal(ranges[23].label, '1151–1180');
  assert.equal(ranges[23].start, 1151);
  assert.equal(ranges[23].end, 1180);
});

test('findRangeForEpisode automatically selects the correct range', () => {
  const ranges = generateEpisodeRanges(1180);

  // Episode 1 -> Range 1
  const r1 = findRangeForEpisode(1, ranges);
  assert.equal(r1?.index, 0);
  assert.equal(r1?.start, 1);

  // Episode 75 -> Range 2 (051-100)
  const r75 = findRangeForEpisode(75, ranges);
  assert.equal(r75?.index, 1);
  assert.equal(r75?.start, 51);
  assert.equal(r75?.end, 100);

  // Episode 245 -> Range 5 (201-250)
  const r245 = findRangeForEpisode(245, ranges);
  assert.equal(r245?.index, 4);
  assert.equal(r245?.start, 201);
  assert.equal(r245?.end, 250);

  // Episode 1180 -> Last range
  const r1180 = findRangeForEpisode(1180, ranges);
  assert.equal(r1180?.index, 23);
  assert.equal(r1180?.start, 1151);
  assert.equal(r1180?.end, 1180);
});

test('sliceEpisodesForRange filters episodes accurately', () => {
  const mockEpisodes = Array.from({ length: 60 }, (_, i) => ({
    number: i + 1,
    title: `Episode ${i + 1}`,
  }));

  const ranges = generateEpisodeRanges(60);
  const range1Episodes = sliceEpisodesForRange(mockEpisodes, ranges[0]);
  assert.equal(range1Episodes.length, 50);
  assert.equal(range1Episodes[0].number, 1);
  assert.equal(range1Episodes[49].number, 50);

  const range2Episodes = sliceEpisodesForRange(mockEpisodes, ranges[1]);
  assert.equal(range2Episodes.length, 10);
  assert.equal(range2Episodes[0].number, 51);
  assert.equal(range2Episodes[9].number, 60);
});
