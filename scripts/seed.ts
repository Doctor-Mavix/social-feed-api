import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

import { mongoConnectionOf } from '@core/database';
import { compositeSortKey } from '@core/database/mongo/keyset';
import { AUTH_REPOSITORY } from '@modules/auth/auth.repository';
import { PasswordService } from '@modules/auth/password.service';
import { followModel } from '@modules/follow/mongo/follow.schema';
import { postModel } from '@modules/post/mongo/post.schema';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import { PROFILE_REPOSITORY } from '@modules/profile/profile.repository';
import { say, withApp } from './bootstrap';

/**
 * Fills the database with a graph big enough for the feed to be measured on: the point of the
 * exercise is that page 5000 costs what page 1 costs, and that is not observable on ten rows.
 *
 *   pnpm db:seed [--actors 200] [--posts 100000] [--follows 50]
 *
 * The posts and the edges are written with `insertMany` rather than through the repositories.
 * That is a deliberate exception to the rule the application follows — a hundred thousand
 * round trips would take a quarter of an hour — and the script pays for it by reading a page
 * back through the repository at the end, so a shape the code cannot read fails here.
 */
const BATCH = 5_000;
/** Posts are dated across this window so the keyset has a real range to walk. */
const WINDOW_DAYS = 180;
const SEED_PASSWORD = 'SeedPassword!2026';

function integer(max: number): number {
  return Math.floor(Math.random() * max);
}

await withApp(async ({ container, adapter }) => {
  const { values } = parseArgs({
    options: {
      actors: { type: 'string', default: '200' },
      posts: { type: 'string', default: '100000' },
      follows: { type: 'string', default: '50' },
    },
  });

  const actorCount = Number(values.actors);
  const postCount = Number(values.posts);
  const followCount = Math.min(Number(values.follows), actorCount - 1);
  const suffix = Date.now().toString(36);

  const auth = container.resolve(AUTH_REPOSITORY);
  const profiles = container.resolve(PROFILE_REPOSITORY);
  const connection = mongoConnectionOf(adapter);
  const posts = postModel(connection);
  const follows = followModel(connection);

  // Hashed once and reused: argon2 is deliberately slow, and hashing the same string two
  // hundred times would dominate the runtime of the whole script for no benefit.
  const passwordHash = await container.resolve(PasswordService).hash(SEED_PASSWORD);
  const started = Date.now();

  const ids: string[] = [];

  for (let index = 0; index < actorCount; index += 1) {
    const id = randomUUID();
    const handle = `seed_${suffix}_${String(index)}`;

    await auth.createActor({
      id,
      actorType: 'user',
      email: `${handle}@seed.local`,
      displayName: `Seed ${String(index)}`,
      passwordHash,
      phone: null,
      roles: [],
      permissions: [],
      status: 'active',
    });
    await auth.updateActor(id, { emailVerifiedAt: new Date() });
    await profiles.create({
      id,
      handle,
      displayName: `Seed ${String(index)}`,
      bio: null,
      location: null,
      website: null,
    });

    ids.push(id);
  }

  say(`${String(actorCount)} actors created (password: ${SEED_PASSWORD})`);

  const edges = ids.flatMap((followerId, index) =>
    Array.from({ length: followCount }, (_unused, offset) => ({
      _id: randomUUID(),
      followerId,
      // Deterministic neighbours rather than random ones: it guarantees no duplicate pair, so
      // the unique index never rejects a batch and the graph is reproducible.
      followingId: ids[(index + offset + 1) % actorCount],
      createdAt: new Date(),
    })),
  );

  await follows.insertMany(edges, { ordered: false });
  say(`${String(edges.length)} follow edges created`);

  const now = Date.now();
  const windowMs = WINDOW_DAYS * 24 * 60 * 60 * 1000;
  let written = 0;

  while (written < postCount) {
    const size = Math.min(BATCH, postCount - written);
    const batch = Array.from({ length: size }, (_unused, offset) => {
      const at = new Date(now - integer(windowMs));
      const id = randomUUID();

      return {
        _id: id,
        authorId: ids[integer(actorCount)],
        text: `Seeded post ${String(written + offset)} — ${randomUUID()}`,
        imageIds: [],
        likeCount: 0,
        commentCount: 0,
        feedKey: compositeSortKey(at, id),
        deletedAt: null,
        createdAt: at,
        updatedAt: at,
      };
    });

    // `timestamps: false` keeps the dates above: Mongoose would otherwise stamp every row with
    // the current time and collapse the whole window into one instant, which is precisely the
    // shape that makes a keyset look fast for the wrong reason.
    await posts.insertMany(batch, { ordered: false, timestamps: false });
    written += size;

    if (written % 25_000 === 0 || written === postCount) {
      say(`${String(written)} / ${String(postCount)} posts`);
    }
  }

  say('recomputing profile counters');

  for (const id of ids) {
    const [postsWritten, followers] = await Promise.all([
      posts.countDocuments({ authorId: id }).exec(),
      follows.countDocuments({ followingId: id }).exec(),
    ]);

    await profiles.setCounters(id, {
      postCount: postsWritten,
      followerCount: followers,
      followingCount: followCount,
    });
  }

  // The exception above is paid for here: if `insertMany` wrote a shape the repository cannot
  // map, the seed fails now rather than on someone's first feed request.
  const sample = await container
    .resolve(POST_REPOSITORY)
    .listByAuthors(ids.slice(0, 10), { cursor: null, limit: 5, direction: 'desc' });

  if (sample.length === 0) {
    throw new Error('the seeded posts are not readable through the repository');
  }

  say(`readback ok — newest seeded post is dated ${sample[0]?.createdAt.toISOString() ?? '?'}`);
  say(`done in ${String(Math.round((Date.now() - started) / 1000))}s`);
  say(`sign in as seed_${suffix}_0@seed.local / ${SEED_PASSWORD}`);
});
