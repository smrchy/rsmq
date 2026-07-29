# CLAUDE.md - working on rsmq

`rsmq` (Redis Simple Message Queue) is a published npm package with a lot of users on `0.x`.
Backwards compatibility is the top priority: the public API, the Redis key layout and the error
messages are contracts. Tests assert the exact error strings.

There is **no CI**. Travis was removed in `0.13.0`, so `npm test` on your machine is the only gate.

## Prerequisites

* **Node**: use the version in `.nvmrc` -> `nvm use` (currently 24.18.0).
* **A local Redis** on `127.0.0.1:6379` - the tests are integration tests, there are no mocks.
  `brew services start redis` or `redis-server`. Check with `redis-cli ping` -> `PONG`.
* The tests also expect **nothing** to listen on port `6399` (used to test connection refusal).

## Build and test

```bash
nvm use
npm install
npm test          # pretest builds everything, then runs mocha
```

`npm test` runs, via `pretest`:

1. `npm run build` - `tsc` compiles `_src/index.ts` -> `index.js` (repo root, committed to git).
2. `npm run build:test` - `coffee` compiles `test/test.coffee` -> `test/test.js` (also committed).
3. `npm run test:types` - `tsc -p ./test/typings` type-checks the shipped `index.d.ts` against
   `test/typings/consumer.ts` with `"types": []`, i.e. it verifies the typings work **without**
   `@types/redis` or `@types/node` in a consuming project.
4. `mocha ./test/test.js` (config in `.mocharc.json`, `bail` is on).

Expected result: **93 passing**. The suite talks to the real Redis and creates/deletes queues
`test1`, `test2`, `test3promises` and `test4unicode` in the `rsmq:` namespace of db 0.

## Where the code lives

| File | Role |
|:--|:--|
| `_src/index.ts` | **The only source file. Edit this one.** |
| `index.js` | Compiled output, committed and shipped. Never edit by hand - run `npm run build`. |
| `index.d.ts` | **Hand-maintained** typings, shipped. `tsc` does not generate them. Keep in sync manually. |
| `test/test.coffee` | **The test source. Edit this one.** |
| `test/test.js` | Compiled tests, committed. Run `npm run build:test`. |
| `test/typings/` | Compile-only consumer check for `index.d.ts`. |
| `ai/` | Rewrite plans and progress notes (git-ignored, local only). |
| `_docs/`, `coffeelint.json`, `tslint.json` | Dead leftovers from the coffeescript era. No linter runs. |

`package.json` `files` ships exactly `index.js` and `index.d.ts`.

## Conventions

* **Tabs** for indentation, double quotes, no semicolon religion - match the surrounding code.
* `redis` is the only runtime dependency. Do not add dependencies to `0.x`.
* Keep the callback API. The `*Async` promise variants are generated in the constructor by
  `asyncify`, so a new public method must be added to that list to get its `*Async` twin.
* New public method or option -> update `index.d.ts`, `README.md`, `test/typings/consumer.ts`
  and `CHANGELOG.md` in the same change.
* LUA scripts are loaded on every `connect` in `initScript` and cached by sha1. Commands wait for
  the `scriptload:*` events, do not reorder that handshake.

## Redis client version

`0.x` is pinned to `redis@^3.1.2` (the last 3.x release) because it is the last version with the
callback API and the `multi([[...], [...]])` array batches this code is built on. `redis@4+` has
neither. Do not "just bump" it - that migration is the `1.x` rewrite.

## Releasing

1. `npm test` must be green, `npm audit --omit=dev` must be clean.
2. Bump `version` in `package.json`, add a `CHANGELOG.md` section, update the version comment in
   `index.d.ts`.
3. Commit the rebuilt `index.js` / `test/test.js` together with the source change.
4. `npm publish` and tag the release - always ask before doing either.
