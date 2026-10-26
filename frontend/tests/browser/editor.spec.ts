import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const undo = process.platform === 'darwin' ? 'Meta+z' : 'Control+z';
const redo = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z';

test.beforeEach(async ({ page, request }) => {
  const created = await request.post('/api/lists', {
    data: { title: 'My first list' },
  });
  expect(created.ok()).toBeTruthy();
  const list = await created.json();
  const node = (text: string, kind = 'item') => ({
    id: randomUUID(),
    kind,
    text,
    completed: false,
    children: [] as unknown[],
  });
  const welcome = node('A little room for your thoughts');
  welcome.children = [
    node('Press Enter to add a new item'),
    node('Try Tab and Shift+Tab while editing', 'task'),
  ];
  const saved = await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: {
        id: list.id,
        title: list.title,
        nodes: [welcome, node('Make something worth remembering', 'task')],
      },
    },
  });
  expect(saved.ok()).toBeTruthy();
  await page.goto(`/?list=${list.id}`);
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

test('saved content survives reload and mobile viewport does not overflow', async ({
  page,
}) => {
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  await page.getByRole('textbox').fill('Persistent');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Persistent', exact: true }),
  ).toBeVisible();
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

test('create, rename from heading, switch lists, and reopen after reload', async ({
  page,
}) => {
  const originalId = new URL(page.url()).searchParams.get('list')!;
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'My first list',
  );
  await page.getByRole('button', { name: 'New list', exact: false }).click();
  const title = page.getByRole('textbox', { name: 'List title' });
  await expect(title).toBeFocused();
  await title.fill('Second list');
  await title.press('Enter');
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'Second list',
  );
  await page
    .getByRole('button', { name: 'Add your first item', exact: false })
    .click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Second list item');
  await expect(page.getByRole('status')).toHaveText('Saved');
  const secondId = new URL(page.url()).searchParams.get('list')!;
  await page
    .locator(`nav .list-link`)
    .filter({ hasText: 'Second list' })
    .click();
  // Selecting another list does not replace this list's editor history.
  await page.goto(`/?list=${originalId}`);
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'My first list',
  );
  await page
    .locator('nav .list-link')
    .filter({ hasText: 'Second list' })
    .click();
  await expect(
    page.getByRole('button', { name: 'Second list item', exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get('list')).toBe(secondId);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Rename list' })).toHaveText(
    'Second list',
  );
});

test('heading rename supports Escape and persists across reload', async ({
  page,
}) => {
  const heading = page.getByRole('button', { name: 'Rename list' });
  await heading.click();
  let input = page.getByRole('textbox', { name: 'List title' });
  await input.fill('Cancelled');
  await input.press('Escape');
  await expect(heading).toHaveText('My first list');
  await heading.click();
  input = page.getByRole('textbox', { name: 'List title' });
  await input.fill('Renamed from heading');
  await input.press('Enter');
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(heading).toHaveText('Renamed from heading');
});

test('deleting a list requires confirmation and removes it from the server', async ({
  page,
  request,
}) => {
  await expect(page.getByRole('status')).toHaveText('Saved');
  const id = new URL(page.url()).searchParams.get('list')!;
  page.once('dialog', (dialog) => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete list', exact: true }).click();
  expect((await request.get(`/api/lists/${id}`)).status()).toBe(200);
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Delete list', exact: true }).click();
  await expect
    .poll(async () => (await request.get(`/api/lists/${id}`)).status())
    .toBe(404);
});

test('server conflict keeps local text and never silently overwrites the other version', async ({
  page,
  request,
}) => {
  const id = new URL(page.url()).searchParams.get('list')!;
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  const document = await (await request.get(`/api/lists/${id}`)).json();
  await request.put(`/api/lists/${id}`, {
    data: {
      baseRevision: document.revision,
      document: { id, title: 'External title', nodes: document.nodes },
    },
  });
  const text = page.getByRole('textbox', { name: 'Item text' });
  await text.fill('Local version');
  await expect(page.getByRole('status')).toContainText('Conflict');
  await expect(text).toHaveValue('Local version');
  expect((await (await request.get(`/api/lists/${id}`)).json()).title).toBe(
    'External title',
  );
});

test('editing during a slow save remains unsaved until the latest snapshot is acknowledged', async ({
  page,
}) => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let intercepted = false;
  await page.route('**/api/lists/*', async (route) => {
    if (route.request().method() === 'PUT' && !intercepted) {
      intercepted = true;
      await gate;
    }
    await route.continue();
  });
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await text.fill('First edit');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saving…',
  );
  await text.fill('Newest edit');
  await expect(page.getByRole('status')).not.toHaveText('Saved');
  release();
  await expect(page.getByRole('status')).toHaveText('Saved');
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Newest edit', exact: true }),
  ).toBeVisible();
});

test('switching lists preserves independent editing history and pending saves', async ({
  page,
}) => {
  const firstId = new URL(page.url()).searchParams.get('list')!;
  await page
    .getByRole('button', {
      name: 'Make something worth remembering',
      exact: true,
    })
    .click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('First local edit');
  await page.getByRole('button', { name: 'New list', exact: false }).click();
  await page.getByRole('textbox', { name: 'List title' }).press('Escape');
  const secondId = new URL(page.url()).searchParams.get('list')!;
  await page
    .getByRole('button', { name: 'Add your first item', exact: false })
    .click();
  await page
    .getByRole('textbox', { name: 'Item text' })
    .fill('Second local edit');
  await page.locator(`[data-list-id="${firstId}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
    'First local edit',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
    'Make something worth remembering',
  );
  await page.locator(`[data-list-id="${secondId}"]`).click();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
    'Second local edit',
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveValue(
    '',
  );
});

test('Escape cancels an untouched new item even after autosave, with stable layout', async ({
  page,
}) => {
  const item = page.getByRole('button', {
    name: 'Make something worth remembering',
    exact: true,
  });
  await item.click();
  const text = page.getByRole('textbox', { name: 'Item text' });
  await text.press('Enter');
  const before = await page.locator('.toolbar').boundingBox();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  await expect(page.locator('.session-note')).toHaveCSS('opacity', '0');
  expect((await page.locator('.toolbar').boundingBox())?.y).toBe(before?.y);
  await text.press('Escape');
  await expect(page.locator('.row')).toHaveCount(4);
  await expect(item).toBeFocused();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  await page.reload();
  await expect(page.locator('.row')).toHaveCount(4);
  await item.click();
  await text.press('Enter');
  await text.fill('x');
  await text.fill('');
  await text.press('Escape');
  await expect(page.locator('.row')).toHaveCount(5);
});

test('Tab moves whole branches in navigation without entering edit mode and Escape exits', async ({
  page,
}) => {
  const item = page.getByRole('button', {
    name: 'Make something worth remembering',
    exact: true,
  });
  await item.focus();
  const id = await item.getAttribute('data-item');
  await item.press('Tab');
  await expect(item).toBeFocused();
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  await expect(page.getByRole('textbox', { name: 'Item text' })).toHaveCount(0);
  await item.press('Shift+Tab');
  await expect(item).toBeFocused();
  await expect(item).toHaveAttribute('data-item', id!);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  await item.press(undo);
  await expect(item).toBeFocused();
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  await item.press(redo);
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  // Move a parent with descendants, then verify outdent is a no-op at the root.
  const parent = page.getByRole('button', {
    name: 'A little room for your thoughts',
    exact: true,
  });
  await parent.focus();
  await parent.press('Shift+Tab');
  await expect(parent).toBeFocused();
  await parent.press('Alt+ArrowDown');
  await parent.press('Tab');
  await expect(parent).toBeFocused();
  await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
  await expect(
    page
      .getByRole('button', {
        name: 'Press Enter to add a new item',
        exact: true,
      })
      .locator('..'),
  ).toHaveCSS('--depth', '2');
  await parent.press('Escape');
  const add = page.getByRole('button', { name: '＋ Add item', exact: true });
  await expect(add).toBeFocused();
  await add.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeFocused();
  await expect(page.locator('.row')).toHaveCount(4);
});

test('item toolbar stays reachable while scrolling a long list on desktop and mobile', async ({
  page,
  request,
}) => {
  const created = await request.post('/api/lists', {
    data: { title: 'Long list' },
  });
  const list = await created.json();
  const nodes = Array.from({ length: 70 }, (_, index) => ({
    id: randomUUID(),
    kind: 'item',
    text: `Long item ${index}`,
    completed: false,
    children: [],
  }));
  const saved = await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: { id: list.id, title: list.title, nodes },
    },
  });
  expect(saved.ok()).toBeTruthy();
  for (const width of [1009, 390]) {
    await page.setViewportSize({ width, height: 954 });
    await page.goto(`/?list=${list.id}`);
    const item = page.getByRole('button', {
      name: 'Long item 50',
      exact: true,
    });
    await item.focus();
    await item.press('ArrowDown');
    const toolbar = page.getByLabel('Item actions', { exact: true });
    await expect.poll(async () => (await toolbar.boundingBox())?.y).toBe(0);
    const focused = page.locator('.row.active .item-text');
    const toolbarBox = (await toolbar.boundingBox())!;
    expect((await focused.boundingBox())!.y).toBeGreaterThanOrEqual(
      toolbarBox.height,
    );
    await page.getByRole('button', { name: 'Indent →', exact: true }).click();
    await expect(page.locator('.row.active')).toHaveCSS('--depth', '1');
    await expect(focused).toBeFocused();
    await page.getByRole('button', { name: '← Outdent', exact: true }).click();
    await expect(page.locator('.row.active')).toHaveCSS('--depth', '0');
  }
});
