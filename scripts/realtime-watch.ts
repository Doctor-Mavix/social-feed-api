import 'reflect-metadata';

import { parseArgs } from 'node:util';

import { io } from 'socket.io-client';

import { env } from '@core/config/env';

/**
 * Connects to the gateway as a real client and prints every event it receives.
 *
 * Realtime is the one part of the API that a request-response test cannot prove: the assertion
 * is that a socket opened by A is woken by something B did. Running this in one terminal while
 * posting or liking from another is what makes the fan-out visible — and, more usefully, what
 * shows the *absence* of an event when a room was never joined.
 *
 *   pnpm realtime:watch --token <access token>
 */
const { values } = parseArgs({
  options: {
    token: { type: 'string' },
    url: { type: 'string', default: `http://127.0.0.1:${String(env.PORT)}` },
  },
});

if (values.token === undefined) {
  throw new Error('Usage: pnpm realtime:watch --token <access token from POST /auth/login>');
}

const EVENTS = [
  'post.created',
  'post.likes-changed',
  'post.commented',
  'follow.created',
  'notification.created',
  'media.processed',
] as const;

const socket = io(values.url, {
  path: env.REALTIME_PATH,
  auth: { token: values.token },
  transports: ['websocket'],
});

function print(label: string, payload: unknown): void {
  process.stdout.write(`${new Date().toISOString()}  ${label}  ${JSON.stringify(payload)}\n`);
}

socket.on('connect', () => {
  print('connected', { id: socket.id, watching: EVENTS });
});

socket.on('connect_error', (error: Error) => {
  print('connect_error', error.message);
});

socket.on('disconnect', (reason: string) => {
  print('disconnected', reason);
});

for (const event of EVENTS) {
  socket.on(event, (payload: unknown) => {
    print(event, payload);
  });
}

process.on('SIGINT', () => {
  socket.close();
  process.exit(0);
});
