import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdown } from '../src/lib/markdown.ts';
import type { MarkdownNode } from '../src/lib/markdown.ts';
import { safeHttpUrl } from '../src/lib/links.ts';
function flattened(nodes: MarkdownNode[]): MarkdownNode[] {
  return nodes.flatMap((node) => [node, ...flattened(node.children ?? [])]);
}

test('allowlisted Markdown supports emphasis, code, headings, lists, quotes and labelled links', () => {
  const source =
    '# Heading\n\n**bold** *em* ~~gone~~ `&amp;` &amp;\n\n> quote\n\n1. One\n2. Two\n\n- [x] Done\n\n```js\nconst x = "<html>";\n```\n\n[**site**](https://example.org/path?a=1&amp;b=2)';
  const result = markdown(source);
  const nodes = flattened(result.nodes);
  for (const kind of [
    'heading',
    'strong',
    'em',
    'del',
    'code',
    'codeblock',
    'quote',
    'list',
    'listitem',
  ])
    assert.ok(
      nodes.some((node) => node.kind === kind),
      kind,
    );
  assert.ok(nodes.some((node) => node.text === '&amp;')); // Code is literal.
  assert.ok(nodes.some((node) => node.text?.includes(' &')));
  assert.deepEqual(result.links, [
    { href: 'https://example.org/path?a=1&b=2', label: 'site' },
  ]);
  assert.equal(result.fallback, false);
});

test('HTML stays literal, image destinations are ignored and unsafe links never become targets', () => {
  const source =
    '<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1)) [encoded](jav&#x61;script:alert(1)) [data](data:text/html,test) [relative](/api/lists) ![alt](https://tracker.example/image.png) [safe](https://example.org)';
  const result = markdown(source);
  const nodes = flattened(result.nodes);
  assert.deepEqual(result.links, [
    { href: 'https://example.org', label: 'safe' },
  ]);
  assert.ok(
    nodes.some((node) => node.kind === 'source' && node.text?.includes('<img')),
  );
  assert.ok(nodes.some((node) => node.text === '[image: alt]'));
  for (const target of [
    'javascript:alert(1)',
    'data:text/html,test',
    '//example.org',
    '/relative',
    'https://user:pass@example.org',
    'https:\\example.org',
    'https://example.org/\nnext',
  ])
    assert.equal(safeHttpUrl(target), null);
});

test('entities, escapes, bare URLs and code links keep their intended text/target boundaries', () => {
  const result = markdown(
    '\\# Literal &copy; &#x3c;img&#x3e;\n\nhttps://example.org/?a=1&amp;b=2\n\n`https://code.example/`\n\n<https://angle.example/>',
  );
  assert.ok(
    flattened(result.nodes).some((node) =>
      node.text?.includes('Literal © <img>'),
    ),
  );
  assert.ok(
    result.links.some(
      (link) => link.href === 'https://example.org/?a=1&amp;b=2',
    ),
  );
  assert.ok(
    result.links.some((link) => link.href === 'https://angle.example/'),
  );
  assert.ok(result.links.every((link) => !link.href.includes('code.example')));
});

test('complex input falls back to full source and rendering does not mutate or truncate it', () => {
  const source = Array.from({ length: 2100 }, () => '**x**').join(' ');
  const result = markdown(source);
  assert.equal(result.fallback, true);
  assert.equal(result.nodes.map((node) => node.text).join(''), source);
  assert.ok(markdown(source) === result); // Bounded cache reuses the immutable display model.
});
