import { ParsedSubtitleCue } from '@/types/streaming';

/**
 * Parses timestamp string (e.g., "00:01:23.456", "01:23.456", or "00:01:23,456") to seconds.
 */
export function parseTimestamp(timeStr: string): number | null {
  if (!timeStr) return null;
  const cleaned = timeStr.trim().replace(',', '.');
  const parts = cleaned.split(':');

  if (parts.length === 3) {
    const hours = parseFloat(parts[0]);
    const minutes = parseFloat(parts[1]);
    const seconds = parseFloat(parts[2]);
    if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) return null;
    return hours * 3600 + minutes * 60 + seconds;
  } else if (parts.length === 2) {
    const minutes = parseFloat(parts[0]);
    const seconds = parseFloat(parts[1]);
    if (isNaN(minutes) || isNaN(seconds)) return null;
    return minutes * 60 + seconds;
  }

  return null;
}

/**
 * Clean subtitle text by removing WebVTT tags (<v ...>, <c.color>, <ruby>, <b>, <i>, <u>)
 * while preserving newlines and line breaks.
 */
export function cleanSubtitleText(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/<v[^>]*>/gi, '')
    .replace(/<\/v>/gi, '')
    .replace(/<c[^>]*>/gi, '')
    .replace(/<\/c>/gi, '')
    .replace(/<ruby[^>]*>.*?<\/ruby>/gi, '')
    .replace(/<\/?[a-z0-9_-]+[^>]*>/gi, '')
    .trim();
}

/**
 * Parses WebVTT or SRT text into an array of ParsedSubtitleCue objects.
 */
export function parseSubtitles(content: string): ParsedSubtitleCue[] {
  if (!content || typeof content !== 'string') return [];

  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');
  const cues: ParsedSubtitleCue[] = [];

  let i = 0;
  const len = lines.length;

  // Skip WEBVTT header and metadata comments if present
  while (i < len) {
    const line = lines[i].trim();
    if (line.startsWith('WEBVTT') || line.startsWith('NOTE') || line.startsWith('REGION') || line.startsWith('STYLE')) {
      i++;
      // Skip until blank line
      while (i < len && lines[i].trim() !== '') {
        i++;
      }
    } else if (line === '') {
      i++;
    } else {
      break;
    }
  }

  let currentId: string | undefined = undefined;

  while (i < len) {
    const line = lines[i].trim();

    if (!line) {
      i++;
      currentId = undefined;
      continue;
    }

    // Check if this line is an arrow timestamp line ("00:00.000 --> 00:04.000")
    if (line.includes('-->')) {
      const parts = line.split('-->');
      if (parts.length === 2) {
        const startPart = parts[0].trim();
        // End part might have settings like "00:04.000 line:0% position:50%"
        const endPart = parts[1].trim().split(/\s+/)[0];

        const start = parseTimestamp(startPart);
        const end = parseTimestamp(endPart);

        if (start !== null && end !== null && end > start) {
          // Collect following text lines until an empty line
          i++;
          const textLines: string[] = [];
          while (i < len && lines[i].trim() !== '') {
            textLines.push(lines[i].trim());
            i++;
          }

          const rawText = textLines.join('\n');
          const cleanedText = cleanSubtitleText(rawText);

          if (cleanedText) {
            cues.push({
              id: currentId,
              startTime: start,
              endTime: end,
              text: cleanedText,
            });
          }
          currentId = undefined;
          continue;
        }
      }
      i++;
    } else {
      // Possible cue identifier (e.g. "1" in SRT or cue ID in VTT)
      // Check if the NEXT line has "-->"
      if (i + 1 < len && lines[i + 1].includes('-->')) {
        currentId = line;
        i++;
      } else {
        i++;
      }
    }
  }

  // Sort cues by startTime ascending
  cues.sort((a, b) => a.startTime - b.startTime);
  return cues;
}
