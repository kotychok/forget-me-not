import { test, expect } from '@playwright/test';

test('Telegram settings create a private one-time link, choose an Inbox and disconnect without leaving Account', async ({
  page,
}) => {
  let connected = false;
  let inbox = '';
  let issued = 0;
  await page.route('**/api/telegram', async (route) => {
    if (route.request().method() === 'DELETE') {
      connected = false;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.fulfill({
      json: {
        enabled: true,
        botUsername: 'fmn_test_bot',
        telegramId: connected ? '99' : null,
        listId: connected ? inbox : null,
      },
    });
  });
  await page.route('**/api/telegram/link', async (route) => {
    issued++;
    inbox = route.request().postDataJSON().listId;
    await route.fulfill({
      json: {
        url: `https://t.me/fmn_test_bot?start=${'a'.repeat(64)}`,
        expiresIn: 600,
      },
    });
  });
  await page.route('**/api/telegram/inbox', async (route) => {
    inbox = route.request().postDataJSON().listId;
    await route.fulfill({ status: 204 });
  });
  await page.goto('/');
  await page.getByLabel('Login', { exact: true }).fill('owner');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Synthetic password for browser tests!');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('button', { name: 'New list', exact: false }).click();
  await page
    .getByRole('textbox', { name: 'List title' })
    .fill('Telegram Inbox');
  await page.getByRole('textbox', { name: 'List title' }).press('Enter');
  const list = new URL(page.url()).searchParams.get('list')!;
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Account: owner' });
  const settings = dialog.getByRole('region', { name: 'Telegram Inbox' });
  await expect(settings.getByText(/Not connected/)).toBeVisible();
  await settings.getByLabel('Inbox list').selectOption(list);
  await settings
    .getByRole('button', { name: 'Generate connection link' })
    .click();
  await expect(
    settings.getByRole('link', { name: 'Open Telegram to connect' }),
  ).toHaveAttribute(
    'href',
    `https://t.me/fmn_test_bot?start=${'a'.repeat(64)}`,
  );
  expect(issued).toBe(1);
  connected = true;
  await settings
    .getByRole('button', { name: 'Refresh Telegram settings' })
    .click();
  await expect(
    settings.getByText('@fmn_test_bot · Connected', { exact: true }),
  ).toBeVisible();
  await settings.getByRole('button', { name: 'Apply Inbox' }).click();
  await expect(settings.getByRole('status')).toHaveText('Inbox updated.');
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: test.info().outputPath('telegram-mobile.png'),
  });
  await settings.getByRole('button', { name: 'Disconnect Telegram' }).click();
  await expect(settings.getByText(/Not connected/)).toBeVisible();
  await expect(
    settings.getByRole('link', { name: 'Open Telegram to connect' }),
  ).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close account' }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(
    page.getByRole('link', { name: 'Open Telegram to connect' }),
  ).toHaveCount(0);
});
