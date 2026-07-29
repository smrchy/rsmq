import assert from "node:assert/strict"
import { describe, it } from "node:test"
import { createClient } from "redis"
import RedisSMQ from "../dist/index.js"

/** Everything around the Redis client itself: options, lifecycle, script loading. */

function once(emitter: RedisSMQ, event: string, timeout = 5000): Promise<any> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`timeout waiting for "${event}"`))
		}, timeout)
		emitter.once(event, (arg: any) => {
			clearTimeout(timer)
			resolve(arg)
		})
	})
}

describe("Redis client options", () => {
	it("should pass the `options` object on to the redis client", async () => {
		const rsmq = new RedisSMQ({ options: { database: 2 } })
		assert.equal((rsmq.redis as any).options.database, 2)
		await once(rsmq, "connect")
		assert.equal(rsmq.connected, true)
		assert.equal(await rsmq.quitAsync(), "OK")
	})

	it("should map the legacy `db` option to `database`", () => {
		const rsmq = new RedisSMQ({ options: { db: 3 } })
		assert.equal((rsmq.redis as any).options.database, 3)
		assert.equal((rsmq.redis as any).options.db, undefined)
		rsmq.quit()
	})

	it("should put `host` and `port` into the socket options", () => {
		const rsmq = new RedisSMQ({ host: "127.0.0.1", port: 6379 })
		assert.deepEqual((rsmq.redis as any).options.socket, { host: "127.0.0.1", port: 6379 })
		rsmq.quit()
	})

	it("should use the default host and port", () => {
		const rsmq = new RedisSMQ()
		assert.deepEqual((rsmq.redis as any).options.socket, { host: "127.0.0.1", port: 6379 })
		rsmq.quit()
	})

	it("should work in RESP3 mode", async () => {
		// rsmq only uses commands whose replies are the same in RESP2 and RESP3
		const rsmq = new RedisSMQ({ ns: "testresp3", options: { RESP: 3 } })
		const qname = "resp3"
		await rsmq.createQueueAsync({ qname, vt: 0 })
		const id = await rsmq.sendMessageAsync({ qname, message: "RESP3 hello" })

		const message = (await rsmq.receiveMessageAsync({ qname })) as RedisSMQ.QueueMessage
		assert.equal(message.id, id)
		assert.equal(message.message, "RESP3 hello")
		assert.equal(message.rc, 1)

		const attributes = await rsmq.getQueueAttributesAsync({ qname })
		assert.equal(attributes.msgs, 1)
		assert.equal(attributes.totalsent, 1)
		const popped = (await rsmq.popMessageAsync({ qname })) as RedisSMQ.QueueMessage
		assert.equal(popped.id, id)
		assert.equal(popped.rc, 2)

		await rsmq.deleteQueueAsync({ qname })
		await rsmq.quitAsync()
	})

	it("should use the `ns` option for all keys", async () => {
		const rsmq = new RedisSMQ({ ns: "testns" })
		assert.equal(rsmq.redisns, "testns:")
		await rsmq.createQueueAsync({ qname: "nstest" })
		const redis = createClient()
		await redis.connect()
		assert.equal(await redis.exists("testns:nstest:Q"), 1)
		assert.deepEqual(await redis.sMembers("testns:QUEUES"), ["nstest"])
		await rsmq.deleteQueueAsync({ qname: "nstest" })
		assert.equal(await redis.exists("testns:nstest:Q"), 0)
		await redis.quit()
		await rsmq.quitAsync()
	})
})

describe("An existing Redis client", () => {
	it("should be used as is when it is already connected", async () => {
		const redis = createClient()
		await redis.connect()
		const rsmq = new RedisSMQ({ client: redis })
		assert.equal(rsmq.redis, redis)
		assert.equal(rsmq.connected, true)
		// `connect` is emitted on the next tick, so a listener attached right after
		// the constructor still sees it
		await once(rsmq, "connect")
		await rsmq.createQueueAsync({ qname: "externalclient" })
		assert.equal(await rsmq.deleteQueueAsync({ qname: "externalclient" }), 1)
		await rsmq.quitAsync()
		assert.equal(redis.isOpen, false)
	})

	it("should be connected when it was handed in unconnected", async () => {
		const redis = createClient()
		const rsmq = new RedisSMQ({ client: redis })
		assert.equal(rsmq.connected, false)
		await once(rsmq, "connect")
		assert.equal(rsmq.connected, true)
		assert.deepEqual(await rsmq.listQueuesAsync(), [])
		await rsmq.quitAsync()
	})

	it("should be rejected when it is not a redis client", () => {
		assert.throws(() => new RedisSMQ({ client: {} }), { name: "invalidClient" })
		assert.throws(() => new RedisSMQ({ client: "redis" }), { name: "invalidClient" })
	})
})

describe("LUA scripts", () => {
	it("should be loaded again when Redis lost them", async () => {
		const rsmq = new RedisSMQ()
		const redis = createClient()
		await redis.connect()

		await rsmq.createQueueAsync({ qname: "scriptflush" })
		const id = await rsmq.sendMessageAsync({ qname: "scriptflush", message: "before flush" })

		// Everything Redis knows about our scripts is gone now
		await redis.scriptFlush()

		const received = (await rsmq.receiveMessageAsync({ qname: "scriptflush", vt: 0 })) as RedisSMQ.QueueMessage
		assert.equal(received.id, id)

		await redis.scriptFlush()
		const popped = (await rsmq.popMessageAsync({ qname: "scriptflush" })) as RedisSMQ.QueueMessage
		assert.equal(popped.id, id)

		await rsmq.deleteQueueAsync({ qname: "scriptflush" })
		await redis.quit()
		await rsmq.quitAsync()
	})

	it("should be there again after the server dropped the connection", async () => {
		const rsmq = new RedisSMQ()
		// a connection the server kills shows up as an `error` event
		rsmq.on("error", () => {})
		await rsmq.createQueueAsync({ qname: "reconnect" })
		const id = await rsmq.sendMessageAsync({ qname: "reconnect", message: "survives a reconnect" })

		const clientId = await rsmq.redis.sendCommand(["CLIENT", "ID"])
		const reconnected = once(rsmq, "connect", 10000)

		const killer = createClient()
		await killer.connect()
		assert.equal(Number(await killer.sendCommand(["CLIENT", "KILL", "ID", String(clientId)])), 1, "the rsmq connection was killed")
		await killer.quit()

		await reconnected
		// the scripts are loaded again, so this still works
		const received = (await rsmq.receiveMessageAsync({ qname: "reconnect" })) as RedisSMQ.QueueMessage
		assert.equal(received.id, id)

		await rsmq.deleteQueueAsync({ qname: "reconnect" })
		await rsmq.quitAsync()
	})

	it("should be waited for by commands issued before the connection is up", async () => {
		const rsmq = new RedisSMQ()
		// No `await` on a connect event: the command has to queue up until the
		// client is ready and the scripts are loaded.
		await rsmq.createQueueAsync({ qname: "notyetconnected" })
		const id = await rsmq.sendMessageAsync({ qname: "notyetconnected", message: "queued" })
		const received = (await rsmq.receiveMessageAsync({ qname: "notyetconnected" })) as RedisSMQ.QueueMessage
		assert.equal(received.id, id)
		await rsmq.deleteQueueAsync({ qname: "notyetconnected" })
		await rsmq.quitAsync()
	})
})

describe("Connection errors", () => {
	it("should emit `disconnect` when the connection is refused", async () => {
		// Nothing is listening on this port
		const rsmq = new RedisSMQ({ port: 6399 })
		await once(rsmq, "disconnect")
		assert.equal(rsmq.connected, false)
		// Stops the reconnect attempts, so this test does not keep the process alive
		assert.equal(await rsmq.quitAsync(), "OK")
	})

	it("should emit `error` for other errors when someone is listening", async () => {
		const rsmq = new RedisSMQ()
		await once(rsmq, "connect")
		const boom = new Error("boom")
		const errorPromise = once(rsmq, "error")
		;(rsmq.redis as any).emit("error", boom)
		assert.equal(await errorPromise, boom)
		await rsmq.quitAsync()
	})

	it("should resolve `quit` even when it was never connected", async () => {
		const rsmq = new RedisSMQ({ port: 6399 })
		assert.equal(await rsmq.quitAsync(), "OK")
		assert.equal(await rsmq.quitAsync(), "OK")
	})

	it("should reject a command that is issued after `quit`", async () => {
		const rsmq = new RedisSMQ()
		await rsmq.listQueuesAsync()
		await rsmq.quitAsync()
		// waiting for a connection that will never come back would hang forever
		await assert.rejects(rsmq.listQueuesAsync(), { message: "The client is closed" })
	})

	it("should not leave a socket behind when `quit` is called while connecting", async () => {
		// A client that is dropped while its socket is being established would stay
		// open forever and keep the node process from exiting.
		const settle = () => new Promise((resolve) => setTimeout(resolve, 300))
		// let the connections of the tests before this one finish closing
		await settle()
		const before = openSockets()
		const rsmq = new RedisSMQ()
		await rsmq.quitAsync()
		await settle()
		assert.equal(openSockets(), before)
	})
})

function openSockets(): number {
	return process.getActiveResourcesInfo().filter((resource) => resource === "TCPSocketWrap").length
}
