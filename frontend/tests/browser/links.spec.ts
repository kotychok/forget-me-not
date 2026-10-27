import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const url = `https://example.org/${'long-path/'.repeat(35)}?q=one&next=two`;
const source = `Read this ${url}\nThen write a comment here.\njavascript:alert(1) <b>literal</b>`;
const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';

test('compact links open separately while full source grows, survives resize, history and reload', async ({
  page,
  request,
  context,
}) => {
  const created = await request.post('/api/lists', {
    data: { title: 'Link editing' },
  });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const list = await created.json();
  const id = randomUUID();
  expect(
    (
      await request.put(`/api/lists/${list.id}`, {
        data: {
          baseRevision: 0,
          document: {
            id: list.id,
            title: list.title,
            nodes: [
              {
                id,
                kind: 'item',
                text: source,
                completed: false,
                children: [],
              },
            ],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto(`/?list=${list.id}`);
  const item = page.locator('.item-text');
  await expect(item).toContainText('…');
  await expect(item).toContainText('<b>literal</b>');
  const link = page.getByRole('link', {
    name: `Open ${url} in a new tab`,
    exact: true,
  });
  await expect(link).toHaveAttribute('href', url);
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('.item-links a')).toHaveCount(1);
  await context.route('https://example.org/**', (route) =>
    route.fulfill({ body: 'Test link destination' }),
  );
  const popupReady = context.waitForEvent('page');
  await item.focus();
  await item.press('l');
  await expect(link).toBeFocused();
  await link.press('Escape');
  await expect(item).toBeFocused();
  await item.press('l');
  await link.press('Enter');
  const popup = await popupReady;
  await popup.waitForLoadState();
  expect(popup.url()).toBe(url);
  await popup.close();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveCount(0);
  await item.click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await expect(text).toHaveValue(source);
  const size = () =>
    text.evaluate((el: HTMLTextAreaElement) => ({
      client: el.clientHeight,
      scroll: el.scrollHeight,
      height: el.getBoundingClientRect().height,
    }));
  await expect
    .poll(async () => {
      const s = await size();
      return s.client >= s.scroll;
    })
    .toBe(true);
  const wide = (await size()).height;
  await page.setViewportSize({ width: 390, height: 954 });
  await expect.poll(async () => (await size()).height).toBeGreaterThan(wide);
  await expect
    .poll(async () => {
      const s = await size();
      return s.client >= s.scroll;
    })
    .toBe(true);
  await text.fill('Short');
  await expect.poll(async () => (await size()).height).toBeLessThan(wide);
  await text.press(undo);
  await expect(text).toHaveValue(source);
  await expect(text).toBeFocused();
  await text.press('Tab'); // First root: no-op, retaining full source and focus.
  await expect(text).toBeFocused();
  await text.press('Escape');
  await expect(item).toBeFocused();
  await item.press('F2');
  await expect(text).toHaveValue(source);
  await text.press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  const saved = await (await request.get(`/api/lists/${list.id}`)).json();
  expect(saved.nodes[0].text).toBe(source);
  await page.reload();
  await expect(page.locator('.item-links a')).toHaveAttribute('href', url);
  await item.click();
  await expect(text).toHaveValue(source);
  await text.press('Escape');
  expect(errors).toEqual([]);
});
