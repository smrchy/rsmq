# CHANGELOG for rsmq

## 0.13.0

Maintenance release for the `0.x` line. No public API changes, but two changes in behavior:
the message size limit is now enforced in bytes and Node.js >= 20 is required.

* **Removed the `lodash` dependency.** `redis` is now the only runtime dependency. This also removes the
  `_.template` code injection advisory ([GHSA-r5fr-rjxr-66jc](https://github.com/advisories/GHSA-r5fr-rjxr-66jc))
  from the dependency tree.
* **`maxsize` is now checked in bytes** (`Buffer.byteLength`) instead of characters, as documented.
  Messages with multi-byte characters (Umlauts, emoji, CJK, ...) that were slightly over the limit
  in bytes were accepted before and are now rejected with `Message too long`.
* **Fixed the Redis error check** that was missing a comparison to `-1`: every error that was *not*
  a connection refusal was treated as a disconnect and silently swallowed. Non-connection errors are
  now logged and emitted as an `error` event - but only when an `error` listener is attached, so an
  unhandled event cannot take the process down. `ECONNREFUSED` is now also detected via `err.code`.
* **The documented `options` object is passed on to `redis.createClient` again.** It was assembled
  and then dropped, so options like `retry_strategy`, `db` or `tls` had no effect. Options at the top
  level of the constructor keep working as before.
* An existing `client` is now also accepted when it is a subclass of the node_redis client
  (`instanceof RedisClient`) and no longer silently replaced by a new connection.
* `index.d.ts` no longer imports from `redis`, so `@types/redis` is not needed to consume the typings.
  Added `quitAsync`, the event listener signatures (`connect`, `disconnect`, `error`), and made the
  constructor options and the `quit` callback optional.
* **Node.js >= 20 is required** (`engines`). Older versions are end of life and are no longer tested.
  The code itself is unchanged ES6 and still runs on older Node versions, but they are unsupported.
* Removed the Travis config and the dead Travis / david-dm badges from the README.
* Updated dev dependencies (mocha 11, TypeScript 5), removed the unused `ts-loader`,
  replaced `test/mocha.opts` with `.mocharc.json` and added a typings compile check
  (`npm run test:types`). `npm test` now rebuilds `index.js` and the tests first.

## 0.12.4

* Added Travis tests for Node 16
* Updated dependencies
* Removed Travis tests for Node 10
## 0.12.3

* Added .NET implementation to README.md (#126)
* Fixed index.d.ts file to #110. (#123)
* Added rsmq-promise-native to README.md (#122)
* Removed support for Node 8
* Updated dependencies
## 0.12.2

* Added callback to `quit` method (#110)

## 0.12.1

* Added Travis tests for Node 14

## 0.12.0

* Removed Travis tests for Node 6
* Updated dependencies
* Added README for RSMQ Rust port. Thanks @DavidBM. (#107)

## 0.11.0

* Refactored all code from coffeescript to typescript.
* Added tests for #90
* Removed support for Node 4
* Support for `password` option when connecting to Redis (#70)

## 0.10.0

* added optional Promise support and tests

## 0.9.3

* removed `hiredis` optionalDependency

## 0.9.2

* add realtime option in typescript typings

## 0.9.0

* Added realtime option for Redis PUB/SUB when a new message is sent to RSMQ
* Added tests for realtime
* Added Travis tests for Node 10
* Updated dependencies (lodash and dev.async)

## 0.8.4

* Added Typescript typings

## 0.8.3

* Removed Travis test for Node 7
* Added Travis test for Node 8
* Mocha 4.x fixes for Travis test runner.

## 0.8.2

* Added mention for "RSMQ in other languages" in README.md

## 0.8.1

* Make sure `setQueueAttributes` does refresh `modified` field. Fix for #47. Thanks @igr

## 0.8.0

* Allow unlimited message size with `maxsize=-1` option.

## 0.7.2

* Removed Travis tests for Node 0.12.x

## 0.7.1

* Fix #30 Increased queue name limit from 80 to 160 chars.
* Run Travis tests latest Node 6.x, 4.x

## 0.7.0 

* Updated dependencies

## 0.6.0

* Added `popMessage` method
* Fix #23: Use of external Redis instance
* Added Tests for `popMessage`
* Use current version of lodash (4.5.1) and redis (2.4.2)

## 0.4.0

* Updated `redis` / `hiredis` modules.
* Node 0.8.x is no longer supported.
* Removed Travis tests for iojs
* Travis tests for Node 4.1 and 5.0

## 0.3.16

* Docs (Redis 2.6+ version requirement)

## 0.3.15

* Added LICENSE.md 
* Docs (added Links to modules)

## 0.3.14

* Fix `changeMessageVisibility` syntax fix. Failed if this method will be called as first call.

## 0.3.13

* Fix `hiddenmsgs` display in `getQueueAttributes`

## 0.3.12

* Added `quit` method

## 0.3.11

* Docs

## 0.3.10

* Docs

## 0.3.9 

* Added logo to README.md

## 0.3.8

* implemented `setQueueAttributes`
* switched from underscore to lodash
* added Travis test for Node.js 0.11
* updated the docs
* added tests for `setQueueAttributes`

## 0.3.5

* Make `hiredis` optional.

## 0.3.4

* Added support for [https://github.com/mranney/node_redis#rediscreateclientport-host-options](redis.createClient) `options` object.

## 0.3.3

* docs

## 0.3.2

* Added constructor option `client` to reuse existing redis clients

## 0.3.1

* Add details to README.md for constructor object. #3

