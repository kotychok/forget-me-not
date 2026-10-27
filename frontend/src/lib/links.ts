export type TextPart = { text: string; href?: string };

// Conservative plain-text detection, independent of Markdown and the DOM.
export function textLinks(text: string): TextPart[] {
  const parts: TextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(/\bhttps?:\/\/[^\s<>"'`]+/gi)) {
    let candidate = match[0].replace(/[.,!?;:]+$/, '');
    for (const [open, close] of [
      ['(', ')'],
      ['[', ']'],
      ['{', '}'],
    ]) {
      while (
        candidate.endsWith(close) &&
        candidate.split(close).length > candidate.split(open).length
      )
        candidate = candidate.slice(0, -1);
    }
    try {
      const url = new URL(candidate);
      if (!url.hostname || url.username || url.password) continue;
    } catch {
      continue;
    }
    if (match.index > offset)
      parts.push({ text: text.slice(offset, match.index) });
    parts.push({ text: candidate, href: candidate });
    offset = match.index + candidate.length;
  }
  if (offset < text.length) parts.push({ text: text.slice(offset) });
  return parts;
}

export function compactUrl(url: string) {
  return url.length > 72 ? `${url.slice(0, 56)}…${url.slice(-12)}` : url;
}
