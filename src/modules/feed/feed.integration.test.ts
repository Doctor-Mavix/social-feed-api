import { randomInt, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '@core/config/env';
import type { DatabaseAdapter } from '@core/database/types';
import type { AppModule } from '@core/module';
import { authModule } from '@modules/auth/auth.module';
import { commentModule } from '@modules/comment/comment.module';
import { followModule } from '@modules/follow/follow.module';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import { postModule } from '@modules/post/post.module';
import { profileModule } from '@modules/profile/profile.module';
import { notificationModule } from '@shared/notifications/notification.module';
import type { SeededActor } from '@tests/actors';
import { bearer, purgeActors, seedActor } from '@tests/actors';
import type { Harness } from '@tests/harness';
import { PROVIDERS, startHarness } from '@tests/harness';
import { feedModule } from './feed.module';

const MODULES: readonly AppModule[] = [
  notificationModule,
  authModule,
  profileModule,
  followModule,
  postModule,
  commentModule,
  feedModule,
];

const API = env.API_PREFIX;
/** Enough pages that a cursor that silently repeats or skips rows cannot go unnoticed. */
const BACKFILL = 120;
const PAGE = 20;

/** A real 1×1 PNG: the upload path runs actual image processing, so a fake buffer would not do. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

/** Same reason as the auth suite: the global limiter keys on the client address. */
const BLOCK = `10.${String(randomInt(256))}.${String(randomInt(256))}`;
let addresses = 0;
const nextAddress = (): string => {
  addresses += 1;

  return `${BLOCK}.${String(addresses % 250)}`;
};

describe.each(PROVIDERS)('social flow on $name', ({ name }) => {
  let harness: Harness;
  let adapter: DatabaseAdapter;
  const actorIds: string[] = [];

  let alice: SeededActor;
  let bob: SeededActor;
  let aliceHandle: string;
  let bobHandle: string;

  async function actor(handle: string): Promise<SeededActor> {
    const seeded = await seedActor(harness.container);
    actorIds.push(seeded.id);

    await harness.agent
      .post(`${API}/profiles`)
      .set('Authorization', bearer(seeded.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ handle, displayName: handle })
      .expect(201);

    return seeded;
  }

  beforeAll(async () => {
    harness = await startHarness(name, MODULES);
    adapter = harness.adapter;

    const run = randomUUID().slice(0, 8).replace(/-/gu, '');
    aliceHandle = `alice_${run}`;
    bobHandle = `bob_${run}`;

    alice = await actor(aliceHandle);
    bob = await actor(bobHandle);
  });

  afterAll(async () => {
    await purgeActors(adapter, actorIds);
    await harness.stop();
  });

  it('publishes a post and shows it on the author timeline', async () => {
    const created = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'Hello from Cotonou' })
      .expect(201);

    expect(created.body.data.author.handle).toBe(bobHandle);
    expect(created.body.data.likeCount).toBe(0);
    expect(created.body.data.liked).toBe(false);

    const timeline = await harness.agent
      .get(`${API}/profiles/${bobHandle}/posts`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    expect(timeline.body.data).toHaveLength(1);
    // Anonymous reader: "not liked" and "we do not know" are different answers.
    expect(timeline.body.data[0].liked).toBeNull();
  });

  /**
   * The upload path, end to end: multer, the storage kit, the image processing and the presign
   * that renders the reply.
   *
   * It covers the wiring, not the pending-row bug that once made this route 500: processing is
   * asynchronous, so whether the reply reads a row before its variants exist is a race this test
   * usually wins. The deterministic guard for that lives in `shared/media/media.integration.test.ts`.
   */
  it('accepts an image with a post and answers with its urls', async () => {
    const created = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .field('text', 'A post with a picture')
      .attach('images', PIXEL, 'pixel.png')
      .expect(201);

    expect(created.body.data.images).toHaveLength(1);
    expect(created.body.data.images[0].original).toMatch(/^https?:\/\//u);

    const read = await harness.agent
      .get(`${API}/posts/${created.body.data.id as string}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    expect(read.body.data.images).toHaveLength(1);
  });

  it('emits post.created once, into the author room', async () => {
    const before = harness.realtime.of('post.created').length;

    await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'One publish, whatever the follower count' })
      .expect(201);

    const emitted = harness.realtime.of('post.created');

    expect(emitted).toHaveLength(before + 1);
    expect(emitted[emitted.length - 1]?.room).toBe(`module:author:${bob.id}`);
  });

  it('keeps a like idempotent and counts it once', async () => {
    const post = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'Likeable' })
      .expect(201);

    const id = post.body.data.id as string;
    const address = nextAddress();

    const first = await harness.agent
      .post(`${API}/posts/${id}/like`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(first.body.data).toEqual({ liked: true, likeCount: 1 });

    // The invariant the unique index exists for: a double tap must not move the counter twice.
    const second = await harness.agent
      .post(`${API}/posts/${id}/like`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(second.body.data).toEqual({ liked: true, likeCount: 1 });

    const read = await harness.agent
      .get(`${API}/posts/${id}`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(read.body.data.likeCount).toBe(1);
    expect(read.body.data.liked).toBe(true);

    const removed = await harness.agent
      .delete(`${API}/posts/${id}/like`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(removed.body.data).toEqual({ liked: false, likeCount: 0 });

    // And again: unliking twice must not drive the counter negative.
    const again = await harness.agent
      .delete(`${API}/posts/${id}/like`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(again.body.data.likeCount).toBe(0);
  });

  it('serves the like count from Redis, falling back to the durable copy', async () => {
    const post = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'Counter rebuild' })
      .expect(201);

    const id = post.body.data.id as string;

    await harness.agent
      .post(`${API}/posts/${id}/like`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    // Losing the key is the normal case, not the disaster: it expires after a week. The count
    // has to come back from the edges rather than restart at zero.
    await harness.redis.client.del(`likes:post:${id}`);

    const read = await harness.agent
      .get(`${API}/posts/${id}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    expect(read.body.data.likeCount).toBe(1);
  });

  it('threads comments oldest first and moves the post counter', async () => {
    const post = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'Commentable' })
      .expect(201);

    const id = post.body.data.id as string;

    for (const text of ['first', 'second', 'third']) {
      await harness.agent
        .post(`${API}/posts/${id}/comments`)
        .set('Authorization', bearer(alice.accessToken))
        .set('X-Forwarded-For', nextAddress())
        .send({ text })
        .expect(201);
    }

    const thread = await harness.agent
      .get(`${API}/posts/${id}/comments`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    expect(thread.body.data.map((row: { text: string }) => row.text)).toEqual([
      'first',
      'second',
      'third',
    ]);

    const read = await harness.agent
      .get(`${API}/posts/${id}`)
      .set('X-Forwarded-For', nextAddress())
      .expect(200);

    expect(read.body.data.commentCount).toBe(3);

    const removed = await harness.agent
      .delete(`${API}/comments/${thread.body.data[0].id as string}`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .expect(204);

    expect(removed.body).toEqual({});
  });

  it('follows, unfollows, and refuses a self-follow', async () => {
    const address = nextAddress();

    await harness.agent
      .post(`${API}/profiles/${bobHandle}/follow`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(200);

    const followers = await harness.agent
      .get(`${API}/profiles/${bobHandle}/followers`)
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(followers.body.data.map((row: { handle: string }) => row.handle)).toContain(aliceHandle);

    const following = await harness.agent
      .get(`${API}/profiles/${aliceHandle}/following`)
      .set('X-Forwarded-For', address)
      .expect(200);

    expect(following.body.data.map((row: { handle: string }) => row.handle)).toContain(bobHandle);

    await harness.agent
      .post(`${API}/profiles/${aliceHandle}/follow`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', address)
      .expect(409);
  });

  it('paginates the feed by cursor without repeating or skipping a row', async () => {
    // Written through the repository rather than the API: this test is about reading, and a
    // hundred and twenty POSTs would hit the global rate limiter before it proved anything.
    const repository = harness.container.resolve(POST_REPOSITORY);
    const at = Date.now();

    for (let index = 0; index < BACKFILL; index += 1) {
      await repository.create({
        id: randomUUID(),
        authorId: bob.id,
        text: `backfill ${String(index)}`,
      });
    }

    const address = nextAddress();
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;

    do {
      const query: string =
        cursor === null ? `?limit=${String(PAGE)}` : `?limit=${String(PAGE)}&cursor=${cursor}`;
      const page = await harness.agent
        .get(`${API}/feed${query}`)
        .set('Authorization', bearer(alice.accessToken))
        .set('X-Forwarded-For', address)
        .expect(200);

      seen.push(...page.body.data.map((row: { id: string }) => row.id));
      cursor = page.body.meta.nextCursor as string | null;
      pages += 1;
    } while (cursor !== null && pages < 20);

    // Alice follows Bob, so his backfill is her feed; the exact total also includes the posts
    // the earlier tests published.
    expect(seen.length).toBeGreaterThanOrEqual(BACKFILL);
    expect(new Set(seen).size).toBe(seen.length);
    expect(pages).toBeGreaterThan(BACKFILL / PAGE);
    expect(Date.now() - at).toBeLessThan(30_000);
  });

  it('refuses to show a feed to an anonymous reader', async () => {
    await harness.agent.get(`${API}/feed`).set('X-Forwarded-For', nextAddress()).expect(401);
  });

  it('lets only the author delete a post', async () => {
    const post = await harness.agent
      .post(`${API}/posts`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .send({ text: 'Mine to delete' })
      .expect(201);

    const id = post.body.data.id as string;

    await harness.agent
      .delete(`${API}/posts/${id}`)
      .set('Authorization', bearer(alice.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .expect(403);

    await harness.agent
      .delete(`${API}/posts/${id}`)
      .set('Authorization', bearer(bob.accessToken))
      .set('X-Forwarded-For', nextAddress())
      .expect(204);

    // Soft-deleted, so the plugin has to scope the read: a 200 here would mean every feed still
    // carries it.
    await harness.agent.get(`${API}/posts/${id}`).set('X-Forwarded-For', nextAddress()).expect(404);
  });
});
