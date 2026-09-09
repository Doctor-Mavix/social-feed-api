import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { mongoConnectionOf } from '@core/database';
import type { Harness } from '@tests/harness';
import { PROVIDERS, startHarness } from '@tests/harness';
import { MongoMediaRepository } from './mongo/media.mongo.repository';
import type { NewMedia } from './media.repository';
import type { Media } from './media.types';

function newMedia(): NewMedia {
  const id = randomUUID();

  return {
    id,
    ownerType: 'test',
    ownerId: randomUUID(),
    filename: 'pixel.png',
    mimeType: 'image/png',
    size: 68,
    storageKey: `test/${id}.png`,
  };
}

/**
 * A media row is created before its variants exist — processing runs on the queue — and the
 * upload reply is rendered from that pending row. Mongoose's default `minimize` strips an empty
 * object before writing, so the row came back with no `variants` field at all and the reply
 * crashed on `Object.entries(undefined)`.
 *
 * The guard lives here rather than on the HTTP route because the route only fails when it beats
 * the processing job, which it usually loses. At this level there is no race: the row is read in
 * exactly the state the reply reads it in.
 */
describe.each(PROVIDERS)('media rows on $name', () => {
  let harness: Harness;
  let repository: MongoMediaRepository;
  const created: string[] = [];

  beforeAll(async () => {
    harness = await startHarness('mongodb', []);
    repository = new MongoMediaRepository(mongoConnectionOf(harness.adapter));
  });

  afterAll(async () => {
    await Promise.all(created.map(async (id) => repository.remove(id)));
    await harness.stop();
  });

  async function persist(): Promise<Media> {
    const data = newMedia();
    const media = await repository.create(data);
    created.push(data.id);

    return media;
  }

  it('stores the empty variants map instead of dropping the field', async () => {
    const media = await persist();
    const stored = await mongoConnectionOf(harness.adapter)
      .collection('media')
      .findOne<{ variants?: unknown }>({ _id: media.id as never });

    expect(stored).not.toBeNull();
    expect(stored).toHaveProperty('variants');
    expect(stored?.variants).toEqual({});
  });

  it('reads a pending row back with a map, never undefined', async () => {
    const media = await persist();

    expect(media.variants).toEqual({});
    expect((await repository.findById(media.id))?.variants).toEqual({});
    expect((await repository.findManyByIds([media.id]))[0]?.variants).toEqual({});
  });
});
