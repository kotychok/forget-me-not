import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test('remote changes refresh navigation, reset undo and wait for an open note draft', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Remote refresh' } })
  ).json();
  const item = {
    id: randomUUID(),
    kind: 'item',
    text: 'Original remote item',
    completed: false,
    children: [],
  };
  async function update(text: string) {
    const server = await (await request.get(`/api/lists/${list.id}`)).json();
    expect(
      (
        await request.put(`/api/lists/${list.id}`, {
          data: {
            baseRevision: server.revision,
            document: {
              id: list.id,
              title: list.title,
              nodes: [{ ...item, text }],
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
  }
  await update(item.text);
  await page.goto(`/?list=${list.id}`);
  await page.getByRole('button', { name: item.text, exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Item text', exact: true });
  await input.fill('Saved on this device');
  await input.press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled();
  await update('Updated on phone');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('button', { name: 'Updated on phone', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Updated on phone', exact: true })
    .focus();
  await page.keyboard.press('n');
  const note = page.getByRole('dialog', { name: 'Item note' });
  await expect(note).toBeVisible();
  await note.getByRole('textbox').fill('Unapplied note draft');
  await update('Another phone update');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByText(/This list changed on another device/),
  ).toBeVisible();
  await expect(note.getByRole('textbox')).toHaveValue('Unapplied note draft');
  await note.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(
    page.getByRole('button', { name: 'Another phone update', exact: true }),
  ).toBeVisible();
});

test('mobile list chooser uses a vertical dialog and closes after selecting a list', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const lists = [];
  for (let i = 0; i < 18; i++)
    lists.push(
      await (
        await request.post('/api/lists', {
          data: { title: `Mobile choice ${i}` },
        })
      ).json(),
    );
  await page.goto(`/?list=${lists[0].id}`);
  await page.locator('.mobile-list-picker').click();
  const dialog = page.getByRole('dialog', { name: 'Choose a list' });
  await expect(dialog).toBeVisible();
  const nav = dialog.getByRole('navigation');
  await page.screenshot({
    path: test.info().outputPath('mobile-list-picker.png'),
  });
  expect(
    await nav.evaluate(
      (el) =>
        el.scrollHeight > el.clientHeight &&
        el.scrollWidth <= el.clientWidth + 1,
    ),
  ).toBe(true);
  await dialog.getByRole('button', { name: /Mobile choice 17/ }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.mobile-list-picker')).toContainText(
    'Mobile choice 17',
  );
  await expect(page.getByRole('button', { name: 'Rename list' })).toContainText(
    'Mobile choice 17',
  );
  await page.locator('.mobile-list-picker').click();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});
