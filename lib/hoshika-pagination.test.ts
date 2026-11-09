import test from 'node:test';
import assert from 'node:assert';
import { getAllHoshikaEpisodes, getHoshikaEpisodes } from '../lib/hoshika';

test('Hoshika API pagination retrieves items after 50 with real metadata', async () => {
  // Test Hunter x Hunter shortId: 40276
  const shortId = 40276;

  // 1. First batch: episodes 1 to 50
  const batch1 = await getHoshikaEpisodes(shortId, 'en', undefined, 50);
  assert.strictEqual(batch1.items.length, 50);
  assert.strictEqual(batch1.items[0].number, 1);
  assert.strictEqual(batch1.items[49].number, 50);
  assert.strictEqual(batch1.nextAfter, 50);

  // 2. Second batch: episodes 51 to 100 using after=50
  const batch2 = await getHoshikaEpisodes(shortId, 'en', batch1.items[49].number, 50);
  assert.strictEqual(batch2.items.length, 50);
  assert.strictEqual(batch2.items[0].number, 51);
  assert.strictEqual(batch2.items[49].number, 100);
  assert.strictEqual(batch2.nextAfter, 100);

  // Verify real metadata is preserved on episode 51
  const ep51 = batch2.items[0];
  assert.strictEqual(ep51.number, 51);
  assert.strictEqual(typeof ep51.title, 'string');
  assert.ok(ep51.title && ep51.title.length > 0, 'Episode 51 must have a title');
  assert.ok(ep51.thumbnail && ep51.thumbnail.startsWith('https://'), 'Episode 51 must have thumbnail URL');
  assert.ok(ep51.synopsis && ep51.synopsis.length > 0, 'Episode 51 must have a synopsis');

  // 3. Third batch: episodes 101 to 148 using after=100
  const batch3 = await getHoshikaEpisodes(shortId, 'en', batch2.items[49].number, 50);
  assert.strictEqual(batch3.items.length, 48);
  assert.strictEqual(batch3.items[0].number, 101);
  assert.strictEqual(batch3.items[47].number, 148);
  assert.strictEqual(batch3.nextAfter, null);

  // Verify real metadata is preserved on episode 101
  const ep101 = batch3.items[0];
  assert.strictEqual(ep101.number, 101);
  assert.ok(ep101.title && ep101.title.length > 0, 'Episode 101 must have a title');
  assert.ok(ep101.thumbnail && ep101.thumbnail.startsWith('https://'), 'Episode 101 must have thumbnail URL');
});

test('getAllHoshikaEpisodes aggregates all batches sequentially and caches result', async () => {
  const shortId = 40276;
  const result = await getAllHoshikaEpisodes(shortId, 'en');

  assert.strictEqual(result.items.length, 148);
  assert.strictEqual(result.total, 148);

  // Verify sample items across ranges
  assert.strictEqual(result.items[0].number, 1);
  assert.strictEqual(result.items[50].number, 51);
  assert.strictEqual(result.items[100].number, 101);
  assert.strictEqual(result.items[147].number, 148);

  // Verify metadata integrity
  assert.ok(result.items[50].title, 'Episode 51 must have real title');
  assert.ok(result.items[50].thumbnail, 'Episode 51 must have real thumbnail');
  assert.ok(result.items[100].title, 'Episode 101 must have real title');
  assert.ok(result.items[100].thumbnail, 'Episode 101 must have real thumbnail');
});
