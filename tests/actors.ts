import { randomUUID } from 'node:crypto';

import type { DependencyContainer } from 'tsyringe';

import { MongooseAdapter } from '@core/database/mongo/mongoose.adapter';
import type { DatabaseAdapter } from '@core/database/types';
import { AUTH_REPOSITORY } from '@modules/auth/auth.repository';
import type { ActorStatus, ActorType } from '@modules/auth/auth.types';
import { JwtService } from '@modules/auth/jwt.service';
import { PasswordService } from '@modules/auth/password.service';
import { SessionService } from '@modules/auth/session.service';

/** Long enough for the default policy, and the same everywhere so a failure is easy to read. */
export const TEST_PASSWORD = 'correct-horse-battery-staple';

export interface SeedActorOptions {
  actorType?: ActorType;
  email?: string;
  password?: string;
  displayName?: string;
  roles?: readonly string[];
  permissions?: readonly string[];
  status?: ActorStatus;
}

export interface SeededActor {
  id: string;
  actorType: ActorType;
  email: string;
  password: string;
  accessToken: string;
  refreshToken: string;
  sessionId: string;
}

export function bearer(token: string): string {
  return `Bearer ${token}`;
}

export function testEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@orangcode.test`;
}

/**
 * Creates an actor and signs it in without going through `/auth/login`: a suite that only needs
 * a bearer token to reach a guarded endpoint should not have its setup fail because of the flow
 * it is not testing.
 */
export async function seedActor(
  container: DependencyContainer,
  options: SeedActorOptions = {},
): Promise<SeededActor> {
  const repository = container.resolve(AUTH_REPOSITORY);
  const passwords = container.resolve(PasswordService);
  const sessions = container.resolve(SessionService);
  const jwt = container.resolve(JwtService);

  const password = options.password ?? TEST_PASSWORD;
  const created = await repository.createActor({
    id: randomUUID(),
    actorType: options.actorType ?? 'user',
    email: options.email ?? testEmail('actor'),
    displayName: options.displayName ?? 'Test actor',
    passwordHash: await passwords.hash(password),
    phone: null,
    roles: options.roles ?? [],
    permissions: options.permissions ?? [],
    status: options.status ?? 'active',
  });

  const { actor } = created;
  const issued = await sessions.issue(actor.id, actor.actorType, { ip: null, userAgent: null });

  return {
    id: actor.id,
    actorType: actor.actorType,
    email: actor.email,
    password,
    sessionId: issued.session.id,
    refreshToken: issued.refreshToken,
    accessToken: await jwt.sign({
      actorId: actor.id,
      actorType: actor.actorType,
      roles: actor.roles,
      permissions: actor.permissions,
      sessionId: issued.session.id,
    }),
  };
}

/** Actors are never soft-deleted, so a suite has to remove its own rows on the way out. */
export async function purgeActors(
  adapter: DatabaseAdapter,
  actorIds: readonly string[],
): Promise<void> {
  if (actorIds.length === 0) {
    return;
  }

  const ids = [...actorIds];

  if (adapter instanceof MongooseAdapter) {
    const { connection } = adapter;

    await connection.collection('auth_audit').deleteMany({ actorId: { $in: ids } });
    await connection.collection('notifications').deleteMany({ actorId: { $in: ids } });

    // The social collections key on the actor id under different names. Soft deletion is not
    // enough here: a handle is unique, so a suite that left its profiles behind would make the
    // next run fail on a name it can no longer see.
    await connection.collection('comments').deleteMany({ authorId: { $in: ids } });
    await connection.collection('likes').deleteMany({ actorId: { $in: ids } });
    await connection.collection('posts').deleteMany({ authorId: { $in: ids } });
    await connection
      .collection('follows')
      .deleteMany({ $or: [{ followerId: { $in: ids } }, { followingId: { $in: ids } }] });
    await connection.collection<{ _id: string }>('profiles').deleteMany({ _id: { $in: ids } });
    // Typed explicitly: the driver assumes an ObjectId `_id`, and these documents key on a uuid.
    await connection.collection<{ _id: string }>('actors').deleteMany({ _id: { $in: ids } });
  }
}
