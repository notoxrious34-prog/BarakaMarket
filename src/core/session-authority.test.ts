import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  loginUser, listSessionUsers, auditSessionEvent,
  createSessionUser, setSessionUserActive, lastUserLaneError,
} from './session-authority.js';

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

  it('T8b: create/active surface typed reasons, never throw', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      const u = String(url);
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if (u.endsWith('/api/users')) {
        if (body.requesterRole !== 'owner') {
          return new Response(JSON.stringify({ error: 'owner role required' }), { status: 403 });
        }
        if (body.username === 'sara') {
          return new Response(JSON.stringify({ error: '[db] username taken: sara' }), { status: 400 });
        }
        return new Response(
          JSON.stringify({ id: 2, username: body.username, display_name: 'Sara', role: 'manager', must_change_pin: 1, active: 1 }),
          { status: 201 },
        );
      }
      if (u.endsWith('/api/users/active')) {
        if (body.requesterRole !== 'owner') {
          return new Response(JSON.stringify({ error: 'owner role required' }), { status: 403 });
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const created = await createSessionUser(
        { username: 'lina', display_name: 'Lina', role: 'manager', pin: '5678' }, 'owner', 'owner',
      );
      assert.equal(created?.username, 'lina');
      assert.equal(lastUserLaneError(), null);

      assert.equal(
        await createSessionUser({ username: 'sara', role: 'cashier', pin: '1111' }, 'owner', 'owner'),
        null,
      );
      assert.match(String(lastUserLaneError()), /taken/);

      assert.equal(
        await createSessionUser({ username: 'mallory', role: 'manager', pin: '1111' }, 'manager', 'mallory'),
        null,
      );
      assert.match(String(lastUserLaneError()), /owner role required/);

      assert.equal(await setSessionUserActive(2, false, 'owner', 'owner'), true);
      assert.equal(await setSessionUserActive(2, false, 'manager', 'mallory'), false);
      assert.match(String(lastUserLaneError()), /owner role required/);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('T8b: loopback down => null/false with an offline reason', async () => {
    const restore = stubFetch(async () => {
      throw new Error('ECONNREFUSED');
    });
    try {
      assert.equal(
        await createSessionUser({ username: 'x', role: 'cashier', pin: '1111' }, 'owner', 'owner'),
        null,
      );
      assert.match(String(lastUserLaneError()), /unreachable/);
      assert.equal(await setSessionUserActive(9, false, 'owner', 'owner'), false);
      assert.match(String(lastUserLaneError()), /unreachable/);
    } finally {
      restore();
    }
  });
});
