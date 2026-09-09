// Before anything that reaches tsyringe: decorated classes are evaluated at import time, and
// the imports below are hoisted above `./bootstrap`, which is where the polyfill otherwise lands.
import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { mongoConnectionOf } from '@core/database';
import { decodeCursor } from '@core/database/pagination';
import type { CursorQuery } from '@core/database/pagination';
import { FollowService } from '@modules/follow/follow.service';
import { postModel } from '@modules/post/mongo/post.schema';
import { POST_REPOSITORY } from '@modules/post/post.repository';
import { PostService } from '@modules/post/post.service';
import { PROFILE_REPOSITORY } from '@modules/profile/profile.repository';
import { say, withApp } from './bootstrap';

/**
 * Walks one actor's feed page by page and reports how long each page took.
 *
 * The number that matters is not the first page but the last: an offset-based feed degrades
 * linearly because the database has to count and discard everything it skipped, so page 500
 * takes five hundred times what page 1 took. A keyset does not skip — it resumes — so the last
 * page should be indistinguishable from the first. A rising curve here means the cursor is not
 * doing its job, or the index it depends on is missing.
 *
 *   pnpm feed:bench [--handle seed_x_0] [--pages 50] [--limit 20]
 */
await withApp(async ({ container, adapter }) => {
  const { values } = parseArgs({
    options: {
      handle: { type: 'string' },
      pages: { type: 'string', default: '50' },
      limit: { type: 'string', default: '20' },
    },
  });

  const pages = Number(values.pages);
  const limit = Number(values.limit);
  const profiles = container.resolve(PROFILE_REPOSITORY);
  const total = await postModel(mongoConnectionOf(adapter)).estimatedDocumentCount().exec();

  const profile =
    values.handle === undefined
      ? (await profiles.list({ cursor: null, limit: 1, direction: 'desc' }))[0]
      : await profiles.findByHandle(values.handle);

  if (profile === undefined || profile === null) {
    throw new Error('No profile to benchmark — run `pnpm db:seed` first');
  }

  const authorIds = await container.resolve(FollowService).feedAuthorIds(profile.id);
  const repository = container.resolve(POST_REPOSITORY);

  say(`feed of @${profile.handle}: ${String(authorIds.length)} authors, ${String(total)} posts`);
  say('page    rows   ms');

  const timings: number[] = [];
  const seen = new Set<string>();
  let walked = 0;
  let query: CursorQuery = { cursor: null, limit, direction: 'desc' };

  for (let page = 1; page <= pages; page += 1) {
    const at = performance.now();
    const rows = await repository.listByAuthors(authorIds, query);
    const elapsed = performance.now() - at;
    const built = PostService.page(rows, query);

    timings.push(elapsed);
    walked += built.items.length;

    for (const item of built.items) {
      seen.add(item.id);
    }

    say(
      `${String(page).padStart(4)}  ${String(built.items.length).padStart(6)}  ${elapsed.toFixed(1).padStart(6)}`,
    );

    if (!built.hasMore || built.nextCursor === null) {
      say(`feed exhausted after ${String(page)} pages`);
      break;
    }

    // Re-decoding the cursor the API would have returned is the point: the benchmark must walk
    // the same path a client walks, not a shortcut that keeps the last row in memory.
    query = { cursor: decodeCursor(built.nextCursor), limit, direction: 'desc' };
  }

  const first = timings[0] ?? 0;
  const last = timings[timings.length - 1] ?? 0;
  const worst = Math.max(...timings);

  say('');
  // Speed is only half the claim. A cursor that repeats a row is fast for the wrong reason, and
  // over 20 rows the mistake hides — over 25000 it does not.
  say(
    seen.size === walked
      ? `${String(walked)} rows walked, none repeated`
      : `BROKEN CURSOR: ${String(walked)} rows walked but only ${String(seen.size)} distinct`,
  );
  say(`first ${first.toFixed(1)}ms · last ${last.toFixed(1)}ms · worst ${worst.toFixed(1)}ms`);
  say(
    last > first * 5 && last - first > 50
      ? 'REGRESSION: the last page is far slower than the first — check the index and the cursor'
      : 'flat: the last page costs what the first page costs',
  );
});
