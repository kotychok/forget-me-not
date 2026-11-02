import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('an item link reveals a collapsed branch once and removes the consumed URL parameter', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Linked Inbox' } })
  ).json();
  const item = {
    id: randomUUID(),
    kind: 'item',
    text: 'Linked child',
    completed: false,
    children: [],
  };
  const parent = {
    ...item,
    id: randomUUID(),
    text: 'Linked parent',
    children: [item],
  };
  await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: { id: list.id, title: list.title, nodes: [parent] },
    },
  });
  await request.patch(`/api/lists/${list.id}/view`, {
    data: {
      baseRevision: 0,
      changes: [{ itemId: parent.id, collapsed: true }],
    },
  });
  await page.goto(`/?list=${list.id}&item=${item.id}`);
  const target = page.getByRole('button', {
    name: 'Linked child',
    exact: true,
  });
  await expect(target).toBeVisible();
  await expect(target).toBeFocused();
  expect(new URL(page.url()).searchParams.has('item')).toBe(false);
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Expand Linked parent', exact: true }),
  ).toBeVisible();
  await expect(target).toHaveCount(0);
});
