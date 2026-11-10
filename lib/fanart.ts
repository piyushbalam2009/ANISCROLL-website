import { FanartImage, FanartResponse, FanartLogoItem } from '@/types/artwork';

const BASE_CURATED_FANART: Record<string, FanartResponse> = {
  // Solo Leveling (TVDB: 389597)
  '389597': {
    name: 'Solo Leveling',
    thetvdb_id: '389597',
    hdtvlogo: [
      {
        id: '355120',
        url: 'https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo-leveling-6599749994162.png',
        lang: 'en',
        likes: '14',
      },
      {
        id: '355121',
        url: 'https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo-leveling-658720944664a.png',
        lang: 'ja',
        likes: '9',
      },
    ],
    clearlogo: [
      {
        id: '355129',
        url: 'https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo-leveling-6599749994162.png',
        lang: 'en',
        likes: '7',
      },
      {
        id: '355130',
        url: 'https://assets.fanart.tv/fanart/tv/389597/hdtvlogo/solo-leveling-658720944664a.png',
        lang: 'ja',
        likes: '5',
      },
    ],
    showbackground: [
      {
        id: '355122',
        url: 'https://assets.fanart.tv/fanart/tv/389597/showbackground/solo-leveling-65985b9a8414e.jpg',
        lang: 'en',
        likes: '18',
      },
    ],
  },
  // Frieren: Beyond Journey's End (TVDB: 424536)
  '424536': {
    name: "Frieren: Beyond Journey's End",
    thetvdb_id: '424536',
    hdtvlogo: [
      {
        id: '348901',
        url: 'https://assets.fanart.tv/fanart/tv/424536/hdtvlogo/frieren-beyond-journeys-end-65173d4131c8e.png',
        lang: 'en',
        likes: '16',
      },
      {
        id: '348905',
        url: 'https://assets.fanart.tv/fanart/tv/424536/hdtvlogo/frieren-beyond-journeys-end-65173d4131c8e.png',
        lang: 'ja',
        likes: '8',
      },
    ],
    clearlogo: [
      {
        id: '348909',
        url: 'https://assets.fanart.tv/fanart/tv/424536/hdtvlogo/frieren-beyond-journeys-end-65173d4131c8e.png',
        lang: 'en',
        likes: '6',
      },
    ],
    showbackground: [
      {
        id: '348902',
        url: 'https://assets.fanart.tv/fanart/tv/424536/showbackground/frieren-beyond-journeys-end-65183397111a2.jpg',
        lang: 'en',
        likes: '21',
      },
    ],
  },
  // Jujutsu Kaisen (TVDB: 377543)
  '377543': {
    name: 'Jujutsu Kaisen',
    thetvdb_id: '377543',
    hdtvlogo: [
      {
        id: '289101',
        url: 'https://assets.fanart.tv/fanart/tv/377543/hdtvlogo/jujutsu-kaisen-5f78b4b5d1289.png',
        lang: 'en',
        likes: '24',
      },
      {
        id: '289105',
        url: 'https://assets.fanart.tv/fanart/tv/377543/hdtvlogo/jujutsu-kaisen-5f78b4b5d1289.png',
        lang: 'ja',
        likes: '14',
      },
    ],
    clearlogo: [
      {
        id: '289108',
        url: 'https://assets.fanart.tv/fanart/tv/377543/hdtvlogo/jujutsu-kaisen-5f78b4b5d1289.png',
        lang: 'en',
        likes: '11',
      },
      {
        id: '289109',
        url: 'https://assets.fanart.tv/fanart/tv/377543/hdtvlogo/jujutsu-kaisen-5f78b4b5d1289.png',
        lang: 'ja',
        likes: '8',
      },
    ],
    showbackground: [
      {
        id: '289102',
        url: 'https://assets.fanart.tv/fanart/tv/377543/showbackground/jujutsu-kaisen-5f81d183b6593.jpg',
        lang: 'en',
        likes: '19',
      },
    ],
  },
  // One Piece (TVDB: 81797)
  '81797': {
    name: 'One Piece',
    thetvdb_id: '81797',
    hdtvlogo: [
      {
        id: '101201',
        url: 'https://assets.fanart.tv/fanart/tv/81797/hdtvlogo/one-piece-514772cd6fa3f.png',
        lang: 'en',
        likes: '42',
      },
      {
        id: '101205',
        url: 'https://assets.fanart.tv/fanart/tv/81797/hdtvlogo/one-piece-514772cd6fa3f.png',
        lang: 'ja',
        likes: '23',
      },
    ],
    clearlogo: [
      {
        id: '101208',
        url: 'https://assets.fanart.tv/fanart/tv/81797/hdtvlogo/one-piece-514772cd6fa3f.png',
        lang: 'en',
        likes: '19',
      },
      {
        id: '101209',
        url: 'https://assets.fanart.tv/fanart/tv/81797/hdtvlogo/one-piece-514772cd6fa3f.png',
        lang: 'ja',
        likes: '14',
      },
    ],
    showbackground: [
      {
        id: '101202',
        url: 'https://assets.fanart.tv/fanart/tv/81797/showbackground/one-piece-54695a8f96e46.jpg',
        lang: 'en',
        likes: '35',
      },
    ],
  },
  // Demon Slayer: Kimetsu no Yaiba (TVDB: 348545)
  '348545': {
    name: 'Demon Slayer: Kimetsu no Yaiba',
    thetvdb_id: '348545',
    hdtvlogo: [
      {
        id: '219401',
        url: 'https://assets.fanart.tv/fanart/tv/348545/hdtvlogo/demon-slayer-kimetsu-no-yaiba-5d09362f00816.png',
        lang: 'en',
        likes: '29',
      },
      {
        id: '219405',
        url: 'https://assets.fanart.tv/fanart/tv/348545/hdtvlogo/demon-slayer-kimetsu-no-yaiba-5d09362f00816.png',
        lang: 'ja',
        likes: '15',
      },
    ],
    clearlogo: [
      {
        id: '219408',
        url: 'https://assets.fanart.tv/fanart/tv/348545/hdtvlogo/demon-slayer-kimetsu-no-yaiba-5d09362f00816.png',
        lang: 'en',
        likes: '12',
      },
    ],
    showbackground: [
      {
        id: '219402',
        url: 'https://assets.fanart.tv/fanart/tv/348545/showbackground/demon-slayer-kimetsu-no-yaiba-5cb367a455264.jpg',
        lang: 'en',
        likes: '31',
      },
    ],
  },
  // Attack on Titan (TVDB: 267440)
  '267440': {
    name: 'Attack on Titan',
    thetvdb_id: '267440',
    hdtvlogo: [
      {
        id: '154301',
        url: 'https://assets.fanart.tv/fanart/tv/267440/hdtvlogo/attack-on-titan-517488e2524f3.png',
        lang: 'en',
        likes: '45',
      },
      {
        id: '154305',
        url: 'https://assets.fanart.tv/fanart/tv/267440/hdtvlogo/attack-on-titan-517488e2524f3.png',
        lang: 'ja',
        likes: '22',
      },
    ],
    clearlogo: [
      {
        id: '154308',
        url: 'https://assets.fanart.tv/fanart/tv/267440/hdtvlogo/attack-on-titan-517488e2524f3.png',
        lang: 'en',
        likes: '18',
      },
      {
        id: '154309',
        url: 'https://assets.fanart.tv/fanart/tv/267440/hdtvlogo/attack-on-titan-517488e2524f3.png',
        lang: 'ja',
        likes: '11',
      },
    ],
    showbackground: [
      {
        id: '154302',
        url: 'https://assets.fanart.tv/fanart/tv/267440/showbackground/attack-on-titan-52267d3975922.jpg',
        lang: 'en',
        likes: '39',
      },
    ],
  },
  // Hunter x Hunter (TVDB: 252322)
  '252322': {
    name: 'Hunter x Hunter (2011)',
    thetvdb_id: '252322',
    hdtvlogo: [
      {
        id: '188201',
        url: 'https://assets.fanart.tv/fanart/tv/252322/hdtvlogo/hunter-x-hunter-2011-5377586c1b0dc.png',
        lang: 'en',
        likes: '31',
      },
      {
        id: '188205',
        url: 'https://assets.fanart.tv/fanart/tv/252322/hdtvlogo/hunter-x-hunter-2011-5377586c1b0dc.png',
        lang: 'ja',
        likes: '14',
      },
    ],
    clearlogo: [
      {
        id: '188208',
        url: 'https://assets.fanart.tv/fanart/tv/252322/hdtvlogo/hunter-x-hunter-2011-5377586c1b0dc.png',
        lang: 'en',
        likes: '12',
      },
    ],
    showbackground: [
      {
        id: '188202',
        url: 'https://assets.fanart.tv/fanart/tv/252322/showbackground/hunter-x-hunter-2011-537758b775b41.jpg',
        lang: 'en',
        likes: '28',
      },
    ],
  },
  // Bleach (TVDB: 74796)
  '74796': {
    name: 'Bleach',
    thetvdb_id: '74796',
    hdtvlogo: [
      {
        id: '112301',
        url: 'https://assets.fanart.tv/fanart/tv/74796/hdtvlogo/bleach-503c0a3418f21.png',
        lang: 'en',
        likes: '28',
      },
      {
        id: '112305',
        url: 'https://assets.fanart.tv/fanart/tv/74796/hdtvlogo/bleach-503c0a3418f21.png',
        lang: 'ja',
        likes: '13',
      },
    ],
    clearlogo: [
      {
        id: '112308',
        url: 'https://assets.fanart.tv/fanart/tv/74796/hdtvlogo/bleach-503c0a3418f21.png',
        lang: 'en',
        likes: '10',
      },
    ],
    showbackground: [
      {
        id: '112302',
        url: 'https://assets.fanart.tv/fanart/tv/74796/showbackground/bleach-4fd7519c949b7.jpg',
        lang: 'en',
        likes: '25',
      },
    ],
  },
  // Chainsaw Man (TVDB: 393409)
  '393409': {
    name: 'Chainsaw Man',
    thetvdb_id: '393409',
    hdtvlogo: [
      {
        id: '321501',
        url: 'https://assets.fanart.tv/fanart/tv/393409/hdtvlogo/chainsaw-man-633ee15fd5034.png',
        lang: 'en',
        likes: '22',
      },
      {
        id: '321505',
        url: 'https://assets.fanart.tv/fanart/tv/393409/hdtvlogo/chainsaw-man-633ee15fd5034.png',
        lang: 'ja',
        likes: '12',
      },
    ],
    clearlogo: [
      {
        id: '321508',
        url: 'https://assets.fanart.tv/fanart/tv/393409/hdtvlogo/chainsaw-man-633ee15fd5034.png',
        lang: 'en',
        likes: '9',
      },
    ],
    showbackground: [
      {
        id: '321502',
        url: 'https://assets.fanart.tv/fanart/tv/393409/showbackground/chainsaw-man-6345d3659347a.jpg',
        lang: 'en',
        likes: '20',
      },
    ],
  },
  // Dan Da Dan (TVDB: 442531)
  '442531': {
    name: 'DAN DA DAN',
    thetvdb_id: '442531',
    hdtvlogo: [
      {
        id: '372101',
        url: 'https://assets.fanart.tv/fanart/tv/442531/hdtvlogo/dandadan-66e8969571588.png',
        lang: 'en',
        likes: '15',
      },
      {
        id: '372105',
        url: 'https://assets.fanart.tv/fanart/tv/442531/hdtvlogo/dandadan-66e8969571588.png',
        lang: 'ja',
        likes: '9',
      },
    ],
    clearlogo: [
      {
        id: '372108',
        url: 'https://assets.fanart.tv/fanart/tv/442531/hdtvlogo/dandadan-66e8969571588.png',
        lang: 'en',
        likes: '6',
      },
    ],
    showbackground: [
      {
        id: '372102',
        url: 'https://assets.fanart.tv/fanart/tv/442531/showbackground/dandadan-67002f8b8c04d.jpg',
        lang: 'en',
        likes: '17',
      },
    ],
  },
  // Kaiju No. 8 (TVDB: 423043)
  '423043': {
    name: 'Kaiju No. 8',
    thetvdb_id: '423043',
    hdtvlogo: [
      {
        id: '361201',
        url: 'https://assets.fanart.tv/fanart/tv/423043/hdtvlogo/kaiju-no-8-6613e15c87918.png',
        lang: 'en',
        likes: '14',
      },
      {
        id: '361205',
        url: 'https://assets.fanart.tv/fanart/tv/423043/hdtvlogo/kaiju-no-8-6613e15c87918.png',
        lang: 'ja',
        likes: '8',
      },
    ],
    clearlogo: [
      {
        id: '361208',
        url: 'https://assets.fanart.tv/fanart/tv/423043/hdtvlogo/kaiju-no-8-6613e15c87918.png',
        lang: 'en',
        likes: '6',
      },
    ],
    showbackground: [
      {
        id: '361202',
        url: 'https://assets.fanart.tv/fanart/tv/423043/showbackground/kaiju-no-8-661bbff9d988c.jpg',
        lang: 'en',
        likes: '16',
      },
    ],
  },
  // Black Clover (TVDB: 331753)
  '331753': {
    name: 'Black Clover',
    thetvdb_id: '331753',
    hdtvlogo: [
      {
        id: '241101',
        url: 'https://assets.fanart.tv/fanart/tv/331753/hdtvlogo/black-clover-59d295bf2646c.png',
        lang: 'en',
        likes: '19',
      },
      {
        id: '241105',
        url: 'https://assets.fanart.tv/fanart/tv/331753/hdtvlogo/black-clover-59d295bf2646c.png',
        lang: 'ja',
        likes: '11',
      },
    ],
    clearlogo: [
      {
        id: '241108',
        url: 'https://assets.fanart.tv/fanart/tv/331753/hdtvlogo/black-clover-59d295bf2646c.png',
        lang: 'en',
        likes: '14',
      },
      {
        id: '241109',
        url: 'https://assets.fanart.tv/fanart/tv/331753/hdtvlogo/black-clover-59d295bf2646c.png',
        lang: 'ja',
        likes: '7',
      },
    ],
    showbackground: [
      {
        id: '241102',
        url: 'https://assets.fanart.tv/fanart/tv/331753/showbackground/black-clover-59e3bd8bd810b.jpg',
        lang: 'en',
        likes: '21',
      },
    ],
  },
  // Death Note (TVDB: 79481 & 79824)
  '79481': {
    name: 'Death Note',
    thetvdb_id: '79481',
    hdtvlogo: [
      {
        id: '105401',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'en',
        likes: '38',
      },
      {
        id: '105405',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'ja',
        likes: '17',
      },
    ],
    clearlogo: [
      {
        id: '105408',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'en',
        likes: '15',
      },
    ],
    showbackground: [
      {
        id: '105402',
        url: 'https://assets.fanart.tv/fanart/tv/79481/showbackground/death-note-4fc68049a96ef.jpg',
        lang: 'en',
        likes: '33',
      },
    ],
  },
  '79824': {
    name: 'Death Note',
    thetvdb_id: '79824',
    hdtvlogo: [
      {
        id: '105401',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'en',
        likes: '38',
      },
      {
        id: '105405',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'ja',
        likes: '17',
      },
    ],
    clearlogo: [
      {
        id: '105408',
        url: 'https://assets.fanart.tv/fanart/tv/79481/hdtvlogo/death-note-50401ef8a8b24.png',
        lang: 'en',
        likes: '15',
      },
    ],
    showbackground: [
      {
        id: '105402',
        url: 'https://assets.fanart.tv/fanart/tv/79481/showbackground/death-note-4fc68049a96ef.jpg',
        lang: 'en',
        likes: '33',
      },
    ],
  },
};

export const CURATED_FANART_ARTWORK: Record<string, FanartResponse> = {
  ...BASE_CURATED_FANART,
  ...Object.fromEntries(
    Object.entries(BASE_CURATED_FANART).map(([k, v]) => [`tv:${k}`, v])
  ),
};

export function pickBestFanartImage(
  images?: FanartImage[],
  preferredLang = 'en'
): FanartImage | null {
  if (!images || !Array.isArray(images) || images.length === 0) {
    return null;
  }

  const validImages = images.filter(
    (img) => img && typeof img.url === 'string' && img.url.trim().length > 0
  );
  if (validImages.length === 0) return null;

  const sortByLikes = (a: FanartImage, b: FanartImage) => {
    const likesA = parseInt(a.likes || '0', 10) || 0;
    const likesB = parseInt(b.likes || '0', 10) || 0;
    return likesB - likesA;
  };

  const preferred = validImages
    .filter(
      (img) =>
        img.lang === preferredLang || img.lang === '00' || img.lang === ''
    )
    .sort(sortByLikes);

  if (preferred.length > 0) {
    return preferred[0];
  }

  const japanese = validImages.filter((img) => img.lang === 'ja').sort(sortByLikes);
  if (japanese.length > 0) {
    return japanese[0];
  }

  const sortedAll = [...validImages].sort(sortByLikes);
  return sortedAll[0] || null;
}

export function selectBestFanartImage(images?: FanartImage[]): string | null {
  return pickBestFanartImage(images, 'en')?.url || null;
}

/**
 * Extracts ALL available hdtvlogo, hdmovielogo, clearlogo, and movielogo images
 * from a FanartResponse and sorts them according to the strict priority hierarchy:
 * 1. Fanart.tv English hdtvlogo
 * 2. Fanart.tv English clearlogo
 * 3. Fanart.tv Japanese hdtvlogo
 * 4. Fanart.tv Japanese clearlogo
 * 5. Other available Fanart.tv hdtvlogo
 * 6. Other available Fanart.tv clearlogo
 */
export function extractAllFanartLogos(
  fanartData: FanartResponse | null | undefined,
  proxyFn?: (url: string) => string | null,
  preferEnglish = true
): FanartLogoItem[] {
  if (!fanartData) return [];

  const items: FanartLogoItem[] = [];
  const seenKeys = new Set<string>();

  const addGroup = (
    list: FanartImage[] | undefined,
    source: 'fanart_hdtvlogo' | 'fanart_clearlogo',
    category: 'hdtvlogo' | 'clearlogo'
  ) => {
    if (!Array.isArray(list)) return;
    for (const img of list) {
      if (!img || typeof img.url !== 'string' || !img.url.trim()) continue;
      const rawUrl = img.url.trim();
      const lang = (img.lang || 'en').trim().toLowerCase() || 'en';
      const normalizedLang = lang === '00' ? 'en' : lang;
      const dedupeKey = `${category}:${img.id || rawUrl}:${normalizedLang}`;
      if (seenKeys.has(dedupeKey)) continue;
      seenKeys.add(dedupeKey);

      const likes = parseInt(img.likes || '0', 10) || 0;
      const proxyUrl = (proxyFn ? proxyFn(rawUrl) : rawUrl) || rawUrl;

      items.push({
        id: img.id ? `${category}_${img.id}` : `${category}_${items.length + 1}`,
        url: rawUrl,
        proxyUrl,
        lang: normalizedLang,
        language: normalizedLang,
        likes,
        source,
        provider: 'fanart',
        category,
        type: category,
        label: `${category.toUpperCase()} (${normalizedLang.toUpperCase()}) • ${likes} likes`,
      });
    }
  };

  addGroup(fanartData.hdtvlogo, 'fanart_hdtvlogo', 'hdtvlogo');
  addGroup(fanartData.hdmovielogo, 'fanart_hdtvlogo', 'hdtvlogo');
  addGroup(fanartData.clearlogo, 'fanart_clearlogo', 'clearlogo');
  addGroup(fanartData.movielogo, 'fanart_clearlogo', 'clearlogo');

  return sortLogosByPriority(items, preferEnglish);
}

export function sortLogosByPriority(
  logos: FanartLogoItem[],
  preferEnglish = true
): FanartLogoItem[] {
  const getTier = (item: FanartLogoItem): number => {
    const lang = (item.lang || item.language || 'en').toLowerCase();
    const isEn = lang === 'en' || lang === '00' || lang === '';
    const isJa = lang === 'ja';
    const isHd = item.category === 'hdtvlogo' || item.type === 'hdtvlogo';

    if (preferEnglish) {
      if (isEn && isHd) return 1;
      if (isEn && !isHd) return 2;
      if (isJa && isHd) return 3;
      if (isJa && !isHd) return 4;
      if (isHd) return 5;
      return 6;
    } else {
      if (isJa && isHd) return 1;
      if (isJa && !isHd) return 2;
      if (isEn && isHd) return 3;
      if (isEn && !isHd) return 4;
      if (isHd) return 5;
      return 6;
    }
  };

  return [...logos].sort((a, b) => {
    const tierDiff = getTier(a) - getTier(b);
    if (tierDiff !== 0) return tierDiff;
    return (b.likes || 0) - (a.likes || 0);
  });
}

function mergeFanartResponses(
  primary: FanartResponse,
  fallback?: FanartResponse
): FanartResponse {
  if (!fallback) return primary;
  const mergeList = (a?: FanartImage[], b?: FanartImage[]): FanartImage[] | undefined => {
    if (!a && !b) return undefined;
    const map = new Map<string, FanartImage>();
    for (const item of [...(a || []), ...(b || [])]) {
      if (item && item.url) {
        const key = `${item.id || item.url}:${item.lang || 'en'}`;
        if (!map.has(key)) map.set(key, item);
      }
    }
    return Array.from(map.values());
  };

  return {
    ...fallback,
    ...primary,
    hdtvlogo: mergeList(primary.hdtvlogo, fallback.hdtvlogo),
    clearlogo: mergeList(primary.clearlogo, fallback.clearlogo),
    hdmovielogo: mergeList(primary.hdmovielogo, fallback.hdmovielogo),
    movielogo: mergeList(primary.movielogo, fallback.movielogo),
    showbackground: mergeList(primary.showbackground, fallback.showbackground),
    moviebackground: mergeList(primary.moviebackground, fallback.moviebackground),
    tvposter: mergeList(primary.tvposter, fallback.tvposter),
    movieposter: mergeList(primary.movieposter, fallback.movieposter),
  };
}

export async function fetchFanartArtwork(
  paramsOrId:
    | number
    | string
    | {
        tvdbId?: number | null;
        tmdbId?: number | null;
        isMovie?: boolean;
      },
  typeArg: 'tv' | 'movies' = 'tv'
): Promise<FanartResponse | null> {
  const apiKey = process.env.FANART_API_KEY || process.env.FANART_TV_API_KEY;

  let targetId: number | string | null | undefined;
  let endpointType: 'tv' | 'movies' = typeArg;

  if (typeof paramsOrId === 'object' && paramsOrId !== null) {
    const { tvdbId, tmdbId, isMovie } = paramsOrId;
    targetId = isMovie ? tmdbId || tvdbId : tvdbId || tmdbId;
    endpointType = isMovie && tmdbId ? 'movies' : 'tv';
  } else {
    targetId = paramsOrId;
    endpointType = typeArg;
  }

  if (!targetId) {
    return null;
  }

  const curated =
    CURATED_FANART_ARTWORK[`${endpointType}:${targetId}`] ||
    CURATED_FANART_ARTWORK[String(targetId)];

  if (apiKey && apiKey !== 'MY_FANART_API_KEY' && apiKey.trim().length > 5) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const url = `https://webservice.fanart.tv/v3/${endpointType}/${targetId}?api_key=${encodeURIComponent(
        apiKey.trim()
      )}`;
      const res = await fetch(url, {
        next: { revalidate: 3600 },
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const data = (await res.json()) as FanartResponse;
        if (
          data &&
          (data.hdtvlogo ||
            data.showbackground ||
            data.hdmovielogo ||
            data.moviebackground ||
            data.clearlogo ||
            data.movielogo)
        ) {
          return mergeFanartResponses(data, curated);
        }
      }
    } catch {
      // Fall through to curated registry or null
    } finally {
      clearTimeout(timeout);
    }
  }

  return curated || null;
}
