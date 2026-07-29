# CLAUDE.md - working on rsmq

`rsmq` (Redis Simple Message Queue) is a published npm package with a lot of users on `0.x`.
This branch (`1.x`) is the TypeScript rewrite. Compatibility is still the top priority: the public
API, the Redis key layout, the message id format and the error messages are contracts - a `1.x` and
a `0.x` process must be able to work on the same queues. Tests assert the exact error strings.

The `0.x` line lives on `develop` / `master`. Do not port `1.x` changes back to it.

CI is a single GitHub Actions workflow, [`.github/workflows/test.yml`](.github/workflows/test.yml):
`npm test` against a Redis service container on every push to `develop` and `1.x` and on every pull
request to `develop` or `master`, plus a second job that sends and receives a message with the built
package on Node 20, the oldest version `engines` allows. It does not run on other branches, so
`npm test` on your machine is still the gate while you work.

## Prerequisites

* **Node**: use the version in `.nvmrc` -> `nvm use` (currently 24.18.0). Node >= 22.6 is needed for
  the tests, because they are TypeScript run directly by node's type stripping. The shipped package
  requires Node >= 20.
* **A local Redis** on `127.0.0.1:6379` - the tests are integration tests, there are no mocks.
  `brew services start redis` or `redis-server`. Check with `redis-cli ping` -> `PONG`.
* The tests also expect **nothing** to listen on port `6399` (used to test connection refusal).

## Build and test

```bash
nvm use
npm install
npm test          # pretest builds and type-checks everything, then runs the suite
```

`npm test` runs, via `pretest`:

1. `npm run build` - `tsc -p tsconfig.build.json` compiles `src/*.ts` -> `dist/` (JS + `.d.ts`).
   `dist/` is git-ignored and rebuilt from scratch every time (`prebuild` deletes it).
2. `npm run typecheck` - `tsc -p tsconfig.json` type-checks `src/` **and** the tests. No emit.
3. `npm run test:types` - `tsc -p ./test/typings` type-checks the generated `dist/index.d.ts`
   against `test/typings/consumer.ts` with `"types": []`, i.e. it verifies the typings work
   **without** `@types/node` or the `redis` typings in a consuming project.
4. `node --test --test-concurrency=1 "test/*.test.mts"`.

Expected result: **105 passing**. The suite talks to the real Redis and creates/deletes the queues
`test1`, `test2`, `test3promises` and `test4unicode` in the `rsmq:` namespace of db 0, plus a few
short-lived queues in `testns:`. `--test-concurrency=1` matters: the tests share Redis state and run
in order.

## Where the code lives

| File | Role |
|:--|:--|
| `src/index.ts` | The `RedisSMQ` class: public API, validation order, queue logic. |
| `src/client.ts` | `RedisClientWrapper` - the only place that talks to `node-redis`. |
| `src/scripts.ts` | The three LUA scripts. Unchanged since `0.x`, they define the queue semantics. |
| `src/validate.ts` | Option validation. Same rules and messages as `0.x`. |
| `src/errors.ts` | Error names and messages. **Contract** - do not reword. |
| `src/types.ts` | The public option / result interfaces. |
| `src/emitter.ts` | Typed `EventEmitter` facade so the typings do not need `@types/node`. |
| `dist/` | Build output, git-ignored, shipped. Never edit - run `npm run build`. |
| `test/*.test.mts` | The tests (`node:test`). TypeScript, run directly, no build step. |
| `test/typings/` | Compile-only consumer check for the generated `dist/index.d.ts`. |
| `_docs/redis_data_structure.md` | The Redis key layout. Keep it correct, it is the data contract. |
| `ai/` | Rewrite plans and progress notes (git-ignored, local only). |

`package.json` `files` ships exactly `dist`.

## Conventions

* **Tabs** for indentation, double quotes, no semicolon religion - match the surrounding code.
* `redis` is the only runtime dependency. Do not add more.
* Every public method takes an optional callback and returns a promise when it is left out. The
  pattern is: a private `async _method()` with the real work, a public `method(options, cb?)` that
  hands it to `respond()`, and a public `methodAsync(options)` that returns the promise. A new public
  method needs all three, plus an entry in `PUBLIC_METHODS` (that loop binds the methods to the
  instance, so `async.map(queue, rsmq.sendMessage)` style usage keeps working).
* The typings are **generated**. Never hand-edit anything in `dist/`; change `src/types.ts` or the
  method signatures instead.
* New public method or option -> update `README.md`, `test/typings/consumer.ts` and `CHANGELOG.md`
  in the same change.
* LUA scripts are loaded lazily (`_loadScripts`) and cached by sha1 in a promise. Every command
  awaits that promise, and a `NOSCRIPT` reply reloads them once and retries. The `scriptload:*`
  events are only kept for `0.x` compatibility - do not build on them.

## Redis client version

`1.x` depends on `redis@^6`. `RedisClientWrapper` only uses `sendCommand`, `multi().addCommand()`,
`connect`, `quit`, `destroy`, `isOpen` and `isReady`, so a client that a user hands in via
`options.client` also works when it comes from `redis@4` or `redis@5`. Keep it that way: no typed
per-command helpers (`client.hSet(...)`), because their reply shapes change between client versions
and the raw replies are what this code is written against.

Two `node-redis` behaviors the wrapper exists for - do not "simplify" them away:

* **`client.destroy()` while a connect attempt is in flight leaks the socket.** `connect()` finishes
  opening it right afterwards, the client then considers itself closed and neither `destroy()` nor
  `close()` can be called again ("The client is closed"). The socket stays open and the node process
  never exits. `quit()` therefore waits for an in-flight connect attempt first.
* **`connect()` never settles when the server is unreachable** - the reconnect strategy keeps
  retrying and only `error` events show up. Every wait on it is raced against the first error event
  and a `quit()`, otherwise a promise dangles forever.

## Releasing

1. `npm test` must be green, `npm audit --omit=dev` must be clean.
2. Bump `version` in `package.json` and add a `CHANGELOG.md` section.
3. `npm publish` and tag the release - always ask before doing either.

`prepublishOnly` runs `npm test` (which rebuilds `dist/`), so a publish cannot ship a stale build.
The tarball is `dist/` plus `package.json`, `README.md` and `LICENSE.md` - check with
`npm pack --dry-run`.
