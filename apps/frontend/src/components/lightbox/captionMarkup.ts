const HASHTAG = /#(\w+)/g;

/** A run of a caption: plain text or one hashtag, and where it starts (a key that stays put). */
export type CaptionPart = Readonly<{ text: string; hashtag: boolean; start: number }>;

export function hashtagRuns(text: string): CaptionPart[] {
  const parts: CaptionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(HASHTAG)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), hashtag: false, start: last });
    parts.push({ text: match[0], hashtag: true, start: match.index });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), hashtag: false, start: last });
  return parts;
}

export function captionParts(caption: string): CaptionPart[] {
  return hashtagRuns(caption.replace(/\s+/g, " ").trim());
}
