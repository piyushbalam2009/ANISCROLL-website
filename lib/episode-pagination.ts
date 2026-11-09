/**
 * Episode Pagination Logic for AniScroll
 * Generates dynamic 50-episode ranges and helpers for episode navigation.
 */

export interface EpisodeRange {
  index: number;
  start: number;
  end: number;
  label: string;
}

/**
 * Format a number with leading zeros based on maximum episode count length.
 * At minimum pads to 3 digits (e.g. 001, 050). For 1000+, formats up to total digits (e.g. 1151).
 */
export function formatEpisodeNumber(num: number, maxNum: number = 999): string {
  const minDigits = maxNum >= 1000 ? String(maxNum).length : 3;
  return String(num).padStart(minDigits, '0');
}

/**
 * Generates dynamic episode ranges of up to `rangeSize` episodes (default: 50).
 * Examples:
 * - 12 episodes -> [{ index: 0, start: 1, end: 12, label: "001–012" }]
 * - 50 episodes -> [{ index: 0, start: 1, end: 50, label: "001–050" }]
 * - 51 episodes -> [{ index: 0, start: 1, end: 50, label: "001–050" }, { index: 1, start: 51, end: 51, label: "051–051" }]
 * - 120 episodes -> 3 ranges ("001–050", "051–100", "101–120")
 * - 1180 episodes -> 24 ranges ("001–050", "051–100", ..., "1151–1180")
 */
export function generateEpisodeRanges(
  totalEpisodes: number,
  rangeSize: number = 50
): EpisodeRange[] {
  if (!totalEpisodes || totalEpisodes <= 0 || isNaN(totalEpisodes)) {
    return [];
  }

  const numRanges = Math.ceil(totalEpisodes / rangeSize);
  const ranges: EpisodeRange[] = [];

  for (let i = 0; i < numRanges; i++) {
    const start = i * rangeSize + 1;
    const end = Math.min((i + 1) * rangeSize, totalEpisodes);

    const formattedStart = formatEpisodeNumber(start, totalEpisodes);
    const formattedEnd = formatEpisodeNumber(end, totalEpisodes);

    ranges.push({
      index: i,
      start,
      end,
      label: `${formattedStart}–${formattedEnd}`,
    });
  }

  return ranges;
}

/**
 * Finds the range containing a given episode number.
 * If episodeNumber is <= 0 or not found, defaults to the closest or first range.
 */
export function findRangeForEpisode(
  episodeNumber: number | undefined | null,
  ranges: EpisodeRange[]
): EpisodeRange | null {
  if (!ranges || ranges.length === 0) return null;
  if (!episodeNumber || episodeNumber <= 0) return ranges[0];

  const matched = ranges.find(
    (r) => episodeNumber >= r.start && episodeNumber <= r.end
  );

  if (matched) return matched;

  // Fallback: if episode number exceeds total, return last range; otherwise first
  if (episodeNumber > ranges[ranges.length - 1].end) {
    return ranges[ranges.length - 1];
  }

  return ranges[0];
}

/**
 * Slices or filters a list of items having a `number` property to only those in the range.
 */
export function sliceEpisodesForRange<T extends { number: number }>(
  episodes: T[],
  range: EpisodeRange | null
): T[] {
  if (!episodes || episodes.length === 0) return [];
  if (!range) return episodes;

  return episodes.filter(
    (ep) => ep.number >= range.start && ep.number <= range.end
  );
}
