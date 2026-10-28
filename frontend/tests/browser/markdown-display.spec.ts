import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const source =
  '**Bold** and _italic_\n[Read more](https://example.org/docs)\n`code`\n<img src="https://example.org/evil" onerror="alert(1)">\n![remote](https://example.org/image)\n[unsafe](javascript:alert)';

test('Markdown is safe presentation; source, history and note drafts stay intact', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Markdown' } })
  ).json();
  await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: {
        id: list.id,
        title: list.title,
        nodes: [
          {
            id: randomUUID(),
            kind: 'item',
            text: source,
            completed: false,
            children: [],
          },
        ],
      },
    },
  });
  const remote: string[] = [];
  page.on('request', (req) => {
    if (req.url().startsWith('https://example.org')) remote.push(req.url());
  });
  await page.goto(`/?list=${list.id}`);
  const item = page.locator('.item-text');
  await expect(item.locator('strong')).toHaveText('Bold');
  await expect(item.locator('em')).toHaveText('italic');
  await expect(item.locator('code')).toHaveText('code');
  await expect(item).toContainText('<img src=');
  await expect(item).toContainText('[image: remote]');
  await expect(item.locator('a, img, script')).toHaveCount(0);
  await expect(page.locator('.item-links a')).toHaveCount(1);
  await expect(page.locator('.item-links a')).toContainText('Read more');
  await page.getByRole('checkbox', { name: 'Markdown preview' }).uncheck();
  await expect(item.locator('strong')).toHaveCount(0);
  await expect(item).toContainText('**Bold**');
  await page.getByRole('checkbox', { name: 'Markdown preview' }).check();
  await item.click();
  const editor = page.getByRole('textbox', { name: 'Item text', exact: true });
  await expect(editor).toHaveValue(source);
  await editor.fill('Changed');
  await editor.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect(editor).toHaveValue(source);
  await editor.press('Escape');
  await expect(item).toBeFocused();
  await item.press('n');
  const dialog = page.getByRole('dialog', { name: 'Item note', exact: true });
  await dialog
    .getByRole('textbox', { name: 'Note text' })
    .fill('**Note** [link](https://example.org/note)');
  await dialog
    .getByRole('button', { name: 'Preview note', exact: true })
    .click();
  await expect(dialog.locator('.note-preview strong')).toHaveText('Note');
  await expect(dialog.locator('.note-preview a')).toHaveAttribute(
    'href',
    'https://example.org/note',
  );
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(item).toBeFocused();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  const saved = await (await request.get(`/api/lists/${list.id}`)).json();
  expect(saved.nodes[0].text).toBe(source);
  expect(saved.nodes[0].note).toBeUndefined();
  await page.reload();
  await expect(item.locator('strong')).toHaveText('Bold');
  await page.setViewportSize({ width: 390, height: 954 });
  await page.screenshot({
    path: test.info().outputPath('markdown-mobile.png'),
  });
  expect(remote).toEqual([]);
});
