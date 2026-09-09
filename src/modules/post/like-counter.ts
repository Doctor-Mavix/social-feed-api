import type { RedisConnection } from '@core/redis/redis.client';

const KEY = 'likes:post:';
/**
 * Counters are re-derivable from the like edges, so letting them fall out of Redis is safe and
 * keeps the memory bounded to the posts people are actually looking at. A week is long enough
 * that a popular post never has to be recounted during its life on the feed.
 */
const TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * The like count read path.
 *
 * MongoDB stays the source of truth — the edges are there, and so is a durable copy of the
 * total — but a feed page asks for twenty counts at once, and doing that against the durable
 * copy means the write-heavy collection is also on the read path of every scroll. Redis answers
 * a whole page with one `MGET`, and `INCRBY` makes concurrent likes add up instead of
 * overwriting each other, which a read-modify-write in the application could not.
 */
export class LikeCounter {
  constructor(private readonly redis: RedisConnection) {}

  /** Applies a delta and returns the new total, refreshing the expiry as a side effect. */
  async adjust(postId: string, delta: number): Promise<number> {
    const key = KEY + postId;
    const total = await this.redis.client.incrby(key, delta);

    await this.redis.client.expire(key, TTL_SECONDS);

    return total;
  }

  /**
   * Counts for a whole page. Missing keys come back as null and are seeded from the durable
   * copy the caller already holds, so a cold Redis costs one extra write, not one extra query.
   */
  async many(posts: readonly { id: string; likeCount: number }[]): Promise<Map<string, number>> {
    if (posts.length === 0) {
      return new Map();
    }

    const raw = await this.redis.client.mget(posts.map((post) => KEY + post.id));
    const counts = new Map<string, number>();
    const missing: { id: string; likeCount: number }[] = [];

    posts.forEach((post, index) => {
      const value = raw[index];
      const parsed = value === null || value === undefined ? Number.NaN : Number(value);

      if (Number.isNaN(parsed)) {
        counts.set(post.id, post.likeCount);
        missing.push(post);
      } else {
        counts.set(post.id, parsed);
      }
    });

    if (missing.length > 0) {
      await this.seed(missing);
    }

    return counts;
  }

  async seed(posts: readonly { id: string; likeCount: number }[]): Promise<void> {
    const pipeline = this.redis.client.pipeline();

    for (const post of posts) {
      // `NX`: never clobber a live counter with a durable copy that a concurrent `INCRBY`
      // has already moved past.
      pipeline.set(KEY + post.id, String(post.likeCount), 'EX', TTL_SECONDS, 'NX');
    }

    await pipeline.exec();
  }

  async forget(postId: string): Promise<void> {
    await this.redis.client.del(KEY + postId);
  }
}
