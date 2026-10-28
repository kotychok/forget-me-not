import { test, expect } from '@playwright/test';
import type { APIRequestContext } from '@playwright/test';
import type { Item } from '../../src/lib/editor';
import { randomUUID } from 'node:crypto';

async function seed(request: APIRequestContext, title: string, nodes: Item[]) {
  const list = await (
    await request.post('/api/lists', { data: { title } })
  ).json();
  expect(
    (
      await request.put(`/api/lists/${list.id}`, {
        data: { baseRevision: 0, document: { id: list.id, title, nodes } },
      })
    ).ok(),
  ).toBeTruthy();
  return list;
}
const node = (text: string, children: Item[] = []): Item => ({
  id: randomUUID(),
  kind: 'item',
  text,
  completed: false,
  children,
});

test('cross-list search reveals collapsed descendants, retains query and local history', async ({
  page,
  request,
}) => {
  const needle = `Голка-${randomUUID()}`;
  const child = node(`${needle} <b>literal</b>`);
  const parent = node('Parent context', [child]);
  const target = await seed(request, 'Search destination', [parent]);
  const first = await seed(request, 'Search source', [node('Original source')]);
  await page.goto(`/?list=${target.id}`);
  await page
    .getByRole('button', { name: `Collapse ${parent.text}`, exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Search source', exact: false })
    .first()
    .click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await page
    .getByRole('button', { name: 'Original source', exact: true })
    .click();
  await page.route('**/api/lists/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await text.fill(`Local ${needle}`);
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search lists' });
  const query = dialog.getByRole('textbox', {
    name: 'Search titles, items, notes and tags',
  });
  await query.fill(needle.toLowerCase());
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('2 results');
  await expect(
    dialog.getByRole('button', { name: /Parent context/ }),
  ).toContainText('<b>literal</b>');
  await page.screenshot({ path: test.info().outputPath('search-desktop.png') });
  await page.setViewportSize({ width: 390, height: 954 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('search-mobile.png') });
  await query.press('ArrowDown');
  const hit = dialog.getByRole('button', { name: /Parent context/ });
  await expect(hit).toBeFocused();
  await hit.press('Enter');
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(target.id));
  const selected = page.locator('.row.active .item-text');
  await expect(selected).toBeFocused();
  await expect(selected).toContainText(needle);
  await expect(selected.locator('mark')).toHaveText(needle);
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  await expect(query).toHaveValue(needle.toLowerCase());
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('2 results');
  await dialog.getByRole('button', { name: /Local / }).click();
  await expect(page).toHaveURL(new RegExp(first.id));
  await expect(page.locator('.row.active .item-text')).toContainText(
    `Local ${needle}`,
  );
  const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
  await page.locator('.row.active .item-text').press(undo);
  await expect(text).toHaveValue('Original source');
});

test('search handles title-only matches, failures, empty results and stale removed items', async ({
  page,
  request,
}) => {
  const title = `Title-${randomUUID()}`;
  const child = node(`Unique-${randomUUID()}`);
  const list = await seed(request, title, [child]);
  const other = await seed(request, 'Keep selected', []);
  await page.goto(`/?list=${other.id}`);
  await page.route('**/api/export', (route) => route.abort());
  const trigger = page.getByRole('button', {
    name: 'Search lists',
    exact: true,
  });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search lists' });
  await expect(dialog.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/export');
  await dialog.getByRole('button', { name: 'Refresh search' }).click();
  const query = dialog.getByRole('textbox', {
    name: 'Search titles, items, notes and tags',
  });
  await query.fill('No-match-' + randomUUID());
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('0 results');
  await query.fill(title);
  await dialog.getByRole('button', { name: /List title/ }).click();
  await expect(page.getByRole('button', { name: 'Rename list' })).toBeFocused();
  await trigger.click();
  await query.fill(child.text);
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('1 results');
  // A cached local version intentionally remains authoritative; use an unopened copy for the stale case.
  const stale = await seed(request, 'Stale destination', [node(child.text)]);
  await dialog.getByRole('button', { name: 'Refresh search' }).click();
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('2 results');
  const current = await (await request.get(`/api/lists/${stale.id}`)).json();
  await request.put(`/api/lists/${stale.id}`, {
    data: {
      baseRevision: current.revision,
      document: { id: stale.id, title: current.title, nodes: [] },
    },
  });
  await dialog.getByRole('button', { name: /Stale destination/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('removed');
  await expect(page).toHaveURL(new RegExp(list.id));
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('search reveal is consumed once; switching lists preserves later focus and Clear search resets context', async ({
  page,
  request,
}) => {
  const term = `Needle-${randomUUID()}`;
  const match = node(term);
  const parent = node('Search parent', [match]);
  const other = node('Later focus');
  const first = await seed(request, 'Jump source', [parent, other]);
  const second = await seed(request, 'Jump alternate', [node('Alternate')]);
  await page.goto(`/?list=${first.id}`);
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Search lists' });
  await dialog.getByRole('textbox').fill(term);
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('1 results');
  await dialog.getByRole('button', { name: /Search parent/ }).click();
  await expect(page.locator('.row.active .item-text')).toHaveText(term);
  await expect(page.getByLabel('Search context')).toContainText(term);
  await page.getByRole('button', { name: 'Later focus', exact: true }).focus();
  await page
    .getByRole('button', { name: 'Collapse Search parent', exact: true })
    .click();
  await page.locator(`[data-list-id="${second.id}"]`).click();
  await page.locator(`[data-list-id="${first.id}"]`).click();
  await expect(page.locator('.row.active .item-text')).toHaveText(
    'Later focus',
  );
  await expect(
    page.getByRole('button', { name: term, exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Expand Search parent', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Clear search', exact: true }).click();
  await expect(page.getByLabel('Search context')).toHaveCount(0);
  await expect(page.locator('.row.search-match')).toHaveCount(0);
  await expect(page.locator('.row.active .item-text')).toBeFocused();
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
  await dialog.getByRole('textbox').fill(term);
  await expect(
    dialog.getByRole('status', { name: 'Search status' }),
  ).toHaveText('1 results');
  await dialog.getByRole('button', { name: /Search parent/ }).click();
  await expect(page.locator('.row.active .item-text')).toHaveText(term);
  await expect(page.locator('.row.active .item-text')).toBeFocused();
});
