import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
test('incremental autosaves resend identical packets after lost acknowledgements', async ({
  page,
  request,
}) => {
  const list = await (
    await request.post('/api/lists', { data: { title: 'Compressed saves' } })
  ).json();
  const nodes = Array.from({ length: 1000 }, (_, i) => ({
    id: randomUUID(),
    kind: 'item',
    text: `Synthetic reference ${i}: ${randomUUID()}`,
    completed: false,
    children: [],
  }));
  await request.put(`/api/lists/${list.id}`, {
    data: {
      baseRevision: 0,
      document: { id: list.id, title: list.title, nodes },
    },
  });
  await page.goto(`/?list=${list.id}`);
  await page.locator('.row .item-text').first().click();
  const outgoing = page.waitForRequest(
    (req) =>
      req.method() === 'PATCH' && req.url().endsWith(`/api/lists/${list.id}`),
  );
  const response = page.waitForResponse(
    (res) =>
      res.request().method() === 'PATCH' &&
      res.url().endsWith(`/api/lists/${list.id}`),
  );
  await page
    .getByRole('textbox', { name: 'Item text', exact: true })
    .fill('Нова нотатка 🌿');
  await page
    .getByRole('textbox', { name: 'Item text', exact: true })
    .press('Escape');
  const sent = await outgoing;
  expect(sent.headers()['content-encoding']).toBeUndefined();
  expect(JSON.parse(sent.postData()!).ops).toHaveLength(1);
  expect((await response).status()).toBe(200);
  const sizes = await sent.sizes();
  const saved = await (await request.get(`/api/lists/${list.id}`)).json();
  expect(saved.nodes[0].text).toBe('Нова нотатка 🌿');
  expect(saved.revision).toBe(2);
  const raw = Buffer.byteLength(
    JSON.stringify({
      document: { id: saved.id, title: saved.title, nodes: saved.nodes },
      baseRevision: 1,
    }),
  );
  expect(sizes.requestBodySize).toBeLessThan(500);
  console.log(
    `M14b: ${raw} raw JSON bytes -> ${sizes.requestBodySize} delta bytes; HTTP timing ${JSON.stringify(sent.timing())}`,
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Нова нотатка 🌿', exact: true }),
  ).toBeVisible();
  let writes = 0;
  let frozen: string | null = null;
  await page.route(`**/api/lists/${list.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') {
      await route.continue();
      return;
    }
    writes++;
    const body = route.request().postData();
    if (frozen !== null) expect(body).toBe(frozen);
    frozen = body;
    const committed = await route.fetch();
    expect(committed.status()).toBe(200);
    if (writes === 1) await route.abort('connectionfailed');
    else await route.fulfill({ response: committed });
  });
  await page
    .getByRole('button', { name: 'Нова нотатка 🌿', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Item text', exact: true })
    .fill('Compressed save with lost acknowledgement');
  await page
    .getByRole('textbox', { name: 'Item text', exact: true })
    .press('Escape');
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Save failed',
  );
  await page.getByRole('button', { name: 'Retry save', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Save status' })).toContainText(
    'Saved',
  );
  expect(writes).toBe(2);
  expect(
    (await (await request.get(`/api/lists/${list.id}`)).json()).revision,
  ).toBe(3);
});
