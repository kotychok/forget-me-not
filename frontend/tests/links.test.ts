import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textLinks, compactUrl } from '../src/lib/links.ts';

test('plain-text links preserve source, punctuation, and balanced URL parentheses', () => {
  const text =
    'See (https://example.org/a_(b)), then https://example.net/path?q=1&x=2. Done';
  const parts = textLinks(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => part.href),
    ['https://example.org/a_(b)', 'https://example.net/path?q=1&x=2'],
  );
});

test('only valid HTTP(S) URLs without embedded credentials become links', () => {
  const text =
    'javascript:alert(1) data:text/html,test ftp://example.org https:// https://user:secret@example.org <script>test</script> HTTPS://example.org';
  const parts = textLinks(text);
  assert.equal(parts.map((part) => part.text).join(''), text);
  assert.deepEqual(
    parts.filter((part) => part.href).map((part) => part.href),
    ['HTTPS://example.org'],
  );
});

test('long URL display is bounded while source and target remain complete', () => {
  const url = `https://example.org/${'long-path/'.repeat(30)}?q=value`;
  assert.ok(compactUrl(url).length <= 72);
  assert.ok(compactUrl(url).includes('…'));
  assert.equal(compactUrl('https://example.org'), 'https://example.org');
  assert.deepEqual(textLinks(url), [{ text: url, href: url }]);
});
