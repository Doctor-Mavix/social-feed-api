import request from 'supertest';
import type { DependencyContainer } from 'tsyringe';

import { createApp } from '@app';
import { env } from '@core/config/env';
import { createAppContainer } from '@core/container';
import { TOKENS } from '@core/container/tokens';
import { MongooseAdapter } from '@core/database/mongo/mongoose.adapter';
import type { DatabaseAdapter } from '@core/database/types';
import { logger } from '@core/logger/logger';
import type { AppModule } from '@core/module';
import { registerModules } from '@core/module';
import { RedisConnection } from '@core/redis/redis.client';
import { registerSharedServices } from '@shared/index';
import type { MailMessage, MailerService } from '@shared/messaging/mailer.types';
import type {
  RealtimeEvent,
  RealtimeEvents,
  RealtimeGateway,
} from '@shared/realtime/realtime.types';
import { SHARED_TOKENS } from '@shared/tokens';

const MONGO_URL =
  process.env['TEST_MONGODB_URL'] ?? 'mongodb://127.0.0.1:27019/social?replicaSet=rs0';

const CONNECTION_OPTIONS = { poolSize: 5, connectTimeoutMs: 5_000, slowQueryMs: 1_000, logger };

/**
 * One entry, where the template had two. The suites keep the `describe.each` shape so a second
 * engine could be added back without rewriting them, but this project has a single supported
 * provider and running each assertion twice against it would only cost time.
 */
export const PROVIDERS = [{ name: 'mongodb' }] as const;

export type ProviderName = (typeof PROVIDERS)[number]['name'];

/** Keeps every mail in memory, so a test can read a one-time code out of one. */
export class RecordingMailer implements MailerService {
  readonly sent: MailMessage[] = [];

  send(message: MailMessage): Promise<void> {
    this.sent.push(message);

    return Promise.resolve();
  }

  /** The most recent mail to an address — codes are overwritten, so only the last one works. */
  lastTo(address: string): MailMessage | undefined {
    return this.sent.findLast((message) => message.to === address);
  }
}

export interface EmittedEvent {
  room: string;
  event: string;
  payload: unknown;
}

/**
 * Realtime is disabled under test — sockets need a listening server, which supertest does not
 * provide — but "the event was published to the right room" is a claim the suite must still be
 * able to make. Emitting is synchronous and the room name is the whole design, so recording the
 * call proves everything short of the delivery Socket.IO is responsible for.
 */
export class RecordingRealtime implements RealtimeGateway {
  readonly emitted: EmittedEvent[] = [];

  attach(): Promise<void> {
    return Promise.resolve();
  }

  emitTo<TEvent extends RealtimeEvent>(
    room: string,
    event: TEvent,
    payload: RealtimeEvents[TEvent],
  ): void {
    this.emitted.push({ room, event, payload });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  /** Every payload published for one event name, in order. */
  of(event: RealtimeEvent): EmittedEvent[] {
    return this.emitted.filter((entry) => entry.event === event);
  }
}

export interface Harness {
  adapter: DatabaseAdapter;
  redis: RedisConnection;
  container: DependencyContainer;
  agent: request.Agent;
  mailer: RecordingMailer;
  realtime: RecordingRealtime;
  stop(): Promise<void>;
}

function buildAdapter(): DatabaseAdapter {
  return new MongooseAdapter({ ...CONNECTION_OPTIONS, url: MONGO_URL, autoIndex: true });
}

/**
 * The same wiring the bootstrap performs, minus the HTTP server: the kit is registered first
 * because the modules resolve its tokens as they register.
 */
export async function startHarness(
  name: ProviderName,
  modules: readonly AppModule[],
): Promise<Harness> {
  const adapter = buildAdapter();

  try {
    await adapter.connect();
  } catch (error) {
    throw new Error(
      `Cannot reach the ${name} test database. Start the dev stack with \`docker compose up -d\`.`,
      { cause: error },
    );
  }

  const redis = new RedisConnection({
    url: env.REDIS_URL,
    keyPrefix: `test-${name}:`,
    connectTimeoutMs: 5_000,
    logger,
  });
  await redis.connect();

  const container = createAppContainer();
  container.registerInstance(TOKENS.DatabaseAdapter, adapter);
  container.registerInstance(TOKENS.Redis, redis);

  registerSharedServices(container);

  // Between the two: the kit builds the real mailer, the modules capture whatever is registered
  // when they register. Overriding here is what puts the recorder in front of the notifications.
  const mailer = new RecordingMailer();
  const realtime = new RecordingRealtime();

  container.registerInstance(SHARED_TOKENS.Mailer, mailer);
  container.registerInstance(SHARED_TOKENS.Realtime, realtime);

  registerModules(modules, { container, provider: adapter.provider, adapter });

  return {
    adapter,
    redis,
    container,
    mailer,
    realtime,
    agent: request(createApp({ container, modules })),
    async stop(): Promise<void> {
      await redis.disconnect();
      await adapter.disconnect();
    },
  };
}
