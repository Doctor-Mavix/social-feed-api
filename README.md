# Social — timeline API

A social network backend: profiles, a follow graph, posts with images, comments, likes and a
home timeline. Built on the OrangCode Express 5 + TypeScript template, with **MongoDB as the
only engine** — the template ships two, this project narrowed `DB_PROVIDER` to one and says why.

The feed is the point of the exercise. It is computed on read, over a follow graph, and it stays
flat: on a database of **100 000 posts**, page 600 costs what page 1 costs.

---

## Table of contents

- [What is in the box](#what-is-in-the-box)
- [Requirements](#requirements)
- [Installation](#installation)
- [Running it](#running-it)
- [The social journey, in curl](#the-social-journey-in-curl)
- [The API](#the-api)
- [How the feed stays flat](#how-the-feed-stays-flat)
- [How likes are counted](#how-likes-are-counted)
- [Realtime](#realtime)
- [Images](#images)
- [Optional authentication](#optional-authentication)
- [Project structure](#project-structure)
- [Configuration](#configuration)
- [Testing](#testing)
- [Scripts](#scripts)
- [Security summary](#security-summary)

---

## What is in the box

| Module          | What it owns                                                                      |
| --------------- | --------------------------------------------------------------------------------- |
| `auth`          | Register, verify, login, TOTP MFA, refresh rotation, sessions, password reset     |
| `profile`       | One profile per account: handle, display name, bio, avatar, denormalised counters |
| `follow`        | The directed graph, its two paginated sides, and the socket rooms it implies      |
| `post`          | Text + up to four images, likes, cursor pagination by author                      |
| `comment`       | A flat thread per post, with the post's `commentCount` kept in step               |
| `feed`          | The home timeline: fan-out on read over the follow graph                          |
| `health`        | `/health` and `/ready`, mounted at the root, outside the API prefix               |
| `notifications` | Shared kit module: follow, like and comment notifications, read state             |

Everything else — media, storage, queue, cache, locks, realtime, OTP, i18n — comes from the
shared services kit in `src/shared/`.

---

## Requirements

- **Node.js >= 22** — pinned in `.nvmrc`, `nvm use` picks it up.
- **pnpm >= 10** — `corepack enable` is enough.
- **Docker** with Compose v2, for the local stack.

The stack uses non-default ports on purpose, so it never collides with a local server:

| Service | Port(s)     | Notes                                        |
| ------- | ----------- | -------------------------------------------- |
| MongoDB | `27019`     | **replica set `rs0`** — not optional         |
| Redis   | `6382`      | rate limit, like counters, locks, socket bus |
| MinIO   | `9020/9021` | console at http://localhost:9021             |
| Mailpit | `1027/8027` | web interface at http://localhost:8027       |

The replica set is a hard requirement: transactions and change streams both need one, and a
standalone `mongod` fails at boot rather than halfway through a write.

---

## Installation

```bash
nvm use
pnpm install
cp .env.example .env
```

Three secrets have no default and the process refuses to boot without them. They must differ
from each other:

```bash
# once per variable: JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, MFA_SECRET_KEY
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

Then bring the stack up and create the indexes:

```bash
docker compose up -d
pnpm db:indexes
```

`db:indexes` is worth running explicitly at least once. In development Mongoose builds indexes
on the fly, so a missing one is invisible; in production `autoIndex` is off, and a feed without
`{ authorId: 1, feedKey: -1 }` is a collection scan.

---

## Running it

```bash
pnpm dev          # tsx watch, reloads on save
pnpm build && pnpm start
```

- API: `http://localhost:3000/api/v1`
- Reference: `http://localhost:3000/docs` — Swagger UI, generated from the routes and their Zod
  schemas at boot, so it cannot drift from the code
- Health: `http://localhost:3000/health` — **at the root, not under the API prefix**, because a
  load balancer probe should not depend on the API version

---

## The social journey, in curl

```bash
API=http://localhost:3000/api/v1

# 1. An account
curl -s -X POST $API/auth/register -H 'content-type: application/json' \
  -d '{"email":"alice@social.local","password":"correct horse battery","displayName":"Alice"}'
# actorType defaults to "user"; `agent` is the moderation type pnpm admin:create uses.
# The verification code is in Mailpit: http://localhost:8027
curl -s -X POST $API/auth/verify-email -H 'content-type: application/json' \
  -d '{"email":"alice@social.local","code":"123456"}'

curl -s -X POST $API/auth/login -H 'content-type: application/json' \
  -d '{"email":"alice@social.local","password":"correct horse battery"}'
# -> data.accessToken ; export ALICE=…

# 2. A profile. An account without one can read, but cannot post or hold a timeline.
curl -s -X POST $API/profiles -H "authorization: Bearer $ALICE" \
  -H 'content-type: application/json' -d '{"handle":"alice","displayName":"Alice"}'

curl -s -X POST $API/profiles/me/avatar -H "authorization: Bearer $ALICE" \
  -F avatar=@portrait.png
# -> 200 with the profile, avatar: { original, thumb, medium }, presigned

# 3. Follow
curl -s -X POST $API/profiles/bob/follow -H "authorization: Bearer $ALICE"
# -> 200 { following: true, followerCount: 1 }

# 4. Post, with pictures
curl -s -X POST $API/posts -H "authorization: Bearer $ALICE" \
  -F text='Cotonou at golden hour' -F images=@beach.jpg
# -> 201 { id, text, author, images: [ {original,thumb,medium} ], likeCount: 0, liked: false }

# 5. The timeline: Alice's own posts plus everyone she follows
curl -s "$API/feed?limit=20" -H "authorization: Bearer $ALICE"
# -> { data: [...], meta: { nextCursor: "eyJ2Ijoi…", hasMore: true } }
curl -s "$API/feed?limit=20&cursor=eyJ2Ijoi…" -H "authorization: Bearer $ALICE"

# 6. Like and comment
curl -s -X POST $API/posts/$POST_ID/like -H "authorization: Bearer $ALICE"
# -> 200 { liked: true, likeCount: 1 }   and a post.likes-changed frame on the socket
curl -s -X POST $API/posts/$POST_ID/comments -H "authorization: Bearer $ALICE" \
  -H 'content-type: application/json' -d '{"text":"Beautiful"}'

# 7. Reading a post signed out still works — `liked` is null, not false
curl -s $API/posts/$POST_ID
```

---

## The API

Every route below is prefixed with `API_PREFIX` (`/api/v1` by default). A route is protected
unless it is listed as public.

### Public — no token

| Method | Path                           | What it does                                     |
| ------ | ------------------------------ | ------------------------------------------------ |
| `POST` | `/auth/register`               | Creates an account, mails a verification code    |
| `POST` | `/auth/verify-email`           | Consumes the code — `204`                        |
| `POST` | `/auth/login`                  | `200` with tokens, or an MFA challenge           |
| `POST` | `/auth/mfa/verify`             | Answers the challenge with a TOTP code           |
| `POST` | `/auth/refresh`                | Rotates the refresh token                        |
| `POST` | `/auth/password-reset`         | `202`, always — an unknown address is not leaked |
| `POST` | `/auth/password-reset/confirm` | `204`                                            |
| `GET`  | `/profiles`                    | Directory, cursor paginated                      |
| `GET`  | `/profiles/:handle`            | One profile                                      |
| `GET`  | `/profiles/:handle/followers`  | Cursor paginated                                 |
| `GET`  | `/profiles/:handle/following`  | Cursor paginated                                 |
| `GET`  | `/posts/:id/comments`          | The thread, cursor paginated                     |

### Optional token — public, but personalised when signed in

| Method | Path                      | What changes with a token                      |
| ------ | ------------------------- | ---------------------------------------------- |
| `GET`  | `/posts/:id`              | `liked` becomes `true`/`false` instead of null |
| `GET`  | `/profiles/:handle/posts` | idem, for every post on the page               |

### Authenticated

| Method   | Path                          | What it does                                     |
| -------- | ----------------------------- | ------------------------------------------------ |
| `POST`   | `/profiles`                   | Creates the caller's profile — `201`             |
| `GET`    | `/profiles/me`                | The caller's profile                             |
| `PATCH`  | `/profiles/me`                | Display name, bio, location, website             |
| `POST`   | `/profiles/me/avatar`         | Multipart field **`avatar`** — `200`, not `201`  |
| `POST`   | `/profiles/:handle/follow`    | Idempotent — `200 { following, followerCount }`  |
| `DELETE` | `/profiles/:handle/follow`    | Idempotent                                       |
| `GET`    | `/feed`                       | The home timeline, cursor paginated              |
| `POST`   | `/posts`                      | Multipart: `text` + up to 4 **`images`** — `201` |
| `DELETE` | `/posts/:id`                  | Author only — `204`                              |
| `POST`   | `/posts/:id/like`             | Idempotent — `200 { liked, likeCount }`          |
| `DELETE` | `/posts/:id/like`             | Idempotent                                       |
| `POST`   | `/posts/:id/comments`         | `201`                                            |
| `DELETE` | `/comments/:id`               | Comment author or post author — `204`            |
| `GET`    | `/auth/me`                    | The principal behind the token                   |
| `POST`   | `/auth/logout`                | `204` — revokes this session only                |
| `POST`   | `/auth/logout-all`            | `200` — revokes every session                    |
| `POST`   | `/auth/change-password`       | `204` — and revokes the other sessions           |
| `GET`    | `/auth/sessions`              | Every live session for this account              |
| `DELETE` | `/auth/sessions/:id`          | Signs one device out                             |
| `POST`   | `/auth/mfa/setup`             | `200` with the otpauth URI and a QR code         |
| `POST`   | `/auth/mfa/confirm`           | `200` with the recovery codes                    |
| `POST`   | `/auth/mfa/disable`           | `204`                                            |
| `GET`    | `/notifications`              | Cursor paginated                                 |
| `GET`    | `/notifications/unread-count` | The badge                                        |
| `POST`   | `/notifications/:id/read`     | Marks one read                                   |
| `POST`   | `/notifications/read-all`     | Marks the lot                                    |

Every list answers the same envelope:

```json
{
  "data": [],
  "meta": {
    "nextCursor": "eyJ2IjoiMjAyNi0wOC0yMFQxMDoxMjozMS4wMDBaIiwiaSI6IjhkMmYifQ",
    "hasMore": true
  }
}
```

There is **no `page=` parameter anywhere**. A cursor is a base64url `{v, i}` pair — the sort
value and the tie-breaking id — and it is the only way to walk a list.

---

## How the feed stays flat

The timeline is **fan-out on read**: the posts of the accounts you follow are fetched when you
ask for them, from one query, and nothing is duplicated per follower. The alternative — a
materialised timeline row per follower per post — makes the read trivial but turns one publish
by a popular account into a million writes, and a new follow into a backfill.

So the read has to be good. It is one query:

```
{ authorId: { $in: [ …the accounts you follow, plus you… ] },  feedKey: { $lt: <cursor> } }
sort: { feedKey: -1 }
```

against the index `{ authorId: 1, feedKey: -1 }`. MongoDB walks one range per author and merges
them (`SORT_MERGE`), so a page costs the page size, not the depth.

**`feedKey` is the whole trick, and it exists because the textbook keyset does not survive an
`$in`.** The usual keyset filter is a disjunction:

```
$or: [ { createdAt: { $lt: v } }, { createdAt: v, _id: { $lt: i } } ]
```

That is correct, and it is fast on its own. Combined with an `$in`, it is not: the planner
cannot distribute the two `$or` branches across the `$in` bounds, so it unions the scans and
sorts the union **in memory**. Measured on this database, one 20-row page at depth 12 000:

| Plan                | Index keys examined | Docs examined | Time   | Sort            |
| ------------------- | ------------------- | ------------- | ------ | --------------- |
| `$in` alone         | 71                  | 21            | 2 ms   | `SORT_MERGE`    |
| `$or` alone         | 21                  | 21            | 1 ms   | `SORT_MERGE`    |
| `$in` **and** `$or` | **13 706**          | 13 554        | 335 ms | blocking `SORT` |

The fix is to stop asking for a tuple comparison. `feedKey` is `createdAt` and `_id` flattened
into one lexicographically comparable string (`2026-08-20T10:12:31.000Z|8d2f-…`), stored on the
document and indexed. The page filter becomes a single range bound, which the planner _does_
push into every branch of the `$in`. The ISO-8601 timestamp is fixed width, which is what makes
the string order equal the pair order.

The domain type, the views and the public cursor format are unchanged — `feedKey` never leaves
the storage layer. See `src/core/database/mongo/keyset.ts` (`compositeSortKey`,
`compositeKeysetFilter`) and its unit suite.

**Measured**, on 100 008 posts, 51 followed authors, 600 pages of 20:

```
12000 rows walked, none repeated
first 16.2ms · last 2.9ms · worst 43.1ms
flat: the last page costs what the first page costs
```

Reproduce it:

```bash
pnpm db:seed --actors 200 --posts 100000 --follows 50
pnpm feed:bench --pages 600
```

The bench asserts two things, not one. Speed is only half the claim: a cursor that repeats a row
is fast for the wrong reason, so every id is collected and the walk fails loudly if the number of
distinct ids does not equal the number of rows.

**The stated limit.** `FEED_FANOUT_CAP = 1000`. An account following more than a thousand others
has its feed computed from the thousand most recent follows. Fan-out on read does not survive an
unbounded `$in`, and a constant that says so is better than a discovery in production.

---

## How likes are counted

MongoDB stays the source of truth: the like edges are there, and so is a durable `likeCount` on
the post. But a feed page asks for twenty counts at once, and serving those from the durable
copy puts a write-heavy collection on the read path of every scroll.

So the read path is Redis:

- `INCRBY` on like and unlike, so concurrent likes **add up** instead of overwriting each other
  — which a read-modify-write in the application could not guarantee.
- `MGET` for a whole page: one round trip for twenty counters.
- A missing key is seeded from the durable copy with `SET … NX`, so a cold Redis costs one extra
  write, not one extra query — and `NX` means a live counter is never clobbered by a stale copy.
- A seven-day TTL. The counters are re-derivable from the edges, so letting them expire is safe
  and keeps the memory bounded to the posts people are actually looking at.

Losing Redis loses no data: the next read falls back to the durable copy and re-seeds.

---

## Realtime

Socket.IO, with the Redis adapter, so a broadcast survives several app instances.

| Event                  | Room                 | Payload                                           |
| ---------------------- | -------------------- | ------------------------------------------------- |
| `post.created`         | `module:author:<id>` | Enough to render a feed card without a round trip |
| `post.likes-changed`   | `module:post:<id>`   | The **counter**, not the increment                |
| `post.commented`       | `module:post:<id>`   | The new comment                                   |
| `notification.created` | `actor:<id>`         | The notification                                  |

Two decisions worth naming:

**`post.created` is published once, to the author's room, not once per follower.** A socket joins
the rooms of the accounts it follows at connect time — that is `FollowRoomSource`, the kit's
`SocketRoomSource` extension point. Without it, one post by a popular account would cost one
publish per follower, which is exactly the fan-out the feed exists to avoid. The price: following
someone new only takes effect on the next connection, which is acceptable because the REST
response already told the client about the follow.

**`post.likes-changed` carries the total, not a delta.** A client that missed a frame converges
on the right number instead of accumulating increments forever.

Watch it live:

```bash
pnpm realtime:watch
```

---

## Images

Uploads go to S3-compatible storage (MinIO locally). `sharp` derives `thumb` and `medium`
variants **on the queue**, not inline: doing it in the request would hold a connection open and
make the upload look broken on a slow link.

That means a media row exists, briefly, with no variants yet — and the upload response is
rendered from exactly that row. It has to be a valid empty map, which is why the media schema
sets `minimize: false`. Mongoose's default strips an empty object before writing it, so
`variants: {}` was never persisted and the reply crashed on a field the type promised was always
there. It is guarded by `src/shared/media/media.integration.test.ts`, at the repository level:
the HTTP route only fails when it beats the processing job, which is a race a test usually wins
for the wrong reason.

Clients never receive a bucket path. Every URL is presigned, with a lifetime set by
`S3_URL_EXPIRY_SECONDS`.

---

## Optional authentication

The template had two access modes: guarded, or `@Public()`. `@Public()` skips the guard
entirely, so the handler never learns who is calling — and a timeline card that has to say
whether _you_ liked a post could not be public.

This project added a third to the core kit:

```ts
@Get('/:id')
@OptionalAuth()
async byId(req: TypedRequest<unknown, unknown, { id: string }>): Promise<PostView> {}
```

The route is open, but the guard still runs and identifies the caller. An absent or invalid
token renders the page logged-out; it never `401`s a public URL. In the generated OpenAPI
document it comes out as `security: [{}, { bearerAuth: [] }]` — "a token is accepted, not
required".

The visible consequence is that `liked` is a **tri-state**: `true`, `false`, or `null` for an
anonymous reader. "Not liked" and "we do not know" are different answers, and collapsing them
into `false` is how a UI ends up showing an empty heart to someone who is not signed in.

---

## Project structure

```
src/
  core/                 the framework — decorators, DI, errors, config, openapi, pagination
    database/mongo/
      keyset.ts         keyset + composite-key pagination helpers
  modules/
    auth/               register, login, MFA, sessions, guard
    profile/
    follow/
      follow.rooms.ts   the SocketRoomSource that makes the fan-out cheap
    post/
      like-counter.ts   the Redis read path for likes
      mongo/            schema + repository — the only place feedKey exists
    comment/
    feed/
    health/
  shared/               the services kit: media, storage, queue, cache, lock, realtime, i18n…
tests/                  harness, seeded actors, setup
scripts/                seed, indexes, bench, admin, realtime watcher
```

Each module is a folder with a `*.module.ts`, and `MODULES_ENABLED` decides which ones mount.
A module never imports a concrete implementation of anything shared — it resolves a token — so
it can be lifted into its own service without rewriting it.

**No Mongoose type crosses a repository boundary.** A service sees `Post`, never
`PostDocument`; that is the line that keeps the modules portable, and it is why `feedKey` is
invisible above `post.mongo.repository.ts`.

---

## Configuration

Every variable is validated at boot by a Zod schema. An invalid one stops the process — there is
no "start and fail on the first request". `.env.example` documents all of them; the ones that
matter most here:

| Variable                 | Note                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| `DB_PROVIDER`            | `mongodb`, and only that — the choice is documented, not offered |
| `DATABASE_URL`           | Must point at a **replica set**                                  |
| `JWT_ACCESS_SECRET`      | >= 32 chars, no default                                          |
| `JWT_REFRESH_SECRET`     | >= 32 chars, must differ from the access secret                  |
| `MFA_SECRET_KEY`         | Encrypts TOTP secrets at rest; must differ from both             |
| `MEDIA_MAX_UPLOAD_BYTES` | 10 MB by default                                                 |
| `QUEUE_ENABLED`          | `false` runs jobs inline — fine in tests, wrong in production    |
| `CORS_ORIGINS`           | Required in production, where `*` is refused                     |
| `DOCS_PASSWORD`          | An open reference is refused in production                       |

---

## Testing

```bash
pnpm test              # everything
pnpm test:unit         # no database needed
pnpm test:integration  # needs docker compose up -d
pnpm test:coverage
```

The integration suites run against the real stack — a real replica set, a real Redis, real
argon2 hashing, real image processing. Nothing that matters is mocked, on the principle that a
mock that agrees with your assumptions only proves your assumptions.

Three invariants are guarded rather than assumed:

- **The cursor never repeats or skips a row.** The feed suite walks a backfilled timeline to
  exhaustion and compares the set of ids to the count.
- **A pending media row reads back as an empty map, never `undefined`.**
  `shared/media/media.integration.test.ts`, at the repository level, because the HTTP path is a
  race.
- **An optional route identifies its caller.** `core/decorators/registry.test.ts` asserts both
  halves: a token yields the principal, no token yields `null` rather than a 401.

Compiling proves nothing. Every route in the table above has been called for real against a
running server.

---

## Scripts

| Command               | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `pnpm dev`            | Watch mode                                                           |
| `pnpm db:indexes`     | Syncs every index — run it before benchmarking anything              |
| `pnpm db:seed`        | `--actors 200 --posts 100000 --follows 50` (~16 s for 100k)          |
| `pnpm feed:bench`     | `--handle … --pages 600 --limit 20` — timings **and** a repeat check |
| `pnpm admin:create`   | An account with the `admin` role                                     |
| `pnpm realtime:watch` | Prints every frame the socket receives                               |
| `pnpm typecheck`      | `tsc --noEmit`                                                       |
| `pnpm lint`           | Type-aware ESLint                                                    |
| `pnpm format`         | Prettier                                                             |

---

## Security summary

- **Passwords** — argon2id, cost from the environment; raising it does not invalidate old hashes.
- **Tokens** — 15-minute access token, rotating refresh token with reuse detection; a replayed
  refresh token revokes the whole family.
- **MFA** — TOTP, secrets encrypted at rest under a key that is not the JWT key.
- **Login throttling** — per account _and_ per IP, doubling delay, counted in Redis so the quota
  is shared across instances.
- **Rate limiting** — global, in Redis, same reason.
- **Authorisation is deny-by-default** — a route without `@Public()` or `@OptionalAuth()` is
  guarded, so forgetting a decorator locks a route rather than opening one.
- **Ownership is checked in the service, not the controller** — deleting a post or a comment
  verifies the actor, and the check lives where a second caller cannot bypass it.
- **Validation** — every body, query and param goes through Zod before a handler sees it; the
  same schema generates the OpenAPI document.
- **Uploads** — MIME and size checked, images re-encoded by `sharp` (which strips EXIF, and with
  it the GPS coordinates in a phone photo), stored under generated keys, served presigned.
- **Errors** — one envelope, no stack traces off the machine, one request id per log line.

---

## The OrangCode TypeScript family

- [orangcode-express-ts](https://github.com/GITHUB_USER/orangcode-express-ts) — the template: Express 5 + strict TypeScript, Postgres (Prisma) or MongoDB (Mongoose)
- [orangcode-cli](https://github.com/GITHUB_USER/orangcode-cli) — the generator: blueprint → module, byte-identical regeneration
- [mobile-money-ledger-api](https://github.com/GITHUB_USER/mobile-money-ledger-api) — validation project: wallets, transfers, double-entry ledger (Postgres)
- **social-feed-api** (this repository) — validation project: follow graph and home timeline (MongoDB)
- [ecommerce-orders-api](https://github.com/GITHUB_USER/ecommerce-orders-api) — validation project: catalogue, cart, orders (Postgres)

## How I built this with Claude Code

This repository is part of the TypeScript redesign of [OrangCode](https://orangcode.com), the
low-code platform I co-founded. I designed the architecture and directed the work; Claude Code
(Opus and Fable models) wrote most of the code, step by step, under these rules:

- **Spec first.** Each step started from a written plan with acceptance criteria. I reviewed and
  approved the plan before any code was written.
- **Tests first, and seen red.** A new test had to fail before the fix that makes it pass.
  Important guarantees were also checked by _sabotage_: remove the protection on purpose and
  confirm that a test fails.
- **One session log for several models.** A numbered set of design notes and a session log let a
  new session, or a different model, continue the work without losing context.
- **Human review of every diff.** I read each change and asked for corrections before it was
  committed.
- **Quality gates on every step:** strict TypeScript, type-aware ESLint, Prettier, and the full
  test suite.
