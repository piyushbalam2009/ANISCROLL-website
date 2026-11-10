# AniScroll — Cinematic Anime Streaming Platform & Admin Control Plane

AniScroll is a high-contrast monochrome anime streaming web application built with **Next.js 15 (App Router)**, **React 19**, **TypeScript**, **Tailwind CSS 4**, **HLS.js**, **Firebase Authentication**, **Cloud Firestore**, and **Firebase Cloud Storage**.

---

## 1. Architecture & Core Providers

- **Primary Metadata & Episode Pagination**: Hoshika API (`https://hoshika.app/api/v1`) with cursor-based `after` pagination (`50` episodes per batch).
- **Primary Transparent Logo & Backdrop Artwork Provider**: **Fanart.tv v3** (`hdtvlogo`, `clearlogo`, `showbackground`, `hdclearart`).
  - **Strict No-AniZip Logo Policy**: AniZip (`api.ani.zip`) is used strictly to map `AniList ID -> TVDB ID / TMDB ID` and is **never** used for logos under any circumstances.
- **Logo Selection Priority Hierarchy**:
  1. **Admin-Selected Logo** (`selectionMode === 'manual'` — locked and never overridden by automatic selection)
  2. **Fanart.tv English `hdtvlogo`**
  3. **Fanart.tv English `clearlogo`**
  4. **Fanart.tv Japanese `hdtvlogo`**
  5. **Fanart.tv Japanese `clearlogo`**
  6. **Other available Fanart.tv logos**
  7. **Hoshika Title Typography Fallback**
- **Streaming & Skip Providers**: AniScroll HLS Streaming API + AniSkip Intro/Outro skip markers.

---

## 2. Environment Variables (`.env.example`)

Copy `.env.example` to `.env.local` and configure the following variables:

```env
# Fanart.tv v3 API Key (Optional: live Fanart.tv API calls; curated registry + fallback used if unset)
FANART_API_KEY="YOUR_FANART_API_KEY"

# Hoshika OAuth Credentials (Optional)
HOSHIKA_CLIENT_ID=""
HOSHIKA_CLIENT_SECRET=""

# Firebase Client SDK Configuration
NEXT_PUBLIC_FIREBASE_API_KEY=""
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=""
NEXT_PUBLIC_FIREBASE_PROJECT_ID=""
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=""
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=""
NEXT_PUBLIC_FIREBASE_APP_ID=""
NEXT_PUBLIC_FIREBASE_DATABASE_ID=""

# Admin & Server-Side Firebase Admin SDK Configuration
ADMIN_OWNER_UID=""
ADMIN_OWNER_EMAIL="balampiyush2009@gmail.com"
FIREBASE_CLIENT_EMAIL=""
FIREBASE_PRIVATE_KEY=""
```

> **Security Note**: `FIREBASE_PRIVATE_KEY`, `FIREBASE_CLIENT_EMAIL`, and `ADMIN_OWNER_UID` are strictly server-only variables and are never exposed to the browser.

---

## 3. Firebase Console Setup Instructions

1. **Firebase Authentication**:
   - Open the [Firebase Console](https://console.firebase.google.com/) -> **Authentication** -> **Sign-in method**.
   - Enable **Email/Password** and **Google** authentication providers.
2. **Cloud Firestore**:
   - Open **Firestore Database** and ensure your database instance is provisioned.
   - Collections used by AniScroll:
     - `/users/{uid}/profile/details`, `/watchlist/{animeId}`, `/continueWatching/{animeId}`, `/watchHistory/{historyId}`, `/preferences/settings`
     - `/admins/{adminUid}` (Role-Based Access Control registry)
     - `/animeArtwork/{hoshikaId}` (Per-anime transparent logo overrides, Fanart.tv candidates, custom uploads, and display settings)
     - `/artworkAuditLogs/{logId}` (Artwork change history with 1-click rollback)
     - `/adminActivityLogs/{logId}` (System-wide administrator audit logs)
     - `/announcements/{announcementId}` (Global feature/maintenance/notice/alert banners)
     - `/animeManagement/homepage` (Featured hero anime, seasonal pins, and editorial collections)
     - `/siteConfig/global` (Platform settings, logo language priority, cache TTL, and security policies)
     - `/streamingLogs/{logId}` (Upstream streaming and metadata API latency logs)
3. **Firebase Cloud Storage**:
   - Open **Storage** in the Firebase Console and enable Cloud Storage.
   - Custom uploaded anime logos are stored under:
     `anime-logos/{hoshikaId}/{timestamp}_{filename}`

---

## 4. Configuring the First Owner Account & Admin Roles

1. **Automatic Owner Bootstrap**:
   - By default, signing in with `balampiyush2009@gmail.com` (or the email/UID configured in `ADMIN_OWNER_EMAIL` / `ADMIN_OWNER_UID`) automatically bootstraps the primary **Owner** record in `/admins/{uid}` with full root permissions.
2. **Role Hierarchy**:
   - **Owner (`owner`)**: Full control over all dashboard modules, security settings, and administrator management (`/admin/admins`).
   - **Administrator (`administrator`)**: Full operational control over artwork, custom logo uploads/deletions, users, anime curation, announcements, streaming monitor, and settings.
   - **Content Editor (`editor`)**: Can manage anime artwork, upload custom transparent logos, curate featured anime, and manage announcements.
   - **Viewer / Analyst (`analyst`)**: Read-only access to dashboard metrics, missing logo reports, streaming health, and audit logs.
3. **Adding Additional Administrators**:
   - Sign in as the **Owner** and navigate to `/admin/admins`.
   - Enter the user's Firebase UID, Email, Display Name, and select their Role (`administrator`, `editor`, or `analyst`).
   - Toggle granular permissions (`manageArtwork`, `uploadLogos`, `deleteLogos`, `manageUsers`, etc.) at any time.

---

## 5. Deploying Firestore & Storage Security Rules

Using the Firebase CLI:

```bash
# Deploy Firestore security rules
firebase deploy --only firestore:rules

# Deploy Firebase Storage security rules
firebase deploy --only storage
```

Or run the built-in security rules test suite locally:

```bash
npx eslint firestore.rules
npx tsx --test firestore.rules.test.ts
```

---

## 6. Using the Anime Artwork Management System (`/admin/artwork`)

1. **Browse & Search (`/admin/artwork`)**:
   - Search any anime series from the Hoshika catalogue or filter existing overrides by `Manual Locks`, `Custom Uploads`, or `Auto Priority`.
2. **Per-Anime Artwork Studio (`/admin/artwork/[id]`)**:
   - **Live Hero Preview**: Toggle between **Details Hero** and **Homepage Hero**, switch between **Desktop** and **Mobile** viewports, and adjust **Max Width**, **Logo Scale**, **Horizontal Offset**, and **Vertical Offset**.
   - **Fanart.tv Logo Selector**: View all available `hdtvlogo` and `clearlogo` images with language (`EN`, `JA`) and community likes. Click **Select Logo** to lock it as the primary logo (`selectionMode: 'manual'`), or click the eye icon to hide unsuitable logos.
   - **Upload Custom Transparent Logo**: Drag and drop a `.png`, `.webp`, or `.svg` (automatically sanitized and rasterized to transparent PNG). Validated for file size (`<= 5MB`) and minimum width (`>= 240px`), uploaded to Firebase Storage, and applied immediately.
   - **Instant Rollback**: Every artwork change is logged in `/artworkAuditLogs` and can be reverted with one click via **Restore Previous Logo**.
3. **Missing Logo Detector (`/admin/missing-logos`)**:
   - Click **Run Deep Artwork Scan** to batch-check the anime catalogue for missing logos, Japanese-only logos, or typography fallbacks, and jump directly into the Artwork Studio to fix them.
