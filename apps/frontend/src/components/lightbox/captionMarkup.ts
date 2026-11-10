/** A caption's hashtags: `#` and a word, as the editor turns them into mentions. */
const HASHTAG = /#(\w+)/g;

/** Captions are saved as plain text; the editor shows their hashtags as mentions. */
export function captionToEditorHtml(caption: string): string {
  return caption.replace(HASHTAG, '<span data-type="mention" data-id=$1>#$1</span>');
}

/** A run of a caption: plain text or one hashtag, and where it starts (a key that stays put). */
export type CaptionPart = Readonly<{ text: string; hashtag: boolean; start: number }>;

/**
 * A caption as the editor shows it read-only: the editor parses it as HTML, so line breaks and
 * runs of spaces become one space and the caption is one paragraph, with `#word` as a hashtag.
 */
export function captionParts(caption: string): CaptionPart[] {
  const text = caption.replace(/\s+/g, " ").trim();
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
