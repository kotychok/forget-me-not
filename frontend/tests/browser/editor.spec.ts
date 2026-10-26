import { test, expect } from '@playwright/test';

const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
});

test('Enter, line breaks, indent/outdent, and history preserve focus and branch identity', async ({
  page,
}) => {
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await text.fill('Parent');
  await text.press('Enter');
  await expect(text).toHaveValue('');
  await text.fill('Child');
  const id = await text.getAttribute('data-item');
  await text.press('Tab');
  await expect(text).toBeFocused();
  await expect(text).toHaveAttribute('data-item', id!);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  await text.press('Shift+Tab');
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  await text.press(undo);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  await expect(text).toBeFocused();
  await text.press(redo);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  await text.press('End');
  await text.press('Shift+Enter');
  await text.press('x');
  await expect(text).toHaveValue('Child\nx');
  await text.press('Escape');
  const active = page.locator('.row.active .item-text');
  await expect(active).toBeFocused();
  await active.press('F2');
  await expect(text).toBeFocused();
});

test('text undo restores selection and creating a sibling does not split text', async ({
  page,
}) => {
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  const text = page.getByRole('textbox');
  await text.fill('Original');
  await text.press('Escape');
  await page.locator('.row.active .item-text').press('F2');
  await expect(text).toBeFocused();
  for (let index = 0; index < 8; index++) await text.press('ArrowRight');
  expect(
    await text.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
  ).toBe(8);
  await text.press('!');
  await text.press(undo);
  await expect(text).toHaveValue('Original');
  expect(
    await text.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
  ).toBe(8);
  await text.press('Home');
  await text.press('ArrowRight');
  await text.press('Enter');
  await expect(
    page.getByRole('button', { name: 'Original', exact: true }),
  ).toBeVisible();
  await expect(text).toHaveValue('');
});

test('navigation skips collapsed descendants and task conversion/completion is undoable', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Collapse A little room for your thoughts' })
    .click();
  await expect(
    page.getByRole('button', {
      name: 'Press Enter to add a new item',
      exact: true,
    }),
  ).toHaveCount(0);
  const first = page.getByRole('button', {
    name: 'A little room for your thoughts',
    exact: true,
  });
  await first.focus();
  await first.press('ArrowDown');
  await expect(
    page.getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Make plain item', exact: true })
    .click();
  await expect(
    page.getByRole('checkbox', {
      name: 'Complete Make something worth remembering',
    }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const item = page.locator('.row.active .item-text');
  await item.press('Space');
  await expect(
    page.getByRole('checkbox', {
      name: 'Complete Make something worth remembering',
    }),
  ).toBeChecked();
});

test('composition Enter does not create a new item; plain Backspace does not delete a branch', async ({
  page,
}) => {
  await page
    .getByRole('button', {
      name: 'A little room for your thoughts',
      exact: true,
    })
    .click();
  const text = page.getByRole('textbox');
  const count = await page.locator('.row').count();
  await text.dispatchEvent('compositionstart');
  await text.dispatchEvent('keydown', {
    key: 'Enter',
    isComposing: true,
    bubbles: true,
  });
  await expect(page.locator('.row')).toHaveCount(count);
  await text.dispatchEvent('compositionend');
  await text.press('Home');
  await text.press('Backspace');
  await expect(page.locator('.row')).toHaveCount(count);
});

test('delete all branches, add into empty list, and undo', async ({ page }) => {
  await page
    .getByRole('button', { name: 'Delete branch', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Delete branch', exact: true })
    .click();
  const add = page.getByRole('button', {
    name: '＋ Add your first item',
    exact: true,
  });
  await expect(add).toBeFocused();
  await add.click();
  await expect(page.getByRole('textbox')).toBeFocused();
  await page.getByRole('textbox').press(undo);
  await expect(add).toBeFocused();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(
    page.getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    }),
  ).toBeFocused();
});

test('reload explicitly starts a new session and mobile viewport does not overflow', async ({
  page,
}) => {
  await expect(
    page.getByText('This session only — changes reset when you reload.'),
  ).toBeVisible();
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  await page.getByRole('textbox').fill('Temporary');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Temporary', exact: true }),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBeTruthy();
});

test('Delete removes a branch only in navigation and supports undo', async ({
  page,
}) => {
  const first = page.getByRole('button', {
    name: 'A little room for your thoughts',
    exact: true,
  });
  await first.click();
  const text = page.getByRole('textbox');
  await text.press('ArrowRight');
  await text.press('Delete');
  await expect(page.locator('.row')).toHaveCount(4);
  await expect(text).not.toHaveValue('A little room for your thoughts');
  await text.press('Escape');
  await page.locator('.row.active .item-text').press('Delete');
  await expect(page.locator('.row')).toHaveCount(1);
  await expect(
    page.getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    }),
  ).toBeFocused();
  await page.locator('.row.active .item-text').press(undo);
  await expect(page.locator('.row')).toHaveCount(4);
  await expect(page.locator('.row.active .item-text')).toBeFocused();
});

test('keyboard guide is modal, contains focus, and restores its trigger on close', async ({
  page,
}) => {
  const trigger = page.getByRole('button', { name: 'Keyboard guide ?' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Keyboard guide' });
  const close = page.getByRole('button', { name: 'Close keyboard guide' });
  await expect(dialog).toBeVisible();
  await expect(close).toBeFocused();
  await close.press('Tab');
  // Chromium may focus the document between tab cycles; background controls remain inert.
  expect(
    await page.evaluate(() => {
      const active = document.activeElement;
      return active === document.body || !!active?.closest('dialog');
    }),
  ).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await close.click();
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
