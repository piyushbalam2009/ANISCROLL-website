import { FanartImage, FanartResponse, FanartLogoItem } from '@/types/artwork';

const BASE_CURATED_FANART: Record<string, FanartResponse> = {
  // Demon Slayer: Kimetsu no Yaiba (TVDB: 348545)
  '348545': {
    name: 'Demon Slayer: Kimetsu no Yaiba',
    thetvdb_id: '348545',
    hdtvlogo: [
      {
        id: '219401',
        url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce04655066e4.png',
        lang: 'en',
        likes: '29',
      },
      {
        id: '219402',
        url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-64bd402213d73.png',
        lang: 'en',
        likes: '18',
      },
      {
        id: '219405',
        url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-5ce0464b747b6.png',
        lang: 'ja',
        likes: '15',
      },
    ],
    clearlogo: [
      {
        id: '219408',
        url: 'https://assets.fanart.tv/fanart/demon-slayer-kimetsu-no-yaiba-620983678fee5.png',
        lang: 'en',
        likes: '12',
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
        url: 'https://assets.fanart.tv/fanart/attack-on-titan-5355731a3ebe5.png',
        lang: 'en',
        likes: '45',
      },
      {
        id: '154305',
        url: 'https://assets.fanart.tv/fanart/attack-on-titan-51a64c2cb7247.png',
        lang: 'ja',
        likes: '22',
      },
    ],
    clearlogo: [
      {
        id: '154308',
        url: 'https://assets.fanart.tv/fanart/attack-on-titan-523efe6e4910a.png',
        lang: 'en',
        likes: '18',
      },
      {
        id: '154309',
        url: 'https://assets.fanart.tv/fanart/attack-on-titan-5161b2a4a6318.png',
        lang: 'ja',
        likes: '11',
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
        url: 'https://assets.fanart.tv/fanart/hunter-x-hunter-2011-56c9b2afa909e.png',
        lang: 'en',
        likes: '31',
      },
      {
        id: '188205',
        url: 'https://assets.fanart.tv/fanart/hunter-x-hunter-2011-54350192d52d2.png',
        lang: 'ja',
        likes: '14',
      },
    ],
    clearlogo: [
      {
        id: '188208',
        url: 'https://assets.fanart.tv/fanart/hunter-x-hunter-2011-4f02ea599fdff.png',
        lang: 'en',
        likes: '12',
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
        url: 'https://assets.fanart.tv/fanart/bleach-695a06ea02b92.png',
        lang: 'en',
        likes: '28',
      },
      {
        id: '112305',
        url: 'https://assets.fanart.tv/fanart/bleach-517d60c51e282.png',
        lang: 'ja',
        likes: '13',
      },
    ],
    clearlogo: [
      {
        id: '112308',
        url: 'https://assets.fanart.tv/fanart/bleach-5063528161e4f.png',
        lang: 'en',
        likes: '10',
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
        url: 'https://assets.fanart.tv/fanart/black-clover-5a3ed930864f0.png',
        lang: 'en',
        likes: '19',
      },
      {
        id: '241105',
        url: 'https://assets.fanart.tv/fanart/black-clover-5c75b30b0e5a8.png',
        lang: 'ja',
        likes: '11',
      },
    ],
    clearlogo: [
      {
        id: '241108',
        url: 'https://assets.fanart.tv/fanart/black-clover-5a3ed930864f0.png',
        lang: 'en',
        likes: '14',
      },
      {
        id: '241109',
        url: 'https://assets.fanart.tv/fanart/black-clover-5c75b30b0e5a8.png',
        lang: 'ja',
        likes: '7',
      },
    ],
  },
  // Naruto Shippuden (TVDB: 79824)
  '79824': {
    name: 'Naruto Shippuden',
    thetvdb_id: '79824',
    hdtvlogo: [
      {
        id: '198241',
        url: 'https://assets.fanart.tv/fanart/naruto-shippuuden-540cc2d768e14.png',
        lang: 'en',
        likes: '26',
      },
      {
        id: '198242',
        url: 'https://assets.fanart.tv/fanart/naruto-shippuuden-5063504ebc6e7.png',
        lang: 'ja',
        likes: '14',
      },
    ],
    clearlogo: [
      {
        id: '198243',
        url: 'https://assets.fanart.tv/fanart/naruto-shippuuden-540cc2d768e14.png',
        lang: 'en',
        likes: '11',
      },
    ],
  },
  // Fullmetal Alchemist: Brotherhood (TVDB: 85249)
  '85249': {
    name: 'Fullmetal Alchemist: Brotherhood',
    thetvdb_id: '85249',
    hdtvlogo: [
      {
        id: '852491',
        url: 'https://assets.fanart.tv/fanart/fullmetal-alchemist-brotherhood-51e2acc9b4536.png',
        lang: 'en',
        likes: '34',
      },
    ],
    showbackground: [
      {
        id: '852492',
        url: 'https://assets.fanart.tv/fanart/fullmetal-alchemist-brotherhood-5eb1ba644c2a4.jpg',
        lang: 'en',
        likes: '28',
      },
    ],
  },
  // One-Punch Man (TVDB: 293088)
  '293088': {
    name: 'One-Punch Man',
    thetvdb_id: '293088',
    hdtvlogo: [
      {
        id: '2930881',
        url: 'https://assets.fanart.tv/fanart/one-punch-man-55fd2d46f35d1.png',
        lang: 'en',
        likes: '32',
      },
    ],
    showbackground: [
      {
        id: '2930882',
        url: 'https://assets.fanart.tv/fanart/one-punch-man-60b6e1ee91de8.jpg',
        lang: 'en',
        likes: '25',
      },
    ],
  },
  // My Hero Academia (TVDB: 305074)
  '305074': {
    name: 'My Hero Academia',
    thetvdb_id: '305074',
    hdtvlogo: [
      {
        id: '3050741',
        url: 'https://assets.fanart.tv/fanart/my-hero-academia-58ab2e4282d2a.png',
        lang: 'en',
        likes: '30',
      },
    ],
    showbackground: [
      {
        id: '3050742',
        url: 'https://assets.fanart.tv/fanart/my-hero-academia-5ca8d43cd466f.jpg',
        lang: 'en',
        likes: '24',
      },
    ],
  },
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
  },
  // Death Note (TVDB: 79481)
  '79481': {
    name: 'Death Note',
    thetvdb_id: '79481',
    hdtvlogo: [],
    clearlogo: [],
  },
  // Naruto (TVDB: 78857)
  '78857': {
    name: 'Naruto',
    thetvdb_id: '78857',
    hdtvlogo: [],
    clearlogo: [],
  },
};

export const CURATED_FANART_ARTWORK: Record<string, FanartResponse> = {
  ...BASE_CURATED_FANART,
  ...Object.fromEntries(
    Object.entries(BASE_CURATED_FANART).map(([k, v]) => [`tv:${k}`, v])
  ),
};

export function sortFanartImagesByPreference(
  images?: FanartImage[],
  preferredLang = 'en'
): FanartImage[] {
  if (!images || !Array.isArray(images) || images.length === 0) {
    return [];
  }

  const validImages = images.filter(
    (img) => img && typeof img.url === 'string' && img.url.trim().length > 0
  );
  if (validImages.length === 0) return [];

  const getLangRank = (langRaw?: string): number => {
    const lang = (langRaw || '').trim().toLowerCase();
    if (lang === preferredLang || lang === '00' || lang === '') return 1;
    if (lang === 'ja') return 2;
    return 3;
  };

  return [...validImages].sort((a, b) => {
    const rankDiff = getLangRank(a.lang) - getLangRank(b.lang);
    if (rankDiff !== 0) return rankDiff;
    const likesA = parseInt(a.likes || '0', 10) || 0;
    const likesB = parseInt(b.likes || '0', 10) || 0;
    return likesB - likesA;
  });
}

export function pickBestFanartImage(
  images?: FanartImage[],
  preferredLang = 'en'
): FanartImage | null {
  const sorted = sortFanartImagesByPreference(images, preferredLang);
  return sorted[0] || null;
}

export function selectBestFanartImage(images?: FanartImage[]): string | null {
  return pickBestFanartImage(images, 'en')?.url || null;
}

/**
 * Extracts all valid landscape background images from a FanartResponse in priority order:
 * 1. showbackground / moviebackground
 * 2. tvthumb / moviethumb (landscape 16:9 thumbs)
 * Never includes hdtvlogo, clearlogo, tvposter, or movieposter.
 */
export function extractAllFanartBackdrops(
  fanartData: FanartResponse | null | undefined,
  proxyFn?: (url: string) => string | null,
  preferredLang = 'en'
): string[] {
  if (!fanartData) return [];

  const orderedRaw: FanartImage[] = [
    ...sortFanartImagesByPreference(fanartData.showbackground, preferredLang),
    ...sortFanartImagesByPreference(fanartData.moviebackground, preferredLang),
    ...sortFanartImagesByPreference(fanartData.tvthumb, preferredLang),
    ...sortFanartImagesByPreference(fanartData.moviethumb, preferredLang),
  ];

  const seen = new Set<string>();
  const results: string[] = [];

  for (const img of orderedRaw) {
    const rawUrl = img.url.trim();
    if (!rawUrl) continue;
    const finalUrl = (proxyFn ? proxyFn(rawUrl) : rawUrl) || rawUrl;
    if (!seen.has(finalUrl)) {
      seen.add(finalUrl);
      results.push(finalUrl);
    }
  }

  return results;
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
            data.movielogo ||
            data.tvthumb ||
            data.moviethumb)
        ) {
          return data;
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
