# AniScroll Security Specification (User & Admin RBAC)

## 1. Data Invariants
1. **Default-Deny Catch-All**: Every unreferenced path in `/databases/{database}/documents` is denied (`allow read, write: if false;`).
2. **User Isolation & Admin User Moderation**: Personal subcollections (`/users/{uid}/*`) are strictly restricted to `isOwner(uid)` (`request.auth.uid == uid`). Only the Owner or an active Admin with `manageUsers == true` can read user profiles or update `accountStatus` (`active`, `disabled`, `banned`).
3. **Bootstrapped Owner & Admin Role Hierarchy**:
   - The creator (`balampiyush2009@gmail.com` with `email_verified == true`) is the Bootstrapped Owner.
   - Only the Owner (`isOwnerRole()`) can create, update, or delete records in `/admins/{adminUid}`.
   - Normal users cannot promote themselves or write to `/admins/{adminUid}`.
   - An Administrator cannot modify or delete an Owner record (`existing().role != 'owner'`).
4. **Anime Artwork Integrity (`/animeArtwork/{animeId}`)**:
   - Publicly readable so the streaming frontend and artwork resolver can render selected transparent logos without authentication.
   - Writable ONLY by the Owner or an active administrator with `permissions.manageArtwork == true`.
   - Enforces strict schema validation (`isValidAnimeArtworkDoc`), string length bounds, and server timestamps (`request.time`).
5. **Immutable Audit & Activity Logs (`/artworkAuditLogs/{logId}`, `/adminActivityLogs/{logId}`)**:
   - Creatable only by active administrators (`adminUid == request.auth.uid` and `createdAt == request.time`).
   - Completely immutable (`allow update, delete: if false;`).
6. **Announcements, Anime Management, Site Config & Streaming Monitor**:
   - `/announcements`: Publicly readable when `status == 'published'`, writable only by admins with `manageAnnouncements == true`.
   - `/animeManagement`: Publicly readable, writable only by admins with `manageAnime == true`.
   - `/siteConfig`: Readable by active admins (or `docId == 'main'` for public defaults), writable only by Owner or admins with `manageSettings == true`.
   - `/streamingLogs`: Readable by active admins, creatable with strict schema validation, immutable.

## 2. The "Dirty Dozen" Payloads
1. **Unauthenticated Profile Write** -> `PERMISSION_DENIED`
2. **Cross-User PII Read by Non-Admin** -> `PERMISSION_DENIED`
3. **Identity Spoofing in Watchlist Payload** -> `PERMISSION_DENIED`
4. **Shadow Field / Privilege Escalation (`isAdmin: true` in UserProfile)** -> `PERMISSION_DENIED`
5. **Path ID Poisoning (`invalid$id!@#`)** -> `PERMISSION_DENIED`
6. **Denial-of-Wallet String Overflow (500-char title)** -> `PERMISSION_DENIED`
7. **Forged Client Timestamp (`createdAt != request.time`)** -> `PERMISSION_DENIED`
8. **Immortal Field Mutation (`createdAt` modified on update)** -> `PERMISSION_DENIED`
9. **Invalid Enum Value in Preferences (`defaultAudio: 'french'`)** -> `PERMISSION_DENIED`
10. **Zero/Negative Duration in Continue Watching** -> `PERMISSION_DENIED`
11. **Non-Admin Attempting to Write `/animeArtwork/{animeId}`** -> `PERMISSION_DENIED`
12. **Non-Owner Attempting to Self-Assign `/admins/{uid}` Role** -> `PERMISSION_DENIED`
