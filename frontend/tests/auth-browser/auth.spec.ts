import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const password = 'Synthetic password for browser tests!';
async function login(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByLabel('Login', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByText('Signed in as owner', { exact: true }),
  ).toBeVisible();
}
async function createList(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: 'New list', exact: false }).click();
  const title = page.getByRole('textbox', { name: 'List title' });
  await title.fill('Private browser list');
  await title.press('Enter');
  await page
    .getByRole('button', { name: 'Add your first item', exact: false })
    .click();
  const text = page.getByRole('textbox', { name: 'Item text', exact: true });
  await text.fill('Private thought');
  await text.press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
}

test('login, reload persistence, session management and logout keep content private', async ({
  page,
  context,
}) => {
  await page.goto('/');
  await expect(page.locator('.item-text')).toHaveCount(0);
  await page.getByLabel('Login', { exact: true }).fill('owner');
  await page.getByLabel('Password', { exact: true }).fill('incorrect password');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Invalid login or password',
  );
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await createList(page);
  // Synthetic empty lists exercise the sidebar's own scroll area, not the user's data.
  for (let index = 1; index <= 30; index++) {
    const response = await page.request.post('/api/lists', {
      headers: { 'X-FMN-Request': '1' },
      data: { title: `Empty list ${index}` },
    });
    expect(response.ok()).toBeTruthy();
  }
  const cookies = await context.cookies();
  expect(cookies.find((cookie) => cookie.name === 'fmn.sid')?.httpOnly).toBe(
    true,
  );
  await page.reload();
  await expect(
    page.getByText('Signed in as owner', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.item-text')).toHaveText('Private thought');
  await page
    .getByRole('navigation', { name: 'Lists', exact: true })
    .evaluate((el) => {
      el.scrollTop = 200;
    });
  await expect(
    page.getByRole('button', { name: 'New list', exact: false }),
  ).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Search lists', exact: true }),
  ).toBeInViewport();
  await expect(
    page.getByRole('button', { name: 'Account', exact: true }),
  ).toBeInViewport();
  await page.screenshot({
    path: test.info().outputPath('account-sidebar-desktop.png'),
  });
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  const account = page.getByRole('dialog', {
    name: 'Account: owner',
    exact: true,
  });
  await expect(account.getByText(/This browser/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 954 });
  expect(await account.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({ path: test.info().outputPath('account-mobile.png') });
  await account
    .getByRole('button', { name: 'Close account', exact: true })
    .click();
  await page.screenshot({
    path: test.info().outputPath('account-sidebar-mobile.png'),
  });
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByLabel('Login', { exact: true })).toBeVisible();
  await expect(page.locator('.item-text')).toHaveCount(0);
  const response = await page.request.get('/api/lists');
  expect(response.status()).toBe(401);
});

test('expired authentication preserves pending edits, restores modal drafts, and reconciles after same-owner sign-in', async ({
  page,
  context,
}) => {
  await login(page);
  await createList(page);
  const id = new URL(page.url()).searchParams.get('list')!;
  await context.clearCookies();
  await page.locator('.item-text').click();
  const text = page.getByRole('textbox', { name: 'Item text', exact: true });
  await text.fill('Pending across authentication expiry');
  await text.press('Escape');
  await expect(
    page.getByRole('heading', { name: 'Sign in again', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Login', { exact: true })).toHaveValue('owner');
  await expect(page.getByLabel('Login', { exact: true })).toHaveAttribute(
    'readonly',
    '',
  );
  const ready = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Download local edits', exact: true })
    .click();
  const source = JSON.parse(
    await readFile((await (await ready).path())!, 'utf8'),
  );
  expect(source.lists[0].nodes[0].text).toBe(
    'Pending across authentication expiry',
  );
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.locator('.item-text')).toHaveText(
    'Pending across authentication expiry',
  );
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  expect(
    (await (await page.request.get(`/api/lists/${id}`)).json()).nodes[0].text,
  ).toBe('Pending across authentication expiry');
  // A modal draft must not block the reauthentication UI or disappear on a same-owner return.
  await page.locator('.item-text').focus();
  await page.keyboard.press('n');
  const note = page.getByRole('dialog', { name: 'Item note', exact: true });
  await note.getByRole('textbox').fill('Unapplied note draft');
  await context.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(
    page.getByRole('heading', { name: 'Sign in again', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Keep drafts and sign out', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('unapplied dialog draft');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(note).toBeVisible();
  await expect(note.getByRole('textbox')).toHaveValue('Unapplied note draft');
  await note.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('password change signs out other devices and accepts only the new password', async ({
  page,
  browser,
}) => {
  await login(page);
  const other = await browser.newContext();
  try {
    const otherPage = await other.newPage();
    await login(otherPage);
    await page.getByRole('button', { name: 'Account', exact: true }).click();
    const account = page.getByRole('dialog', {
      name: 'Account: owner',
      exact: true,
    });
    await account
      .getByLabel('Current password', { exact: true })
      .fill(password);
    await account
      .getByLabel('New password', { exact: true })
      .fill('New synthetic password for tests!');
    await account
      .getByLabel('Repeat new password', { exact: true })
      .fill('New synthetic password for tests!');
    await account
      .getByRole('button', {
        name: 'Change password and sign out',
        exact: true,
      })
      .click();
    await expect(page.getByLabel('Login', { exact: true })).toBeVisible();
    expect((await otherPage.request.get('/api/lists')).status()).toBe(401);
    await page.getByLabel('Login', { exact: true }).fill('owner');
    await page
      .getByLabel('Password', { exact: true })
      .fill('New synthetic password for tests!');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(
      page.getByText('Signed in as owner', { exact: true }),
    ).toBeVisible();
  } finally {
    await other.close();
  }
});
