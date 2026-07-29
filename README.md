![RSMQ: Redis Simple Message Queue for Node.js](https://img.webmart.de/rsmq_wide.png)

# Redis Simple Message Queue

[![test](https://github.com/smrchy/rsmq/actions/workflows/test.yml/badge.svg?branch=develop)](https://github.com/smrchy/rsmq/actions/workflows/test.yml)

A lightweight message queue for Node.js that requires no dedicated queue server. Just a Redis server.

**tl;dr:** If you run a Redis server and currently use Amazon SQS or a similar message queue you might as well use this fast little replacement. Using a shared Redis server multiple Node.js processes can send / receive messages.

## Features

* **Lightweight**: just Redis. [`redis`](https://github.com/redis/node-redis) is the only dependency.
* **Fast**: send / receive 10000+ messages per second on an average machine. It's *just Redis*.
* **Guaranteed delivery of a message to exactly one recipient** within the message's visibility timeout.
* A received message that is not deleted **reappears** after the visibility timeout - nothing is lost when a worker dies.
* **Promises and callbacks**: every method takes an optional callback and returns a promise when you leave it out.
* Written in **TypeScript**, typings included ❤️
* Messages stay in the queue unless they are deleted.

**Requirements:** Node.js >= 20 and Redis >= 2.6 (RSMQ uses `EVAL` / LUA scripts). RESP2 and RESP3
both work. RSMQ talks to a single Redis instance and is **not** compatible with Redis Cluster: the
keys of one queue can land in different hash slots.

## Installation

```bash
npm install rsmq
```

## Quick start

```javascript
const RedisSMQ = require("rsmq");

const rsmq = new RedisSMQ({ host: "127.0.0.1", port: 6379, ns: "rsmq" });

// A worker: take a message, work on it, delete it
async function work() {
	const message = await rsmq.receiveMessage({ qname: "myqueue" });

	if (!message.id) {
		return; // nothing in the queue right now
	}

	console.log("working on", message.id, message.message);
	// ... do the work ...

	// Not deleting it means it shows up again after the visibility timeout
	await rsmq.deleteMessage({ qname: "myqueue", id: message.id });
}

async function main() {
	// `createQueue` throws `queueExists` if the queue is already there
	await rsmq.createQueue({ qname: "myqueue" }).catch((err) => {
		if (err.name !== "queueExists") {
			throw err;
		}
	});

	await rsmq.sendMessage({ qname: "myqueue", message: "Hello World" });
	await work();

	await rsmq.quit(); // let the node process exit
}

main();
```

Both styles work everywhere - with a callback as the last argument, or without it for a promise:

```javascript
// promise
const id = await rsmq.sendMessage({ qname: "myqueue", message: "Hello World" });

// callback
rsmq.sendMessage({ qname: "myqueue", message: "Hello World" }, (err, id) => { /* ... */ });

// the 0.x promise API is still there and does the same as the promise above
const id2 = await rsmq.sendMessageAsync({ qname: "myqueue", message: "Hello World" });
```

TypeScript:

```typescript
import RedisSMQ = require("rsmq");

const rsmq = new RedisSMQ({ host: "127.0.0.1" });

async function work(): Promise<void> {
	const attributes: RedisSMQ.QueueAttributes = await rsmq.getQueueAttributes({ qname: "myqueue" });
	console.log(attributes.msgs);

	// receiveMessage and popMessage resolve with `QueueMessage | {}`,
	// so narrow it before you use it
	const message = await rsmq.receiveMessage({ qname: "myqueue" });
	if ("id" in message) {
		await rsmq.deleteMessage({ qname: "myqueue", id: message.id });
	}
}
```

There are runnable examples in the [`examples`](examples) folder.

## How it works

* A queue is created once with `createQueue`, then any number of processes can send to it and receive from it.
* `sendMessage` returns a unique message `id`. Messages are handled **FIFO** (first in, first out) unless they are sent with a `delay`.
* `receiveMessage` returns the next message *and hides it* for `vt` seconds (the **visibility timeout**), so no other receiver gets the same message.
  * Done with the message? `deleteMessage` it.
  * Crashed, or just not deleted in time? The message becomes visible again and is delivered again. Its receive counter `rc` goes up, so you can detect and drop messages that keep failing.
  * Need more time? `changeMessageVisibility` extends the timeout.
* `popMessage` receives and deletes in one step - faster, but there is no second chance if your worker dies.
* An empty queue is not an error: `receiveMessage` and `popMessage` return `{}`.

The defaults (`vt: 30`, `delay: 0`, `maxsize: 65536`) can be set per queue with `createQueue` /
`setQueueAttributes` and overridden per call.

## Methods

Every method takes an options object and an optional node style callback:
`method(options, callback)` calls back with `(err, result)`, `method(options)` returns a promise
that resolves with the same `result`. The `*Async` variants (`sendMessageAsync`, ...) always return
a promise.

### Constructor

`new RedisSMQ(options)`

| Option | Type | Default | Description |
|:--|:--|:--|:--|
| `host` | String | `"127.0.0.1"` | The Redis server. |
| `port` | Number | `6379` | The Redis port. |
| `password` | String | - | If your Redis server requires a password. |
| `options` | Object | `{}` | [node-redis client options](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md), passed on to `redis.createClient`. Use it for `database`, `socket.tls`, `socket.reconnectStrategy`, `url`, ... |
| `client` | RedisClient | - | An existing `node-redis` (v4 or newer) client. `host`, `port`, `password` and `options` are ignored then. |
| `ns` | String | `"rsmq"` | The namespace prefix used for all Redis keys. |
| `realtime` | Boolean | `false` | Enable realtime `PUBLISH` of new messages (see [Realtime](#realtime)). |

```javascript
const RedisSMQ = require("rsmq");
const { createClient } = require("redis");

// a connection of its own
const rsmq = new RedisSMQ({ host: "127.0.0.1", port: 6379, ns: "rsmq" });

// or share the client you already have
async function withMyOwnClient() {
	const client = createClient();
	await client.connect();
	return new RedisSMQ({ client: client });
}
```

You can start using the instance right away - commands issued before the connection is up wait for it.

### Queues

#### createQueue(options, callback)

Create a new queue.

| Parameter | Type | Default | Description |
|:--|:--|:--|:--|
| `qname` | String | *required* | The queue name. Maximum 160 characters; `a-z`, `A-Z`, `0-9`, `-` and `_` are allowed. |
| `vt` | Number | `30` | The visibility timeout in seconds: how long a received message stays invisible for other receivers. `0` - `9999999` (~115 days). |
| `delay` | Number | `0` | The time in seconds that the delivery of all new messages of this queue is delayed. `0` - `9999999`. |
| `maxsize` | Number | `65536` | The maximum message size in **bytes**. `1024` - `65536`, or `-1` for unlimited. |

Resolves with `1`. Fails with `queueExists` when the queue is already there.

```javascript
try {
	await rsmq.createQueue({ qname: "myqueue", vt: 60 });
	console.log("queue created");
} catch (err) {
	if (err.name === "queueExists") {
		console.log("queue was already there");
	} else {
		throw err;
	}
}
```

#### listQueues(callback)

List all queues. Takes no options.

Resolves with an array of queue names: `["myqueue", "otherqueue"]`.

```javascript
const queues = await rsmq.listQueues();
console.log("Active queues:", queues.join(", "));
```

#### deleteQueue(options, callback)

Delete a queue **and all of its messages**.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |

Resolves with `1`. Fails with `queueNotFound` when there is no such queue.

```javascript
await rsmq.deleteQueue({ qname: "myqueue" });
```

#### getQueueAttributes(options, callback)

Get the settings, counters and stats of a queue.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |

Resolves with an object:

| Property | Type | Description |
|:--|:--|:--|
| `vt` | Number | The visibility timeout of the queue in seconds. |
| `delay` | Number | The delay for new messages in seconds. |
| `maxsize` | Number | The maximum message size in bytes (`-1` for unlimited). |
| `totalrecv` | Number | Total number of messages received from the queue. |
| `totalsent` | Number | Total number of messages sent to the queue. |
| `created` | Number | Timestamp (epoch in seconds) when the queue was created. |
| `modified` | Number | Timestamp (epoch in seconds) of the last `setQueueAttributes`. |
| `msgs` | Number | Current number of messages in the queue. |
| `hiddenmsgs` | Number | Current number of hidden messages: in flight because of a `vt`, or not delivered yet because of a `delay`. |

```javascript
const attributes = await rsmq.getQueueAttributes({ qname: "myqueue" });
console.log(`${attributes.msgs} messages, ${attributes.hiddenmsgs} of them hidden`);
```

#### setQueueAttributes(options, callback)

Change the settings of a queue. At least one of `vt`, `delay` or `maxsize` must be supplied; only
what is supplied is changed. Existing messages keep the score they were given when they were sent
or received, so a new `vt` or `delay` applies to what happens from now on.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |
| `vt` | Number | *optional* The new visibility timeout in seconds. `0` - `9999999`. |
| `delay` | Number | *optional* The new delay for new messages in seconds. `0` - `9999999`. |
| `maxsize` | Number | *optional* The new maximum message size in bytes. `1024` - `65536`, or `-1`. |

Resolves with the same object as [`getQueueAttributes`](#getqueueattributesoptions-callback).

```javascript
const attributes = await rsmq.setQueueAttributes({ qname: "myqueue", vt: 60, maxsize: -1 });
console.log("vt is now", attributes.vt);
```

### Messages

#### sendMessage(options, callback)

Send a message to a queue.

| Parameter | Type | Default | Description |
|:--|:--|:--|:--|
| `qname` | String | *required* | The queue name. |
| `message` | String | *required* | The message. Must be a string - serialize objects yourself, e.g. with `JSON.stringify`. |
| `delay` | Number | queue `delay` | The time in seconds the delivery of *this* message is delayed. `0` - `9999999`. |

Resolves with the message `id` (String, 32 characters).

**The message size is checked in bytes** (UTF-8), not in characters: 40000 emoji are 160000 bytes
and are rejected by a queue with the default `maxsize` of 65536. Use `maxsize: -1` for unlimited
messages.

```javascript
const id = await rsmq.sendMessage({
	qname: "myqueue",
	message: JSON.stringify({ task: "resize", file: "cat.jpg" })
});
console.log("message sent:", id);

// deliver this one in 60 seconds
await rsmq.sendMessage({ qname: "myqueue", message: "later", delay: 60 });
```

#### receiveMessage(options, callback)

Receive the next message from the queue and hide it from other receivers for `vt` seconds.

| Parameter | Type | Default | Description |
|:--|:--|:--|:--|
| `qname` | String | *required* | The queue name. |
| `vt` | Number | queue `vt` | How long this message stays invisible for others, in seconds. `0` - `9999999`. |

Resolves with an object, or with `{}` when the queue has no visible message:

| Property | Type | Description |
|:--|:--|:--|
| `id` | String | The message id. |
| `message` | String | The message. |
| `sent` | Number | Timestamp (epoch in ms) when the message was sent. |
| `fr` | Number | Timestamp (epoch in ms) when the message was received for the **first** time. |
| `rc` | Number | Number of times this message was received. `1` on the first receive. |

```javascript
const message = await rsmq.receiveMessage({ qname: "myqueue" });

if (!message.id) {
	console.log("no messages for me...");
} else if (message.rc > 3) {
	console.error("this message keeps failing, dropping it", message.id);
	await rsmq.deleteMessage({ qname: "myqueue", id: message.id });
} else {
	console.log("received", message.message);
	await rsmq.deleteMessage({ qname: "myqueue", id: message.id });
}
```

#### popMessage(options, callback)

Receive the next message from the queue **and delete it** in one step.

**Important:** the message is gone. If your process dies while working on it, there is no way to get
it back. Use `receiveMessage` + `deleteMessage` when that matters.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |

Resolves with the same object as [`receiveMessage`](#receivemessageoptions-callback), or `{}` when
the queue has no visible message.

```javascript
const message = await rsmq.popMessage({ qname: "myqueue" });

if (message.id) {
	console.log("received and already deleted:", message.message);
}
```

#### deleteMessage(options, callback)

Delete a message.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |
| `id` | String | The message id. |

Resolves with `1` when the message was deleted, `0` when it was not there (anymore).

```javascript
const deleted = await rsmq.deleteMessage({ qname: "myqueue", id: id });
console.log(deleted === 1 ? "message deleted" : "message not found");
```

#### changeMessageVisibility(options, callback)

Change the visibility timer of a single message. The message becomes visible again at *now* + `vt`,
no matter what its previous timer was.

| Parameter | Type | Description |
|:--|:--|:--|
| `qname` | String | The queue name. |
| `id` | String | The message id. |
| `vt` | Number | Seconds until the message is visible again. `0` - `9999999`. `0` makes it available right away. |

Resolves with `1` when the timer was changed, `0` when the message was not found.

```javascript
// this takes longer than expected - keep the message hidden for another 5 minutes
await rsmq.changeMessageVisibility({ qname: "myqueue", id: id, vt: 300 });

// on the other hand: give it back to the queue right now
await rsmq.changeMessageVisibility({ qname: "myqueue", id: id, vt: 0 });
```

### quit(callback)

Close the Redis connection. Useful when you use RSMQ in a script and want node to be able to exit.

Resolves with `"OK"`, also when the connection was never established, so `quit` never leaves you
hanging. Commands issued afterwards fail with *"The client is closed"*.

Note: when you handed in your own client via `options.client`, `quit` closes that client too.

```javascript
await rsmq.quit();
```

## Errors

Errors are `Error` objects with a stable `name` and `message`, so you can branch on them:

| `err.name` | `err.message` |
|:--|:--|
| `queueExists` | Queue exists |
| `queueNotFound` | Queue not found |
| `messageNotString` | Message must be a string |
| `messageTooLong` | Message too long |
| `missingParameter` | No `<qname\|id>` supplied |
| `invalidFormat` | Invalid `<qname\|id>` format |
| `invalidValue` | `<vt\|delay\|maxsize>` must be between `<min>` and `<max>` |
| `noAttributeSupplied` | No attribute was supplied |
| `invalidClient` | The supplied client is not a node-redis client |

Everything else that can go wrong is a Redis error and is passed through unchanged.

## Events

An RSMQ instance is an `EventEmitter`:

| Event | When |
|:--|:--|
| `connect` | The Redis connection is up and ready. The LUA scripts are being loaded. Emitted again after a reconnect. |
| `disconnect` | The Redis connection was refused or lost (`ECONNREFUSED`). |
| `error` | Any other error of the Redis client. The error object is passed to the listener. |

Without an `error` listener an error is only written to `console.error` - RSMQ never throws an
unhandled `error` event at your process.

```javascript
rsmq.on("connect", () => console.log("RSMQ connected"));
rsmq.on("disconnect", () => console.warn("RSMQ lost the Redis connection"));
rsmq.on("error", (err) => console.error("RSMQ error", err));
```

A lost connection is not fatal: the client reconnects, the LUA scripts are loaded again and commands
that were waiting are sent.

## Realtime

With `realtime: true` every `sendMessage` also issues a `PUBLISH` to `{ns}:rt:{qname}` with the new
number of messages in the queue as the payload:

* the queue `myqueue` already contains 5 messages
* a new message is sent
* RSMQ issues `PUBLISH rsmq:rt:myqueue 6`

That is all it does - use it to react to new messages instead of polling:

```javascript
const RedisSMQ = require("rsmq");
const { createClient } = require("redis");

const rsmq = new RedisSMQ({ realtime: true });

async function listen() {
	const subscriber = createClient();
	await subscriber.connect();

	await subscriber.subscribe("rsmq:rt:myqueue", async (queueLength) => {
		console.log(`${queueLength} messages in the queue`);
		const message = await rsmq.receiveMessage({ qname: "myqueue" });
		// ... work on it ...
	});
}

listen();
```

Make sure not to have many workers subscribe and then all call `receiveMessage` at the same time -
only one of them gets the message, the rest just adds load.

## Migrating from 0.x to 1.x

`1.0.0` is a TypeScript rewrite. Queue names, message ids, the Redis keys, all return values and all
error messages are unchanged, so a `1.x` process and a `0.x` process can work on the same queues.
Two things need attention:

* **`redis@6` instead of `redis@3`.** A client you pass via `options.client` has to be a `node-redis`
  v4, v5 or v6 client. A `redis@3` client is rejected with an `invalidClient` error instead of being
  silently ignored.
* **`options` is a [node-redis v4+ options object](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md)** now.
  Most keys are named differently than in `redis@3`: `db` is `database` (this one is still mapped for
  you), `retry_strategy` is `socket.reconnectStrategy`, `tls` is `socket.tls` and so on. `host`,
  `port` and `password` of the RSMQ options are unchanged.

Everything else - all methods, the `*Async` variants, the `connect` / `disconnect` / `error` events -
works like it did in `0.x`. New in `1.x`: leaving the callback out gives you a promise.

## Modules for RSMQ

To keep the core of *RSMQ* small, additional functionality is available as modules:

* [**rsmq-worker**](https://github.com/mpneuried/rsmq-worker) Helper to implement a worker with RSMQ.
* [**rest-rsmq**](https://github.com/smrchy/rest-rsmq) A RESTful interface for RSMQ.
* [**rsmq-cli**](https://github.com/mpneuried/rsmq-cli) A command-line interface / terminal client for RSMQ.
* [**rsmq-promise-native**](https://www.npmjs.com/package/rsmq-promise-native) Native promise interface for RSMQ.
* [**rsmq-promise**](https://www.npmjs.com/package/rsmq-promise) Promise interface for RSMQ (via Bluebird).

Note: `1.x` returns promises on its own, so the promise wrappers are not needed anymore.

## RSMQ in other languages

The simplicity of RSMQ is useful in other languages. Here is a list of implementations in other languages:

* [**Rust**](https://github.com/Couragium/rsmq-async-rs) RSMQ Async for Rust. See [#107](https://github.com/smrchy/rsmq/issues/107)
* [**Java**](https://github.com/igr/jrsmq) RSMQ for Java. See [#48](https://github.com/smrchy/rsmq/issues/48)
* [**PHP**](https://github.com/michsindelar/PhpRSMQ) RSMQ for PHP (work in progress)
* [**CSharp/DotNet**](https://github.com/tontonrally/rsmqCsharp) RSMQ for .NET

The Redis keys and the message format are documented in
[`_docs/redis_data_structure.md`](_docs/redis_data_structure.md).

Note: Should you plan to port RSMQ to another language please make sure to have tests to ensure compatibility with all RSMQ clients. And of course: let me know so i can mention your port here.

## Changes

See the [CHANGELOG](CHANGELOG.md).

## The MIT License

Please see the LICENSE.md file.
