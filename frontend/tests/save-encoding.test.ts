import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSave } from '../src/lib/save-encoding.ts';
import { api, ApiError, setApiOwner, suspendApi } from '../src/lib/api.ts';
const large = {
  id: 'list',
  title: 'Title',
  nodes: [],
  extra: 'Synthetic text '.repeat(5000),
};
test('save encoding preserves UTF-8, skips small bodies and falls back before sending', async () => {
  const text = JSON.stringify({ text: 'Нотатка з телефона 🌿 '.repeat(2000) });
  assert.deepEqual(await encodeSave('{}'), { body: '{}' });
  const result = await encodeSave(text);
  assert.equal(result.encoding, 'gzip');
  const restored = await new Response(
    new Blob([result.body])
      .stream()
      .pipeThrough(new DecompressionStream('gzip')),
  ).text();
  assert.equal(restored, text);
  assert.ok(
    (result.body as ArrayBuffer).byteLength <
      new TextEncoder().encode(text).byteLength / 2,
  );
  const original = globalThis.CompressionStream;
  try {
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: undefined,
    });
    assert.deepEqual(await encodeSave(text), { body: text });
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: class {
        constructor() {
          throw new Error('Unavailable encoder');
        }
      },
    });
    assert.deepEqual(await encodeSave(text), { body: text });
  } finally {
    Object.defineProperty(globalThis, 'CompressionStream', {
      configurable: true,
      value: original,
    });
  }
});
test('gzip requires server capability and never resends a rejected write automatically', async () => {
  const original = globalThis.fetch;
  const bodies: RequestInit[] = [];
  let capable = false;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/session'))
      return Response.json({
        serverId: 'server',
        ownerId: 'owner',
        ...(capable ? { saveEncoding: 'gzip' } : {}),
      });
    bodies.push(init!);
    return Response.json({ error: 'Conflict' }, { status: 409 });
  };
  try {
    setApiOwner('owner');
    suspendApi(false);
    await api.session();
    await assert.rejects(
      api.save(large, 0),
      (error) => error instanceof ApiError && error.status === 409,
    );
    assert.equal(typeof bodies[0].body, 'string');
    capable = true;
    await api.session();
    await assert.rejects(api.save(large, 0));
    assert.equal(
      new Headers(bodies[1].headers).get('Content-Encoding'),
      'gzip',
    );
    assert.equal(bodies.length, 2);
  } finally {
    globalThis.fetch = original;
    setApiOwner(null);
    suspendApi(false);
  }
});
test('account changes during asynchronous compression cancel the write even after switching back', async () => {
  const original = globalThis.fetch;
  let writes = 0;
  globalThis.fetch = async (path) => {
    if (String(path).endsWith('/session'))
      return Response.json({
        serverId: 'server',
        ownerId: 'owner',
        saveEncoding: 'gzip',
      });
    writes++;
    return Response.json({ revision: 1 });
  };
  try {
    setApiOwner('owner');
    suspendApi(false);
    await api.session();
    const saving = api.save(large, 0);
    setApiOwner(null);
    setApiOwner('owner');
    await assert.rejects(
      saving,
      (error) => error instanceof ApiError && error.status === 401,
    );
    assert.equal(writes, 0);
  } finally {
    globalThis.fetch = original;
    setApiOwner(null);
    suspendApi(false);
  }
});

test('incremental transport is negotiated, chooses smaller bytes and pins prepared attempts', async () => {
  const original = globalThis.fetch;
  let capable = false;
  let writes = 0;
  globalThis.fetch = async (path, init) => {
    if (String(path).endsWith('/session'))
      return Response.json({
        serverId: 'server',
        ownerId: 'owner',
        saveEncoding: 'gzip',
        ...(capable ? { incrementalSaveVersion: 1 } : {}),
      });
    writes++;
    const packet = JSON.parse(init!.body as string);
    return Response.json({
      protocolVersion: 1,
      operationId: packet.operationId,
      revision: 1,
    });
  };
  try {
    setApiOwner('owner');
    suspendApi(false);
    await api.session();
    const baseline = {
      id: crypto.randomUUID(),
      title: 'Large',
      nodes: Array.from({ length: 1000 }, (_, i) => ({
        id: crypto.randomUUID(),
        kind: 'item' as const,
        text: `Synthetic ${i}`,
        completed: false,
        children: [],
      })),
    };
    const target = structuredClone(baseline);
    target.nodes[0].text = 'Changed';
    assert.equal((await api.prepareSave(target, 0, baseline)).method, 'PUT');
    capable = true;
    await api.session();
    const prepared = await api.prepareSave(target, 0, baseline);
    assert.equal(prepared.method, 'PATCH');
    assert.ok(new TextEncoder().encode(prepared.body as string).length < 500);
    await api.sendSave(prepared);
    setApiOwner(null);
    setApiOwner('owner');
    await assert.rejects(
      api.sendSave(prepared),
      (error) => error instanceof ApiError && error.status === 401,
    );
    assert.equal(writes, 1);
  } finally {
    globalThis.fetch = original;
    setApiOwner(null);
    suspendApi(false);
  }
});
