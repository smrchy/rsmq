# CHANGELOG for rsmq

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

