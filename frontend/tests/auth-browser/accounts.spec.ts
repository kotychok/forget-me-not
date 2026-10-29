import { test, expect } from '@playwright/test';
const ownerPassword = 'Synthetic password for browser tests!';
const friendPassword = 'Synthetic friend password!';
async function signIn(
  page: import('@playwright/test').Page,
  login: string,
  password: string,
) {
  await page.goto('/');
  await page.getByLabel('Login', { exact: true }).fill(login);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByText(`Signed in as ${login}`, { exact: true }),
  ).toBeVisible();
}
async function createList(
  page: import('@playwright/test').Page,
  title: string,
) {
  await page.getByRole('button', { name: 'New list', exact: false }).click();
  const input = page.getByRole('textbox', { name: 'List title', exact: true });
  await input.fill(title);
  await input.press('Enter');
  await page
    .getByRole('button', { name: 'Add your first item', exact: false })
    .click();
  const text = page.getByRole('textbox', { name: 'Item text', exact: true });
  await text.fill(`${title} thought`);
  await text.press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  return new URL(page.url()).searchParams.get('list')!;
}
async function setPassword(
  page: import('@playwright/test').Page,
  url: string,
  password: string,
) {
  await page.goto(url);
  await expect(page.getByLabel('New password', { exact: true })).toBeVisible();
  expect(page.url()).not.toContain('#');
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Repeat password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Set password', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Password saved');
}
test('admin-created friend activates once, owns private content, resets access and loses revoked sessions', async ({
  page,
  browser,
}) => {
  await signIn(page, 'owner', ownerPassword);
  const ownerList = await createList(page, 'Owner private');
  await page
    .getByRole('button', { name: 'Manage people', exact: true })
    .click();
  await expect(page).toHaveURL(/\/admin/);
  await page
    .getByLabel('Display name', { exact: true })
    .fill('Synthetic Friend');
  await page.getByLabel('Login', { exact: true }).fill('friend');
  await page
    .getByRole('button', { name: 'Create activation link', exact: true })
    .click();
  const issued = page.getByRole('dialog', {
    name: 'Activation link',
    exact: true,
  });
  const first = await issued
    .getByLabel('Access link', { exact: true })
    .inputValue();
  await issued.getByRole('button', { name: 'Done', exact: true }).click();
  const row = page.getByRole('article', {
    name: 'Account friend',
    exact: true,
  });
  await expect(row).toContainText('Awaiting activation');
  await row
    .getByRole('button', { name: 'New activation link', exact: true })
    .click();
  const next = await issued
    .getByLabel('Access link', { exact: true })
    .inputValue();
  expect(next).not.toBe(first);
  await issued.getByRole('button', { name: 'Done', exact: true }).click();
  const context = await browser.newContext();
  try {
    const friend = await context.newPage();
    await friend.goto(first);
    await expect(friend.getByRole('alert')).toContainText(
      'invalid, expired or already used',
    );
    await setPassword(friend, next, friendPassword);
    await signIn(friend, 'friend', friendPassword);
    const friendList = await createList(friend, 'Friend private');
    expect((await friend.request.get(`/api/lists/${ownerList}`)).status()).toBe(
      404,
    );
    expect((await page.request.get(`/api/lists/${friendList}`)).status()).toBe(
      404,
    );
    expect((await friend.request.get('/api/auth/admin/users')).status()).toBe(
      403,
    );
    await friend.goto('/admin');
    await expect(
      friend.getByRole('heading', {
        name: 'Administrator access required',
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole('button', { name: 'Refresh accounts', exact: true })
      .click();
    await expect(row).toContainText('1 active session');
    page.once('dialog', (dialog) => dialog.accept());
    await row
      .getByRole('button', { name: 'Reset password', exact: true })
      .click();
    const reset = page.getByRole('dialog', {
      name: 'Password reset link',
      exact: true,
    });
    const resetUrl = await reset
      .getByLabel('Access link', { exact: true })
      .inputValue();
    await reset.getByRole('button', { name: 'Done', exact: true }).click();
    expect((await friend.request.get('/api/lists')).status()).toBe(401);
    await setPassword(friend, resetUrl, 'New synthetic friend password!');
    await signIn(friend, 'friend', 'New synthetic friend password!');
    await expect(friend.locator('.item-text')).toHaveText(
      'Friend private thought',
    );
    await page
      .getByRole('button', { name: 'Refresh accounts', exact: true })
      .click();
    page.once('dialog', (dialog) => dialog.accept());
    await row
      .getByRole('button', { name: 'Disable account', exact: true })
      .click();
    await expect(row).toContainText('Disabled');
    expect((await friend.request.get('/api/lists')).status()).toBe(401);
    await row
      .getByRole('button', { name: 'Enable account', exact: true })
      .click();
    await expect(row.locator('.account-state')).toHaveText('Active');
    expect((await friend.request.get('/api/lists')).status()).toBe(401);
    await signIn(friend, 'friend', 'New synthetic friend password!');
    page.once('dialog', (dialog) => dialog.accept());
    await row
      .getByRole('button', { name: 'Revoke sessions', exact: true })
      .click();
    expect((await friend.request.get('/api/lists')).status()).toBe(401);
    await expect(
      page.getByRole('button', { name: 'Refresh accounts', exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath('people-desktop.png'),
    });
    await page.setViewportSize({ width: 390, height: 954 });
    expect(
      await page.evaluate(() => document.body.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('people-mobile.png'),
    });
    await page
      .getByRole('button', { name: 'Back to lists', exact: true })
      .click();
    await expect(page.locator('.item-text')).toHaveText(
      'Owner private thought',
    );
  } finally {
    await context.close();
  }
});
