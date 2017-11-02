# CHANGELOG for rsmq

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

