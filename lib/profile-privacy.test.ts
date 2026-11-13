import test from 'node:test';
import assert from 'node:assert/strict';
import {
  filterPublicProfileForViewer,
  generateDefaultUsername,
  toPublicUserProfile,
  validateUsername,
} from './profile-privacy';

test('validateUsername enforces handle length, characters, and reserved words', () => {
  assert.equal(validateUsername('gojo_satoru').valid, true);
  assert.equal(validateUsername('@Gojo_Satoru').normalized, 'gojo_satoru');
  assert.equal(validateUsername('ab').valid, false);
  assert.equal(validateUsername('a'.repeat(25)).valid, false);
  assert.equal(validateUsername('bad__name').valid, false);
  assert.equal(validateUsername('_leading').valid, false);
  assert.equal(validateUsername('admin').valid, false);
  assert.equal(validateUsername('settings').valid, false);
});

test('generateDefaultUsername produces valid handles from email or display name', () => {
  const handle = generateDefaultUsername({
    displayName: 'Satoru Gojo!!',
    email: 'gojo@jjk.jp',
    uid: 'AbC123XYZ',
  });
  assert.equal(validateUsername(handle).valid, true);
});

test('toPublicUserProfile strips email PII and projects canonical role', () => {
  const pub = toPublicUserProfile(
    {
      uid: 'u_123',
      username: 'frieren_mage',
      displayName: 'Frieren',
      email: 'secret-email@example.com',
      photoURL: 'https://s4.anilist.co/file/anilistcdn/character/large/b176754.png',
      bio: 'Collecting spells.',
      role: 'user',
      status: 'active',
      stats: { watchedEpisodes: 28, watchlistCount: 4, completedCount: 1, updatedAt: 1000 },
      favouriteAnime: [{ hoshikaId: 154587, title: 'Frieren: Beyond Journey’s End' }],
      recentActivity: [
        { hoshikaId: 154587, title: 'Frieren', episodeNumber: 28, timestamp: 1000 },
      ],
    },
    'member'
  );

  assert.equal((pub as any).email, undefined);
  assert.equal(pub.role, 'member');
  assert.equal(pub.username, 'frieren_mage');
});

test('filterPublicProfileForViewer enforces private, members-only, and section privacy toggles', () => {
  const base = toPublicUserProfile(
    {
      uid: 'u_priv',
      username: 'shadow_monarch',
      displayName: 'Sung Jinwoo',
      email: 'jinwoo@example.com',
      privacy: {
        profileVisibility: 'private',
        showWatchHistory: false,
        showWatchlist: false,
        showActivity: false,
      },
      favouriteAnime: [{ hoshikaId: 151807, title: 'Solo Leveling' }],
      recentActivity: [
        { hoshikaId: 151807, title: 'Solo Leveling', episodeNumber: 12, timestamp: 2000 },
      ],
      stats: { watchedEpisodes: 12, watchlistCount: 2, completedCount: 1, updatedAt: 2000 },
    },
    'member'
  );

  // Anonymous or other member cannot view private profile
  assert.equal(filterPublicProfileForViewer(base, null).accessible, false);
  assert.equal(
    filterPublicProfileForViewer(base, { uid: 'other_user', role: 'member' })
      .accessible,
    false
  );

  // Owner always sees full profile
  const ownerView = filterPublicProfileForViewer(base, {
    uid: 'u_priv',
    role: 'member',
  });
  assert.equal(ownerView.accessible, true);
  assert.equal(ownerView.profile?.favouriteAnime.length, 1);

  // Members-only profile blocks anonymous, allows signed-in member with hidden sections stripped
  const membersOnly = {
    ...base,
    privacy: {
      profileVisibility: 'members' as const,
      showWatchHistory: false,
      showWatchlist: true,
      showActivity: false,
    },
  };

  assert.equal(
    filterPublicProfileForViewer(membersOnly, null).accessible,
    false
  );
  const signedInView = filterPublicProfileForViewer(membersOnly, {
    uid: 'viewer_1',
    role: 'member',
  });
  assert.equal(signedInView.accessible, true);
  assert.equal(signedInView.profile?.favouriteAnime.length, 1);
  assert.equal(signedInView.profile?.recentActivity.length, 0);
  assert.equal(signedInView.profile?.stats?.watchedEpisodes, 0);
});
