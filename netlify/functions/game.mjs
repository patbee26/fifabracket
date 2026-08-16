// Multiplayer endpoint. All the logic lives in ../lib/rooms.mjs so it can be
// tested without the Netlify runtime; this file only adapts Blobs to the small
// store interface that module expects.

import { getStore } from '@netlify/blobs';
import { handle } from '../lib/rooms.mjs';

const blobStore = () => getStore({ name: 'monopoly-rooms', consistency: 'strong' });

const store = {
  async get(key) {
    const res = await blobStore().getWithMetadata(key, { type: 'json' });
    return res ? { data: res.data, etag: res.etag } : null;
  },

  async set(key, value, opts = {}) {
    try {
      const res = await blobStore().setJSON(key, value, opts);
      // Blobs reports {modified:false} when a conditional write was refused.
      return !res || res.modified !== false;
    } catch (err) {
      // A runtime without conditional-write support: fall back to an
      // unconditional write. Turn-based play makes a lost update unlikely.
      if (opts.onlyIfNew) throw err;
      await blobStore().setJSON(key, value);
      return true;
    }
  },
};

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') {
    return Response.json({ error: 'POST only.' }, { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Expected JSON.' }, { status: 400 });
  }

  try {
    const { status, body: payload } = await handle(store, body);
    return new Response(JSON.stringify(payload), {
      status,
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      { error: 'Server error.', detail: String(error?.message ?? error) },
      { status: 500 },
    );
  }
};

export const config = { path: '/api/game' };
