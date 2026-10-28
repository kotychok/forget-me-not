import { Lexer } from 'marked';
import type { MarkedToken } from 'marked';
import { decodeHTMLStrict } from 'entities';
import { textLinks, safeHttpUrl } from './links.ts';

export type MarkdownNode = {
  kind:
    | 'text'
    | 'source'
    | 'strong'
    | 'em'
    | 'del'
    | 'code'
    | 'codeblock'
    | 'break'
    | 'paragraph'
    | 'heading'
    | 'quote'
    | 'list'
    | 'listitem'
    | 'link'
    | 'rule';
  text?: string;
  children?: MarkdownNode[];
  href?: string;
  compact?: boolean;
  level?: number;
  marker?: string;
};
export type MarkdownLink = { href: string; label: string };
export type MarkdownDocument = {
  nodes: MarkdownNode[];
  links: MarkdownLink[];
  fallback: boolean;
};
const cache = new Map<string, MarkdownDocument>();
let cachedCharacters = 0;
const MAX_CACHE_CHARACTERS = 256 * 1024;
const MAX_NODES = 2000;
const MAX_DEPTH = 24;

function plain(source: string, fallback = false): MarkdownDocument {
  return {
    nodes: textLinks(source).map((part) =>
      part.href
        ? { kind: 'link', text: part.text, href: part.href, compact: true }
        : { kind: 'text', text: part.text },
    ),
    links: [
      ...new Set(
        textLinks(source).flatMap((part) => (part.href ? [part.href] : [])),
      ),
    ].map((href) => ({ href, label: new URL(href).hostname })),
    fallback,
  };
}
function label(nodes: MarkdownNode[]): string {
  return nodes.map((node) => node.text ?? label(node.children ?? [])).join('');
}
/** A bounded allowlisted token model. It never generates or accepts an HTML string. */
export function markdown(source: string): MarkdownDocument {
  // Plain outliner items do not need a Markdown lexer or cache entry.
  if (
    !/[*_`\[\]~&<>\\\n]|^(?: {4}|\t)|^ {0,3}(?:#{1,6}\s|>\s|[-+]\s|\d+[.)]\s|---+$)/m.test(
      source,
    )
  )
    return plain(source);
  const cached = cache.get(source);
  if (cached) {
    cache.delete(source);
    cache.set(source, cached);
    return cached;
  }
  let budget = MAX_NODES;
  const links = new Map<string, MarkdownLink>();
  function convert(tokens: MarkedToken[], depth = 0): MarkdownNode[] {
    if (depth > MAX_DEPTH) throw new Error('Markdown nesting limit');
    return tokens.flatMap((token): MarkdownNode[] => {
      if (--budget < 0) throw new Error('Markdown display limit');
      const children = () =>
        convert(
          'tokens' in token ? ((token.tokens ?? []) as MarkedToken[]) : [],
          depth + 1,
        );
      switch (token.type) {
        case 'space':
        case 'def':
          return [];
        case 'text':
          return token.tokens
            ? children()
            : [{ kind: 'text', text: decodeHTMLStrict(token.text) }];
        case 'escape':
          return [{ kind: 'text', text: token.text }];
        case 'html':
          return [{ kind: 'source', text: token.raw }];
        case 'strong':
        case 'em':
        case 'del':
          return [{ kind: token.type, children: children() }];
        case 'codespan':
          return [{ kind: 'code', text: token.text }];
        case 'code':
          return [{ kind: 'codeblock', text: token.text }];
        case 'br':
          return [{ kind: 'break' }];
        case 'paragraph':
          return [{ kind: 'paragraph', children: children() }];
        case 'heading':
          return [
            {
              kind: 'heading',
              level: Math.min(6, Math.max(1, token.depth)),
              children: children(),
            },
          ];
        case 'blockquote':
          return [{ kind: 'quote', children: children() }];
        case 'hr':
          return [{ kind: 'rule' }];
        case 'list':
          return [
            {
              kind: 'list',
              children: token.items.map((item, index) => {
                if (--budget < 0) throw new Error('Markdown display limit');
                return {
                  kind: 'listitem',
                  marker: item.task
                    ? ''
                    : token.ordered
                      ? `${Number(token.start) + index}. `
                      : '• ',
                  children: convert(item.tokens as MarkedToken[], depth + 1),
                };
              }),
            },
          ];
        case 'list_item':
          return [{ kind: 'listitem', children: children() }];
        case 'checkbox':
          return [{ kind: 'text', text: token.checked ? '☑ ' : '☐ ' }];
        case 'image':
          return [
            { kind: 'text', text: `[image: ${decodeHTMLStrict(token.text)}]` },
          ];
        case 'link': {
          const href = safeHttpUrl(
            token.autolink ? token.href : decodeHTMLStrict(token.href),
          );
          const content: MarkdownNode[] = token.autolink
            ? [{ kind: 'text', text: token.text }]
            : children();
          const text = label(content);
          if (href && !links.has(href))
            links.set(href, {
              href,
              label: token.autolink
                ? new URL(href).hostname
                : text || new URL(href).hostname,
            });
          return [
            {
              kind: 'link',
              href: href ?? undefined,
              children: content,
              text: token.autolink ? token.text : undefined,
              compact: !!token.autolink,
            },
          ];
        }
        // Tables and unsupported syntax stay escaped literal source.
        default:
          return [{ kind: 'source', text: token.raw }];
      }
    });
  }
  let result: MarkdownDocument;
  try {
    result = {
      nodes: convert(
        Lexer.lex(source, { gfm: true, breaks: true }) as MarkedToken[],
      ),
      links: [...links.values()],
      fallback: false,
    };
  } catch {
    result = plain(source, true);
  }
  cache.set(source, result);
  cachedCharacters += source.length;
  while (cache.size > 128 || cachedCharacters > MAX_CACHE_CHARACTERS) {
    const first = cache.keys().next().value!;
    cache.delete(first);
    cachedCharacters -= first.length;
  }
  return result;
}
