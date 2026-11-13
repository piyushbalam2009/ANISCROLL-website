import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminRoleToUserRole,
  canActorAssignRole,
  canActorModerateUser,
  getAssignableRolesForActor,
  normalizeUserRole,
  resolveEffectiveUserRole,
  userRoleToAdminRole,
} from './roles';
import {
  BOOTSTRAPPED_OWNER_EMAIL,
  BOOTSTRAPPED_OWNER_UID,
} from './admin/admin-permissions';

test('normalizeUserRole safely maps legacy user/admin roles into 4 canonical tiers', () => {
  assert.equal(normalizeUserRole(undefined), 'member');
  assert.equal(normalizeUserRole('user'), 'member');
  assert.equal(normalizeUserRole('MEMBER'), 'member');
  assert.equal(normalizeUserRole('mod'), 'mod');
  assert.equal(normalizeUserRole('editor'), 'mod');
  assert.equal(normalizeUserRole('analyst'), 'mod');
  assert.equal(normalizeUserRole('admin'), 'admin');
  assert.equal(normalizeUserRole('administrator'), 'admin');
  assert.equal(normalizeUserRole('owner'), 'owner');
  assert.equal(normalizeUserRole('co-owner'), 'owner');
});

test('userRoleToAdminRole & adminRoleToUserRole round-trip elevated roles', () => {
  assert.equal(userRoleToAdminRole('member'), null);
  assert.equal(userRoleToAdminRole('mod'), 'editor');
  assert.equal(userRoleToAdminRole('admin'), 'administrator');
  assert.equal(userRoleToAdminRole('owner'), 'owner');

  assert.equal(adminRoleToUserRole('editor'), 'mod');
  assert.equal(adminRoleToUserRole('administrator'), 'admin');
  assert.equal(adminRoleToUserRole('owner'), 'owner');
});

test('resolveEffectiveUserRole preserves existing Admin/Mod/Owner roles and protects bootstrapped Owner', () => {
  assert.equal(
    resolveEffectiveUserRole({
      uid: BOOTSTRAPPED_OWNER_UID,
      email: BOOTSTRAPPED_OWNER_EMAIL,
      profileRole: 'user',
    }),
    'owner'
  );

  assert.equal(
    resolveEffectiveUserRole({
      uid: 'uid_admin_1',
      profileRole: 'user',
      adminRecord: { role: 'administrator', status: 'active' },
    }),
    'admin'
  );

  assert.equal(
    resolveEffectiveUserRole({
      uid: 'uid_mod_1',
      profileRole: 'mod',
      adminRecord: null,
    }),
    'mod'
  );

  assert.equal(
    resolveEffectiveUserRole({
      uid: 'uid_member_1',
      profileRole: 'user',
      adminRecord: null,
    }),
    'member'
  );
});

test('Role assignment hierarchy blocks self-escalation, Admin->Admin/Owner changes, and Owner demotion', () => {
  // Member cannot assign roles
  assert.equal(
    canActorAssignRole({
      actorRole: 'member',
      actorUid: 'u1',
      targetUid: 'u1',
      targetCurrentRole: 'member',
      targetNextRole: 'admin',
    }).allowed,
    false
  );

  // Mod cannot assign roles
  assert.equal(
    canActorAssignRole({
      actorRole: 'mod',
      actorUid: 'm1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      targetNextRole: 'mod',
    }).allowed,
    false
  );

  // Admin CAN promote Member <-> Mod
  assert.equal(
    canActorAssignRole({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      targetNextRole: 'mod',
    }).allowed,
    true
  );

  // Admin CANNOT promote Member -> Admin or Owner
  assert.equal(
    canActorAssignRole({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      targetNextRole: 'admin',
    }).allowed,
    false
  );
  assert.equal(
    canActorAssignRole({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      targetNextRole: 'owner',
    }).allowed,
    false
  );

  // Admin CANNOT modify another Admin or Owner
  assert.equal(
    canActorAssignRole({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'a2',
      targetCurrentRole: 'admin',
      targetNextRole: 'member',
    }).allowed,
    false
  );

  // Nobody can demote bootstrapped Owner
  assert.equal(
    canActorAssignRole({
      actorRole: 'owner',
      actorUid: 'co_owner',
      targetUid: BOOTSTRAPPED_OWNER_UID,
      targetEmail: BOOTSTRAPPED_OWNER_EMAIL,
      targetCurrentRole: 'owner',
      targetNextRole: 'admin',
    }).allowed,
    false
  );

  // Owner CAN promote/demote Member, Mod, Admin
  assert.equal(
    canActorAssignRole({
      actorRole: 'owner',
      actorUid: BOOTSTRAPPED_OWNER_UID,
      targetUid: 'u2',
      targetCurrentRole: 'member',
      targetNextRole: 'admin',
    }).allowed,
    true
  );

  assert.deepEqual(getAssignableRolesForActor('admin', 'member'), [
    'member',
    'mod',
  ]);
  assert.deepEqual(getAssignableRolesForActor('admin', 'admin'), []);
  assert.deepEqual(getAssignableRolesForActor('owner', 'member'), [
    'member',
    'mod',
    'admin',
    'owner',
  ]);
});

test('Moderation checks protect Owners, Admins from non-Owners, and self-moderation', () => {
  assert.equal(
    canActorModerateUser({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'a2',
      targetCurrentRole: 'admin',
      action: 'ban',
    }).allowed,
    false
  );
  assert.equal(
    canActorModerateUser({
      actorRole: 'owner',
      actorUid: BOOTSTRAPPED_OWNER_UID,
      targetUid: BOOTSTRAPPED_OWNER_UID,
      targetEmail: BOOTSTRAPPED_OWNER_EMAIL,
      targetCurrentRole: 'owner',
      action: 'disable',
    }).allowed,
    false
  );
  assert.equal(
    canActorModerateUser({
      actorRole: 'mod',
      actorUid: 'm1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      action: 'delete',
    }).allowed,
    false
  );
  assert.equal(
    canActorModerateUser({
      actorRole: 'admin',
      actorUid: 'a1',
      targetUid: 'u2',
      targetCurrentRole: 'member',
      action: 'ban',
    }).allowed,
    true
  );
});
