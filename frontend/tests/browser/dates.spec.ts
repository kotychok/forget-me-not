import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

async function seed(request: import('@playwright/test').APIRequestContext) {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Date tests' } })
  ).json();
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
                id: randomUUID(),
                kind: 'task',
                text: 'Calendar task',
                completed: false,
                children: [],
              },
            ],
          },
        },
      })
    ).ok(),
  ).toBeTruthy();
  return list.id as string;
}
const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

test('date Apply/Cancel, clear, history, local status rollover, JSON and search preserve a date-only deadline', async ({
  page,
  request,
}) => {
  const id = await seed(request);
  await page.clock.setFixedTime(new Date('2026-10-28T12:00:00Z'));
  await page.goto(`/?list=${id}`);
  const item = page.locator('.item-text');
  const dialog = page.getByRole('dialog', { name: 'Due date', exact: true });
  const field = dialog.getByLabel('Due date', { exact: true });
  await item.focus();
  await item.press('d');
  await expect(field).toBeFocused();
  await field.fill('2026-10-28');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item).toBeFocused();
  await expect(page.locator('.due-date')).toHaveCount(0);
  await item.press('d');
  await field.fill('2026-10-28');
  await dialog.getByRole('button', { name: 'Apply date', exact: true }).click();
  const badge = page.locator('.due-date');
  await expect(item).toBeFocused();
  await expect(badge).toHaveText('2026-10-28 · Today');
  await item.press(undo);
  await expect(badge).toHaveCount(0);
  await item.press(redo);
  await expect(badge).toHaveText('2026-10-28 · Today');
  await item.press('Space');
  await expect(badge).toHaveText('2026-10-28 · Done');
  await item.press('Space');
  await page.clock.setFixedTime(new Date('2026-10-29T12:00:00Z'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(badge).toHaveText('2026-10-28 · Overdue');
  await badge.click();
  await expect(field).toHaveValue('2026-10-28');
  await dialog.getByRole('button', { name: 'Clear date', exact: true }).click();
  await dialog.getByRole('button', { name: 'Apply date', exact: true }).click();
  await expect(badge).toHaveCount(0);
  await item.press(undo);
  await expect(badge).toBeVisible();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].dueDate,
  ).toBe('2026-10-28');
  await page.reload();
  await expect(badge).toHaveText('2026-10-28 · Overdue');
  await page.getByRole('button', { name: 'Search lists', exact: true }).click();
  const search = page.getByRole('dialog', {
    name: 'Search lists',
    exact: true,
  });
  await search.getByRole('textbox').fill('2026-10-28');
  await search.getByRole('button', { name: /Due date/ }).click();
  await expect(item).toBeFocused();
  await page
    .getByRole('button', { name: 'Import / export', exact: false })
    .click();
  const transfer = page.getByRole('dialog', {
    name: 'Import / export',
    exact: true,
  });
  const downloadReady = page.waitForEvent('download');
  await transfer
    .getByRole('button', { name: 'Export current list', exact: true })
    .click();
  const downloaded = JSON.parse(
    await readFile((await (await downloadReady).path())!, 'utf8'),
  );
  expect(downloaded.schemaVersion).toBe(4);
  expect(downloaded.lists[0].nodes[0].dueDate).toBe('2026-10-28');
  await transfer
    .getByRole('button', { name: 'Close import and export' })
    .click();
  await page.setViewportSize({ width: 390, height: 954 });
  await badge.click();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('date-mobile.png') });
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
});

test('unacknowledged date survives recovery and different browser timezones do not shift stored source', async ({
  page,
  request,
  browser,
}) => {
  const id = await seed(request);
  await page.goto(`/?list=${id}`);
  await page.route('**/api/lists/*', (route) =>
    route.request().method() === 'PUT' ? route.abort() : route.continue(),
  );
  await page.locator('.item-text').focus();
  await page.keyboard.press('d');
  const dialog = page.getByRole('dialog', { name: 'Due date', exact: true });
  await dialog.getByLabel('Due date', { exact: true }).fill('2028-02-29');
  await dialog.getByRole('button', { name: 'Apply date', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Save failed',
  );
  await expect(
    page.getByText('Local draft saved in this browser.', { exact: true }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page
    .getByRole('button', { name: 'Recover drafts (1)', exact: true })
    .click();
  const recovery = page.getByRole('dialog', { name: 'Recover local drafts' });
  await recovery
    .getByRole('button', { name: 'Recover as new list', exact: true })
    .click();
  await expect(recovery.getByRole('status')).toHaveText(
    'Draft recovered as a new list.',
  );
  await recovery
    .getByRole('button', { name: 'Close draft recovery', exact: true })
    .click();
  const copy = new URL(page.url()).searchParams.get('list')!;
  expect(copy).not.toBe(id);
  expect(
    (await (await request.get(`/api/lists/${id}`)).json()).nodes[0].dueDate,
  ).toBeUndefined();
  for (const timezoneId of ['Pacific/Kiritimati', 'Pacific/Honolulu']) {
    const context = await browser.newContext({ timezoneId });
    try {
      const other = await context.newPage();
      await other.goto(`http://127.0.0.1:5174/?list=${copy}`);
      await other.locator('.due-date').click();
      await expect(
        other
          .getByRole('dialog', { name: 'Due date', exact: true })
          .getByLabel('Due date', { exact: true }),
      ).toHaveValue('2028-02-29');
    } finally {
      await context.close();
    }
  }
});
