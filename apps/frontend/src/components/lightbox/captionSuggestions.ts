import { fuzzyMatch } from "../../util/util";

export type HashtagAtCaret = Readonly<{ start: number; end: number; query: string }>;

const HASHTAG_BEFORE_CARET = /(?:^|\s)#(\w*)$/;
const WORD_AFTER_CARET = /^\w*/;
const MAX_MATCHES = 5;

export function hashtagAtCaret(text: string, caret: number): HashtagAtCaret | null {
  const query = HASHTAG_BEFORE_CARET.exec(text.slice(0, caret))?.[1];
  if (query === undefined) return null;
  const rest = WORD_AFTER_CARET.exec(text.slice(caret))?.[0] ?? "";
  return { start: caret - query.length - 1, end: caret + rest.length, query };
}

export function hashtagSuggestions(hashtags: readonly string[], query: string): string[] {
  const words = [...new Set(hashtags.map(title => title.replace(/^#+/, "")).filter(Boolean))];
  const matches = words.filter(word => fuzzyMatch(query, word)).slice(0, MAX_MATCHES);
  if (query && !matches.includes(query)) {
    matches.push(query);
  }
  return matches.reverse();
}

export function insertHashtag(
  text: string,
  at: HashtagAtCaret,
  hashtag: string
): Readonly<{ text: string; caret: number }> {
  const inserted = `#${hashtag} `;
  const rest = text.slice(at.end);
  return {
    text: text.slice(0, at.start) + inserted + (rest.startsWith(" ") ? rest.slice(1) : rest),
    caret: at.start + inserted.length,
  };
}
