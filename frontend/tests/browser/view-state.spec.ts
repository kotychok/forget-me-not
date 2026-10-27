import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
const node = (text: string, children: ReturnType<typeof leaf>[] = []) => ({
  ...leaf(text),
  children,
});
const leaf = (text: string) => ({
  id: randomUUID(),
  kind: 'item',
  text,
  completed: false,
  children: [],
});
async function seed(request: APIRequestContext) {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Remember outline' } })
  ).json();
  const a = node('Branch A', [leaf('Find child A')]);
  const b = node('Branch B', [leaf('Child B')]);
  expect(
    (
      await request.put(`/api/lists/${list.id}`, {
        data: {
          baseRevision: 0,
          document: { id: list.id, title: list.title, nodes: [a, b] },
        },
      })
    ).ok(),
  ).toBeTruthy();
  return { list, a, b };
}

test('manual collapse persists across reload and independent devices, while search expansion stays temporary', async ({
  page,
  browser,
  request,
}) => {
  const { list, a, b } = await seed(request);
  const view = async () =>
    (await request.get(`/api/lists/${list.id}/view`)).json();
  await page.goto(`/?list=${list.id}`);
  await page
    .getByRole('button', { name: 'Collapse Branch A', exact: true })
    .click();
  await expect
    .poll(async () => (await view()).collapsedItemIds)
    .toEqual([a.id]);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Expand Branch A', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Find child A', exact: true }),
  ).toHaveCount(0);
  const second = await browser.newPage({ baseURL: 'http://127.0.0.1:5174' });
  try {
    await second.goto(`/?list=${list.id}`);
    await second
      .getByRole('button', { name: 'Expand Branch A', exact: true })
      .click();
    await expect.poll(async () => (await view()).collapsedItemIds).toEqual([]);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(
      page.getByRole('button', { name: 'Collapse Branch A', exact: true }),
    ).toBeVisible();
    await Promise.all([
      page
        .getByRole('button', { name: 'Collapse Branch A', exact: true })
        .click(),
      second
        .getByRole('button', { name: 'Collapse Branch B', exact: true })
        .click(),
    ]);
    await expect
      .poll(async () => [...(await view()).collapsedItemIds].sort())
      .toEqual([a.id, b.id].sort());
    expect(
      (await (await request.get(`/api/lists/${list.id}`)).json()).revision,
    ).toBe(1);
    await page
      .getByRole('button', { name: 'Search lists', exact: true })
      .click();
    const dialog = page.getByRole('dialog', { name: 'Search lists' });
    await dialog.getByRole('textbox').fill('Find child A');
    await dialog.getByRole('button', { name: /Find child A/ }).click();
    await expect(
      page.getByRole('button', { name: 'Find child A', exact: true }),
    ).toBeFocused();
    expect((await view()).collapsedItemIds).toContain(a.id);
    await page.reload();
    await expect(
      page.getByRole('button', { name: 'Expand Branch A', exact: true }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 954 });
    await page.screenshot({
      path: test.info().outputPath('outline-state-mobile.png'),
    });
  } finally {
    await second.close();
  }
});

test('view read/write failures remain non-blocking and remote collapse does not hide a focused editor', async ({
  page,
  request,
}) => {
  const { list, a } = await seed(request);
  await page.route('**/api/lists/*/view', (route) => route.abort());
  await page.goto(`/?list=${list.id}`);
  const status = page.getByRole('status', {
    name: 'Outline preferences',
    exact: true,
  });
  await expect(status).toContainText('not synced');
  await page
    .getByRole('button', { name: 'Collapse Branch B', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Expand Branch B', exact: true }),
  ).toBeVisible();
  await page.unroute('**/api/lists/*/view');
  await page
    .getByRole('button', { name: 'Retry view sync', exact: true })
    .click();
  await expect(status).toHaveText('Outline preferences saved');
  await page.getByRole('button', { name: 'Find child A', exact: true }).click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await expect(text).toBeFocused();
  const current = await (
    await request.get(`/api/lists/${list.id}/view`)
  ).json();
  await request.patch(`/api/lists/${list.id}/view`, {
    data: {
      baseRevision: current.revision,
      changes: [{ itemId: a.id, collapsed: true }],
    },
  });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(text).toBeFocused();
  await expect(text).toHaveValue('Find child A');
  await page.route('**/api/lists/*/view', (route) =>
    route.request().method() === 'PATCH' ? route.abort() : route.continue(),
  );
  await page
    .getByRole('button', { name: 'Expand Branch B', exact: true })
    .click();
  await expect(status).toContainText('not synced');
  await page.unroute('**/api/lists/*/view');
  await page
    .getByRole('button', { name: 'Retry view sync', exact: true })
    .click();
  await expect(status).toHaveText('Outline preferences saved');
});
