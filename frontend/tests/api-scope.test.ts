import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api, setApiOwner, suspendApi } from '../src/lib/api.ts';

test('new same-owner cookies cannot retag cached requests to a restored installation', async () => {
  const original = globalThis.fetch;
  let installation = 'original';
  const headers: Headers[] = [];
  globalThis.fetch = async (_input, init) => {
    headers.push(new Headers(init?.headers));
    return Response.json({ serverId: installation, ownerId: 'owner' });
  };
  try {
    setApiOwner('owner');
    suspendApi(false);
    await api.session();
    installation = 'restored';
    setApiOwner('owner'); // A new cookie or same-owner reauthentication is not a new workspace.
    await api.session();
    await api.lists();
    assert.equal(headers[1].get('X-FMN-Installation'), 'original');
    assert.equal(headers[2].get('X-FMN-Installation'), 'original');
    setApiOwner(null);
    setApiOwner('owner');
    await api.session();
    await api.lists();
    assert.equal(headers.at(-1)!.get('X-FMN-Installation'), 'restored');
  } finally {
    globalThis.fetch = original;
    setApiOwner(null);
    suspendApi(false);
  }
});
