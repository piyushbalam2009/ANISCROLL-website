import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidAniListCharacterImage,
  mapAniListCharacterNode,
  mergeAndDeduplicateCharacters,
} from './anilist-characters';

test('isValidAniListCharacterImage rejects missing and default placeholder images', () => {
  assert.equal(isValidAniListCharacterImage(null), false);
  assert.equal(isValidAniListCharacterImage('http://example.com/a.jpg'), false);
  assert.equal(
    isValidAniListCharacterImage(
      'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg'
    ),
    false
  );
  assert.equal(
    isValidAniListCharacterImage(
      'https://s4.anilist.co/file/anilistcdn/character/large/b127691-UmFg6t4r9w3C.png'
    ),
    true
  );
});

test('mapAniListCharacterNode maps character name, portrait, and anime title cleanly', () => {
  const mapped = mapAniListCharacterNode({
    id: 127691,
    name: { full: 'Satoru Gojo', native: '五条悟' },
    image: {
      large: 'https://s4.anilist.co/file/anilistcdn/character/large/b127691.png',
    },
    favourites: 48200,
    media: {
      nodes: [
        {
          id: 113415,
          title: { english: 'JUJUTSU KAISEN', romaji: 'Jujutsu Kaisen' },
        },
      ],
    },
  });

  assert.ok(mapped);
  assert.equal(mapped.id, 127691);
  assert.equal(mapped.name, 'Satoru Gojo');
  assert.equal(mapped.animeTitle, 'JUJUTSU KAISEN');
  assert.equal(mapped.favourites, 48200);
});

test('mergeAndDeduplicateCharacters preserves first occurrence order without duplicates', () => {
  const a = mapAniListCharacterNode({
    id: 1,
    name: { full: 'Naruto Uzumaki' },
    image: { large: 'https://s4.anilist.co/file/anilistcdn/character/large/1.png' },
  })!;
  const b = mapAniListCharacterNode({
    id: 2,
    name: { full: 'Monkey D. Luffy' },
    image: { large: 'https://s4.anilist.co/file/anilistcdn/character/large/2.png' },
  })!;

  const deduped = mergeAndDeduplicateCharacters([[a, b], [a]]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[0].id, 1);
  assert.equal(deduped[1].id, 2);
});
