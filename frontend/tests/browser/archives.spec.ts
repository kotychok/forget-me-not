import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('archive is read-only, searchable explicitly, portable and restorable on desktop and mobile', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', {
      data: { title: 'Archive synthetic reference' },
    })
  ).json();
  const nodes = [
    {
      id: randomUUID(),
      kind: 'task',
      text: 'Unique archive needle',
      note: 'Literal archived note',
      completed: false,
      children: [],
    },
  ];
  await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: { id: list.id, title: list.title, nodes },
    },
  });
  await page.goto(`/?list=${list.id}`);
  await page.getByRole('button', { name: 'Archive list', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Restore list', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Archived · Read only' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add item', exact: false }),
  ).not.toBeVisible();
  await expect(
    page.getByRole('checkbox', { name: 'Complete Unique archive needle' }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Unique archive needle', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Unique archive needle', exact: true })
    .press('Delete');
  await page
    .getByRole('button', { name: 'Unique archive needle', exact: true })
    .press('Enter');
  await expect(
    page.getByRole('textbox', { name: 'Item text', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Literal archived note', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Restore list', exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', { name: 'Search lists' });
  await search.getByRole('textbox').fill('Unique archive needle');
  await expect(
    search.getByRole('status', { name: 'Search status' }),
  ).toContainText('0 results');
  await search.getByRole('checkbox', { name: 'Include archived' }).check();
  await expect(
    search.getByRole('status', { name: 'Search status' }),
  ).toContainText('1 results');
  await expect(search.locator('.search-result')).toContainText('Archived');
  await search.locator('.search-result').click();
  await expect(
    page.getByRole('button', { name: 'Restore list', exact: true }),
  ).toBeVisible();
  const saved = await (await request.get(`/api/lists/${list.id}`)).json();
  expect(saved.archived).toBe(true);
  expect(saved.revision).toBe(2);
  expect(saved.nodes).toEqual(nodes);
  const exported = await (await request.get('/api/export')).json();
  expect(exported.schemaVersion).toBe(5);
  expect(
    exported.lists.find((doc: { id: string }) => doc.id === list.id).archived,
  ).toBe(true);
  expect(
    (
      await request.put(`/api/lists/${list.id}`, {
        data: {
          baseRevision: 2,
          document: { id: list.id, title: 'Must not change', nodes },
        },
      })
    ).status(),
  ).toBe(409);
  await page
    .locator('.read-only > .search-context-bar')
    .getByRole('button', { name: 'Clear search', exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Restore list', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Archive list', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add item', exact: false }),
  ).toBeVisible();
  expect(
    (await (await request.get(`/api/lists/${list.id}`)).json()).archived,
  ).toBe(false);
});
