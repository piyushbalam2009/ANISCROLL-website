# AniScroll

A premium anime discovery and streaming web application built with **Next.js 15**, **React 19**, and **TypeScript**. AniScroll combines Hoshika anime metadata, AniList-based ID resolution, Fanart.tv artwork, AniScroll streaming sources, and AniSkip intro/outro timestamps in a monochrome interface.

> **Project status:** Active development. Availability of anime, artwork, stream sources, subtitles, and skip markers depends on the upstream providers and the specific title/episode.

## Features

- **Anime discovery:** Browse trending, popular, seasonal, and recently added anime.
- **Hoshika metadata:** Anime details, titles, synopsis, genres, formats, studios, episode metadata, and schedule data.
- **Real-time search:** Debounced Hoshika search with suggestions and keyboard navigation.
- **Cinematic artwork:** Fanart.tv backgrounds and transparent logos, with Hoshika artwork fallbacks. Artwork IDs are resolved through AniList and AniZip mappings.
- **Anime details:** Synopsis, metadata, artwork, related page content, and episode listings.
- **Episode pagination:** Reusable episode list and range selector for long-running series.
- **Streaming:** AniScroll stream lookup with subbed/dubbed options where available.
- **Video playback:** HLS.js-based playback and custom player controls.
- **Intro/outro skipping:** AniSkip v2 timestamps when a matching MAL ID and skip data are available.
- **Subtitle tools:** Subtitle track handling, parsing, overlay rendering, and configurable subtitle appearance.
- **Personal library:** Watchlist, continue watching, watch history, playback progress, and user preferences stored locally in the browser.
- **Responsive monochrome UI:** Black-and-white styling, collapsible sidebar, floating search, and cinematic hero sections.

## Tech stack

| Area | Technology |
|---|---|
| Framework | Next.js 15 App Router |
| Language | TypeScript 5 |
| UI | React 19 |
| Styling | Tailwind CSS 4 |
| Icons | Lucide React |
| Animation | Motion |
| Video | HLS.js |
| External metadata | Hoshika API |
| ID matching | AniList GraphQL |
| Artwork mapping | AniZip + Fanart.tv |
| Streaming | AniScroll API |
| Intro/outro markers | AniSkip API v2 |
| Package manager lockfile | Bun |

## Data and API flow

```text
Hoshika
  ├── Anime metadata, catalogue, search, episodes, schedule
  └── Hoshika ID
         │
         ▼
   AniList ID resolver
         │
         ├── AniList ID ──────────────► AniScroll stream lookup
         │
         └── AniList ID
                 │
                 ▼
              AniZip
                 │
                 ├── TVDB / TMDB IDs ─► Fanart.tv artwork
                 └── MAL ID ──────────► AniSkip skip timestamps
```

Hoshika IDs are used in AniScroll page URLs. They are **not assumed** to be AniList or MAL IDs. The resolver matches anime using title and available metadata, then caches the mapping. A match may be provisional or fail when a reliable match cannot be established.

Fanart.tv is queried using mapped TVDB/TMDB identifiers rather than Hoshika IDs. If external artwork is unavailable, the app falls back to Hoshika artwork or typography. Character artwork is not used in the hero banner.

## Routes

### Pages

| Route | Description |
|---|---|
| `/` | Home and featured anime carousel |
| `/explore` | Browse and filter the catalogue |
| `/search?q={query}` | Search results |
| `/anime/[id]` | Anime details and episodes |
| `/watch/[id]/[episode]` | Episode watch page |
| `/trending` | Trending anime |
| `/popular` | Popular anime |
| `/recent` | Recently added/updated anime |
| `/schedule` | Airing schedule |
| `/genres` | Genre discovery |
| `/watchlist` | Saved anime |
| `/continue-watching` | Resume playback |
| `/history` | Watch history |
| `/settings` | Preferences |
| `/profile` | Profile page |

### API routes

| Route | Purpose |
|---|---|
| `GET /api/search?q={query}&limit={n}` | Search Hoshika |
| `GET /api/anime/[id]` | Fetch anime details |
| `GET /api/episodes/[id]?locale=en&after={episode}&limit=50` | Fetch an episode page |
| `GET /api/episodes/[id]?all=true` | Fetch all available episode pages |
| `GET /api/catalog` | Browse/filter catalogue |
| `GET /api/home` | Homepage feed |
| `GET /api/schedule` | Airing schedule |
| `GET /api/resolve-ids/[id]` | Resolve AniList and MAL identifiers |
| `GET /api/artwork/[id]` | Resolve artwork |
| `GET /api/stream?anilistId={id}&episode={n}&type={sub\|dub}` | Retrieve a stream |
| `GET /api/skips?malId={id}&episode={n}&duration={seconds}` | Retrieve AniSkip markers |
| `GET /api/subtitles?url={subtitleUrl}` | Fetch subtitle content |

Use the app's API route handlers and source code as the authoritative reference if a route's parameters or response shape change.

## Requirements

- [Bun](https://bun.sh/) (recommended; the repository includes `bun.lock`)
- Node.js compatible with the installed Next.js version
- Access to the upstream APIs
- API credentials configured as environment variables where required

## Getting started

1. Clone the repository:

   ```bash
   git clone https://github.com/piyushbalam2009/ANISCROLL-website.git
   cd ANISCROLL-website
   ```

2. Install dependencies:

   ```bash
   bun install
   ```

   npm can also be used if preferred:

   ```bash
   npm install
   ```

3. Create your local environment file:

   ```bash
   cp .env.example .env.local
   ```

4. Add the credentials you use for the integrations to `.env.local`. See [Environment variables](#environment-variables).

5. Start the development server:

   ```bash
   bun run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000).

## Environment variables

The repository includes an `.env.example` template:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | Gemini API key for any Gemini-backed functionality enabled in the app/runtime. |
| `APP_URL` | Public app URL used for hosted/self-referential URLs and callbacks. |
| `HOSHIKA_CLIENT_ID` | Hoshika OAuth client ID for endpoints or user-authorized features that require OAuth. |
| `HOSHIKA_CLIENT_SECRET` | Hoshika OAuth client secret. Keep server-side only. |
| `FANART_API_KEY` | Fanart.tv v3.2 API key for artwork lookups. |

Example:

```env
GEMINI_API_KEY=
APP_URL=http://localhost:3000
HOSHIKA_CLIENT_ID=
HOSHIKA_CLIENT_SECRET=
FANART_API_KEY=
```

**Security notes**

- Never commit `.env.local`, real API keys, OAuth secrets, or tokens.
- Never expose `HOSHIKA_CLIENT_SECRET` or `FANART_API_KEY` in client-side code.
- Configure production secrets in your hosting provider's environment settings.
- Public Hoshika catalogue requests may work without OAuth credentials; only configure OAuth credentials for the authorized functionality that needs them.

## Available scripts

| Command | Description |
|---|---|
| `bun run dev` | Start the Next.js development server |
| `bun run build` | Create a production build |
| `bun run start` | Start the production server |
| `bun run lint` | Run ESLint |
| `bun run clean` | Run Next.js clean |

Equivalent `npm run <script>` commands are available.

## Project structure

```text
.
├── app/
│   ├── api/                  # Next.js Route Handlers
│   ├── anime/[id]/           # Anime details page
│   ├── watch/[id]/[episode]/ # Watch page
│   ├── explore/
│   ├── search/
│   ├── schedule/
│   ├── watchlist/
│   ├── history/
│   ├── settings/
│   └── page.tsx              # Home page
├── components/
│   ├── anime/                # Anime cards, hero banners, details
│   ├── episodes/             # Episode list and pagination
│   ├── layout/               # Sidebar, floating header, search
│   └── player/               # Video player and subtitle UI
├── hooks/                    # React hooks
├── lib/                      # API clients, mapping, caching, storage
├── types/                    # Shared TypeScript types
├── .env.example
├── next.config.ts
├── package.json
└── bun.lock
```

## Notes and limitations

- **Provider coverage varies:** Hoshika metadata, Fanart.tv artwork, AniScroll streams, subtitles, and AniSkip markers are not guaranteed for every title or episode.
- **ID matching:** When Hoshika does not provide external IDs, AniScroll resolves candidates through AniList metadata. Ambiguous or low-confidence matches should not be treated as guaranteed.
- **Artwork:** Fanart.tv uses external TVDB/TMDB identifiers. Artwork availability and language/quality vary by series.
- **Playback:** HLS support depends on the returned stream URL, browser capabilities, CORS configuration, and upstream availability.
- **Skip markers:** AniSkip requires a matching MAL ID and may not have opening/ending timestamps for every episode.
- **Local library:** Watchlist, watch history, progress, and preferences are browser-local in the current implementation; they are not automatically synchronized across devices.
- **Content rights:** Configure and use upstream streaming providers only where you have the necessary rights and permission. AniScroll is a frontend/integration project and does not host video files.

## Contributing

Issues and pull requests are welcome. Before submitting changes:

1. Keep API credentials out of source control.
2. Preserve the shared TypeScript types and reusable components.
3. Handle unavailable upstream metadata and media gracefully.
4. Run linting and a production build:

   ```bash
   bun run lint
   bun run build
   ```

## License

No license file is currently specified in this repository. Unless a license is added, all rights remain with the copyright holder; do not assume the code is available for reuse or redistribution.

## Acknowledgements

AniScroll integrates with the following projects and services:

- [Hoshika](https://hoshika.app/developers) — anime metadata
- [AniList](https://anilist.co/) — anime ID resolution
- [AniZip](https://api.ani.zip/) — external ID mappings and artwork metadata
- [Fanart.tv](https://fanart.tv/) — fan artwork and transparent logos
- [AniScroll API](https://api.aniscroll.in) — streaming source lookup
- [AniSkip](https://api.aniskip.com/docs#v2) — opening and ending skip timestamps
- [Next.js](https://nextjs.org/) — application framework
