import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loginUser, listSessionUsers, auditSessionEvent } from './session-authority.js';

/** T8 (ADR-031): session bridge — native absent in tests, loopback stubbed. */

function stubFetch(handler: () => Promise<Response>): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = handler as unknown as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

describe('session authority (T8)', () => {
  it('loginUser returns the verified user from the loopback', async () => {
    const restore = stubFetch(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          user: { id: 1, username: 'owner', display_name: 'Gérant', role: 'owner', must_change_pin: 1, active: 1 },
        }),
        { status: 200 },
      ),
    );
    try {
      const r = await loginUser('owner', '1234');
      assert.equal(r.ok, true);
      if (r.ok) assert.equal(r.user.role, 'owner');
    } finally {
      restore();
    }
  });

  it('loginUser surfaces lockout and garbage safely', async () => {
    let mode = 'locked';
    const restore = stubFetch(async () =>
      mode === 'locked'
        ? new Response(JSON.stringify({ ok: false, locked: true }), { status: 401 })
        : new Response('nope', { status: 200 }),
    );
    try {
      const l = await loginUser('sara', '0000');
      assert.deepEqual(l, { ok: false, locked: true });
      mode = 'garbage';
      assert.deepEqual(await loginUser('x', 'y'), { ok: false, locked: false });
    } finally {
      restore();
    }
  });

  it('loopback down => locked:false and users null (login screen stays)', async () => {
    const restore = stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    try {
      assert.deepEqual(await loginUser('owner', '1234'), { ok: false, locked: false });
      assert.equal(await listSessionUsers(), null);
      await auditSessionEvent('owner', 'logout'); // must never throw
    } finally {
      restore();
    }
  });
});
