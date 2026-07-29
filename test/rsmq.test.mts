import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { createClient } from "redis"
import RedisSMQ from "../dist/index.js"

/**
 * The `0.x` test suite, ported to `node:test`.
 *
 * These tests run against a real Redis on 127.0.0.1:6379 and they run in order -
 * every test builds on the state the previous ones left behind.
 */

const queue1 = { name: "test1", modified: 0 }
const queue2 = { name: "test2" }
const queue3 = { name: "test3promises", m1: "Hello", m2: "World" }
const queue4 = { name: "test4unicode" }

/** Run a callback style method and resolve with both arguments it was called with. */
function callback<R>(fn: (cb: (err: any, resp: R) => void) => void): Promise<{ err: any; resp: R }> {
	return new Promise((resolve) => {
		fn((err, resp) => {
			resolve({ err, resp })
		})
	})
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

function longString(): string {
	let out = ""
	while (out.length < 66000) {
		out = out + "A very long Message..."
	}
	return out
}

describe("Redis-Simple-Message-Queue Test", async () => {
	// An external client, used to check that `options.client` works, and a second
	// one to watch the realtime notifications of queue1.
	const redis = createClient()
	const redissub = createClient()
	await redis.connect()
	await redissub.connect()

	let q1length = 0
	await redissub.subscribe("rsmq:rt:test1", (message: string) => {
		q1length = Number(message)
	})

	const rsmq = new RedisSMQ({ realtime: true })
	const rsmq2 = new RedisSMQ({ client: redis })

	let q1m1 = ""
	let q1m2 = ""
	let q1m3 = ""
	const q2msgs: Record<string, 1> = {}

	after(async () => {
		await rsmq.deleteQueueAsync({ qname: queue1.name }).catch(() => {})
		await rsmq.deleteQueueAsync({ qname: queue2.name }).catch(() => {})
		await redissub.unsubscribe("rsmq:rt:test1")
		await redissub.quit()
		// rsmq2 shares `redis` with the outer scope, so this closes both
		await rsmq2.quitAsync()
		await rsmq.quitAsync()
	})

	it("get a RedisSMQ instance", () => {
		assert.ok(rsmq instanceof RedisSMQ)
		assert.equal(rsmq.redisns, "rsmq:")
		assert.equal(rsmq.realtime, true)
	})

	it("use an existing Redis Client", () => {
		assert.ok(rsmq2 instanceof RedisSMQ)
		assert.equal(rsmq2.redis, redis)
	})

	it("should fail: hand in something that is not a Redis client", () => {
		assert.throws(() => new RedisSMQ({ client: { notAClient: true } }), {
			name: "invalidClient",
			message: "The supplied client is not a node-redis client"
		})
	})

	it("should delete all leftover queues", async () => {
		for (const qname of [queue1.name, queue2.name, queue3.name, queue4.name]) {
			await rsmq.deleteQueueAsync({ qname }).catch(() => {})
		}
		assert.deepEqual(await rsmq.listQueuesAsync(), [])
	})

	describe("Promise Api", () => {
		it("should create a queue", async () => {
			assert.equal(await rsmq.createQueueAsync({ qname: queue3.name, vt: 0, maxsize: -1 }), 1)
		})

		it("should send a message", async () => {
			assert.equal((await rsmq.sendMessageAsync({ qname: queue3.name, message: queue3.m1 })).length, 32)
		})

		it("should send another message", async () => {
			assert.equal((await rsmq.sendMessageAsync({ qname: queue3.name, message: queue3.m2 })).length, 32)
		})

		it("should check the maxsize of the queue", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue3.name })
			assert.equal(attributes.maxsize, -1)
		})

		it("should receive a message", async () => {
			const message = (await rsmq.receiveMessageAsync({ qname: queue3.name, vt: 2 })) as RedisSMQ.QueueMessage
			assert.equal(message.message, queue3.m1)
		})

		it("should receive another message", async () => {
			const message = (await rsmq.receiveMessageAsync({ qname: queue3.name, vt: 1 })) as RedisSMQ.QueueMessage
			assert.equal(message.message, queue3.m2)
		})

		it("Should fail: receive another message - no availabe message", async () => {
			const message = await rsmq.receiveMessageAsync({ qname: queue3.name, vt: 1 })
			assert.deepEqual(message, {})
		})

		it("should receive another message once its vt ran out", async () => {
			await wait(1010)
			const message = (await rsmq.receiveMessageAsync({ qname: queue3.name, vt: 3 })) as RedisSMQ.QueueMessage
			assert.equal(message.message, queue3.m2)
			assert.equal(message.rc, 2)
		})

		it("should receive another message once its vt ran out", async () => {
			await wait(1010)
			const message = (await rsmq.receiveMessageAsync({ qname: queue3.name, vt: 3 })) as RedisSMQ.QueueMessage
			assert.equal(message.message, queue3.m1)
		})

		it("should return a promise when no callback is supplied", async () => {
			const promise = rsmq.getQueueAttributes({ qname: queue3.name })
			assert.ok(promise instanceof Promise)
			assert.equal((await promise).maxsize, -1)
		})

		it("should delete the created queue", async () => {
			assert.equal(await rsmq.deleteQueueAsync({ qname: queue3.name }), 1)
		})
	})

	describe("Queues", () => {
		it("Should fail: Create a new queue with invalid characters in name", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: "should throw" }, cb))
			assert.equal(err.message, "Invalid qname format")
			assert.equal(err.name, "invalidFormat")
		})

		it("Should fail: Create a new queue with name longer 160 chars", async () => {
			const qname = "name01234567890123456789012345678901234567890123456789012345678901234567890123456789".repeat(2)
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname }, cb))
			assert.equal(err.message, "Invalid qname format")
		})

		it("Should fail: Create a new queue with negative vt", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, vt: -20 }, cb))
			assert.equal(err.message, "vt must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with negative vt - using createQueueAsync", async () => {
			await assert.rejects(rsmq.createQueueAsync({ qname: queue1.name, vt: -20 }), {
				name: "invalidValue",
				message: "vt must be between 0 and 9999999"
			})
		})

		it("Should fail: Create a new queue with non numeric vt", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, vt: "not_a_number" as unknown as number }, cb))
			assert.equal(err.message, "vt must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with non numeric vt - using createQueueAsync", async () => {
			await assert.rejects(rsmq.createQueueAsync({ qname: queue1.name, vt: "not_a_number" as unknown as number }), {
				message: "vt must be between 0 and 9999999"
			})
		})

		it("Should fail: Create a new queue with vt too high", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, vt: 10000000 }, cb))
			assert.equal(err.message, "vt must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with negative delay", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, delay: -20 }, cb))
			assert.equal(err.message, "delay must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with non numeric delay", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, delay: "not_a_number" as unknown as number }, cb))
			assert.equal(err.message, "delay must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with delay too high", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, delay: 10000000 }, cb))
			assert.equal(err.message, "delay must be between 0 and 9999999")
		})

		it("Should fail: Create a new queue with negative maxsize", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, maxsize: -20 }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("Should fail: Create a new queue with non numeric maxsize", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, maxsize: "not_a_number" as unknown as number }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("Should fail: Create a new queue with maxsize too high", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, maxsize: 66000 }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("Should fail: Create a new queue with maxsize too low", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, maxsize: 900 }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("Should fail: Create a new queue with maxsize `-2`", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name, maxsize: -2 }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("ListQueues: Should return empty array", async () => {
			const { err, resp } = await callback<Array<string>>((cb) => rsmq.listQueues(cb))
			assert.equal(err, null)
			assert.equal(resp.length, 0)
		})

		it("Create a new queue: queue1", async () => {
			const { err, resp } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name }, cb))
			assert.equal(err, null)
			assert.equal(resp, 1)
		})

		it("Should fail: Create the same queue again", async () => {
			const { err } = await callback<1>((cb) => rsmq.createQueue({ qname: queue1.name }, cb))
			assert.equal(err.message, "Queue exists")
			assert.equal(err.name, "queueExists")
		})

		it("ListQueues: Should return array with one element", async () => {
			const queues = await rsmq.listQueuesAsync()
			assert.equal(queues.length, 1)
			assert.ok(queues.includes(queue1.name))
		})

		it("Create a new queue: queue2", async () => {
			assert.equal(await rsmq.createQueueAsync({ qname: queue2.name, maxsize: 2048 }), 1)
		})

		it("ListQueues: Should return array with two elements", async () => {
			const queues = await rsmq.listQueuesAsync()
			assert.equal(queues.length, 2)
			assert.ok(queues.includes(queue1.name))
			assert.ok(queues.includes(queue2.name))
		})

		it("Should succeed: GetQueueAttributes of queue 1", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue1.name })
			assert.equal(attributes.msgs, 0)
			assert.equal(attributes.vt, 30)
			assert.equal(attributes.delay, 0)
			assert.equal(attributes.maxsize, 65536)
			assert.equal(attributes.totalrecv, 0)
			assert.equal(attributes.totalsent, 0)
			assert.ok(attributes.created > 0)
			queue1.modified = attributes.modified
		})

		it("Should fail: GetQueueAttributes of bogus queue", async () => {
			const { err } = await callback((cb) => rsmq.getQueueAttributes({ qname: "sdfsdfsdf" }, cb))
			assert.equal(err.message, "Queue not found")
		})

		it("Should fail: setQueueAttributes of bogus queue with no supplied attributes", async () => {
			const { err } = await callback((cb) => rsmq.setQueueAttributes({ qname: "kjdsfh3h" }, cb))
			assert.equal(err.message, "No attribute was supplied")
		})

		it("Should fail: setQueueAttributes of bogus queue with supplied attributes", async () => {
			const { err } = await callback((cb) => rsmq.setQueueAttributes({ qname: "kjdsfh3h", vt: 1000 }, cb))
			assert.equal(err.message, "Queue not found")
		})

		it("setQueueAttributes: Should return the queue with a new vt attribute", async () => {
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue1.name, vt: 1234 })
			assert.equal(attributes.vt, 1234)
			assert.equal(attributes.delay, 0)
			assert.equal(attributes.maxsize, 65536)
		})

		it("setQueueAttributes: Should return the queue with a new delay attribute", async () => {
			await wait(1100)
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue1.name, delay: 7 })
			assert.equal(attributes.vt, 1234)
			assert.equal(attributes.delay, 7)
			assert.equal(attributes.maxsize, 65536)
			assert.ok(attributes.modified > queue1.modified, `${attributes.modified} > ${queue1.modified}`)
		})

		it("setQueueAttributes: Should return the queue with an umlimited maxsize", async () => {
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue1.name, maxsize: -1 })
			assert.equal(attributes.vt, 1234)
			assert.equal(attributes.delay, 7)
			assert.equal(attributes.maxsize, -1)
		})

		it("setQueueAttributes: Should return the queue with a new maxsize attribute", async () => {
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue1.name, maxsize: 2048 })
			assert.equal(attributes.vt, 1234)
			assert.equal(attributes.delay, 7)
			assert.equal(attributes.maxsize, 2048)
		})

		it("setQueueAttributes: Should return the queue with a new attribute", async () => {
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue1.name, maxsize: 65536, vt: 30, delay: 0 })
			assert.equal(attributes.vt, 30)
			assert.equal(attributes.delay, 0)
			assert.equal(attributes.maxsize, 65536)
		})

		it("Should fail:setQueueAttributes: Should not accept too small maxsize", async () => {
			const { err } = await callback((cb) => rsmq.setQueueAttributes({ qname: queue1.name, maxsize: 50 }, cb))
			assert.equal(err.message, "maxsize must be between 1024 and 65536")
		})

		it("Should fail:setQueueAttributes: Should not accept negative value", async () => {
			const { err } = await callback((cb) => rsmq.setQueueAttributes({ qname: queue1.name, vt: -5 }, cb))
			assert.equal(err.message, "vt must be between 0 and 9999999")
		})

		it("should not modify the options object that was handed in", async () => {
			const options = { qname: queue1.name, vt: "30" as unknown as number }
			await rsmq.setQueueAttributesAsync(options)
			assert.equal(options.vt as unknown as string, "30")
		})
	})

	describe("Messages", () => {
		it("Should fail: Send a message to non-existing queue", async () => {
			const { err } = await callback<string>((cb) => rsmq.sendMessage({ qname: "rtlbrmpft", message: "foo" }, cb))
			assert.equal(err.message, "Queue not found")
		})

		it("Should fail: Send a message without any parameters", async () => {
			const { err } = await callback<string>((cb) => rsmq.sendMessage({} as RedisSMQ.SendMessageOptions, cb))
			assert.equal(err.message, "No qname supplied")
		})

		it("Should fail: Send a message without a message key", async () => {
			const { err } = await callback<string>((cb) => rsmq.sendMessage({ qname: queue1.name } as RedisSMQ.SendMessageOptions, cb))
			assert.equal(err.message, "Message must be a string")
		})

		it("Should fail: Send a message with message being a number", async () => {
			const { err } = await callback<string>((cb) => rsmq.sendMessage({ qname: queue1.name, message: 123 as unknown as string }, cb))
			assert.equal(err.message, "Message must be a string")
		})

		it("Send message 1 with existing Redis instance", async () => {
			const { err, resp } = await callback<string>((cb) => rsmq2.sendMessage({ qname: queue1.name, message: "Hello" }, cb))
			assert.equal(err, null)
			q1m1 = resp
		})

		// Send 1000 msgs to q2 so we can delay sending of msg 2 to q1.
		// `send` is detached from the instance on purpose: passing a method around
		// like this has always worked and has to keep working.
		it("Send 1000 messages to queue2: succeed", async () => {
			const send = rsmq.sendMessage
			const ids = await Promise.all(
				Array.from({ length: 1000 }, (_unused, i) => {
					return new Promise<string>((resolve, reject) => {
						send({ qname: queue2.name, message: "test message number:" + i }, (err, id) => {
							if (err) {
								reject(err)
								return
							}
							resolve(id)
						})
					})
				})
			)
			for (const id of ids) {
				assert.equal(id.length, 32)
				q2msgs[id] = 1
			}
			assert.equal(Object.keys(q2msgs).length, 1000)
		})

		it("Send message 2", async () => {
			q1m2 = await rsmq.sendMessageAsync({ qname: queue1.name, message: "World" })
		})

		it("Receive a message. Should return message 1", async () => {
			const message = (await rsmq2.receiveMessageAsync({ qname: queue1.name })) as RedisSMQ.QueueMessage
			assert.equal(message.id, q1m1)
			assert.equal(message.message, "Hello")
			assert.equal(message.rc, 1)
		})

		it("Receive a message. Should return message 2", async () => {
			const message = (await rsmq.receiveMessageAsync({ qname: queue1.name })) as RedisSMQ.QueueMessage
			assert.equal(message.id, q1m2)
		})

		it("Check queue properties. Should have 2 msgs", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue1.name })
			assert.equal(attributes.msgs, 2)
			assert.equal(attributes.hiddenmsgs, 2)
		})

		it("Send message 3", async () => {
			q1m3 = await rsmq.sendMessageAsync({ qname: queue1.name, message: "Booo!!" })
		})

		it("Check queue properties. Should have 3 msgs", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue1.name })
			assert.equal(attributes.msgs, 3)
			assert.equal(attributes.totalrecv, 2)
		})

		it("Pop a message. Should return message 3 and delete it", async () => {
			const message = (await rsmq.popMessageAsync({ qname: queue1.name })) as RedisSMQ.QueueMessage
			assert.equal(message.id, q1m3)
			assert.equal(message.message, "Booo!!")
		})

		it("Check queue properties. Should have 2 msgs", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue1.name })
			assert.equal(attributes.msgs, 2)
			assert.equal(attributes.totalrecv, 3)
		})

		it("Pop a message. Should not return a message", async () => {
			assert.deepEqual(await rsmq.popMessageAsync({ qname: queue1.name }), {})
		})

		it("Should fail. Set the visibility of a non existing message", async () => {
			const resp = await rsmq.changeMessageVisibilityAsync({ qname: queue1.name, id: "abcdefghij0123456789abcdefghij01", vt: 10 })
			assert.equal(resp, 0)
		})

		it("Set new visibility timeout of message 2 to 10s", async () => {
			assert.equal(await rsmq.changeMessageVisibilityAsync({ qname: queue1.name, id: q1m2, vt: 10 }), 1)
		})

		it("Receive a message. Should return nothing", async () => {
			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: queue1.name }), {})
		})

		it("Set new visibility timeout of message 2 to 0s", async () => {
			assert.equal(await rsmq.changeMessageVisibilityAsync({ qname: queue1.name, id: q1m2, vt: 0 }), 1)
		})

		it("Receive a message. Should return message 2", async () => {
			const message = (await rsmq.receiveMessageAsync({ qname: queue1.name })) as RedisSMQ.QueueMessage
			assert.equal(message.id, q1m2)
		})

		it("Receive a message. Should return nothing", async () => {
			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: queue1.name }), {})
		})

		it("Should fail: Delete a message without supplying an id", async () => {
			const { err } = await callback<0 | 1>((cb) => rsmq.deleteMessage({ qname: queue1.name } as RedisSMQ.DeleteMessageOptions, cb))
			assert.equal(err.message, "No id supplied")
		})

		it("Should fail: Delete a message with invalid id", async () => {
			const { err } = await callback<0 | 1>((cb) => rsmq.deleteMessage({ qname: queue1.name, id: "sdafsdf" }, cb))
			assert.equal(err.message, "Invalid id format")
		})

		it("Delete message 1. Should return 1", async () => {
			assert.equal(await rsmq.deleteMessageAsync({ qname: queue1.name, id: q1m1 }), 1)
		})

		it("Delete message 1 again. Should return 0", async () => {
			assert.equal(await rsmq.deleteMessageAsync({ qname: queue1.name, id: q1m1 }), 0)
		})

		it("Set new visibility timeout of message 1. Should return 0.", async () => {
			assert.equal(await rsmq.changeMessageVisibilityAsync({ qname: queue1.name, id: q1m1, vt: 10 }), 0)
		})

		it("Should fail: Send a message that is too long", async () => {
			const message = JSON.stringify(Array.from({ length: 15001 }, (_unused, i) => i))
			const { err, resp } = await callback<string>((cb) => rsmq.sendMessage({ qname: queue1.name, message }, cb))
			assert.equal(resp, undefined)
			assert.equal(err.message, "Message too long")
		})

		it("Receive 1000 messages from queue2 and delete 500 (those where number is even)", async () => {
			// we keep vt = 0 so we can query them again quickly
			const messages = await Promise.all(Array.from({ length: 1000 }, () => rsmq.receiveMessageAsync({ qname: queue2.name, vt: 0 }) as Promise<RedisSMQ.QueueMessage>))
			const toDelete = messages.filter((message) => Number(message.message.split(":")[1]) % 2 === 0)
			assert.equal(toDelete.length, 500)
			for (const message of toDelete) {
				assert.equal(await rsmq.deleteMessageAsync({ qname: queue2.name, id: message.id }), 1)
				delete q2msgs[message.id]
			}
		})

		it("GetQueueAttributes: Should return queue attributes", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue2.name })
			assert.equal(attributes.msgs, 500)
		})

		it("Receive 500 messages from queue2 and delete them", async () => {
			// we keep vt = 0 so we can query them again quickly
			const messages = await Promise.all(Array.from({ length: 500 }, () => rsmq.receiveMessageAsync({ qname: queue2.name, vt: 0 }) as Promise<RedisSMQ.QueueMessage>))
			const toDelete = messages.filter((message) => Number(message.message.split(":")[1]) % 2 === 1)
			assert.equal(toDelete.length, 500)
			for (const message of toDelete) {
				assert.equal(await rsmq.deleteMessageAsync({ qname: queue2.name, id: message.id }), 1)
				delete q2msgs[message.id]
			}
			// q2msgs should be empty
			assert.equal(Object.keys(q2msgs).length, 0)
		})

		it("Receive a message from queue2. Should return {}", async () => {
			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: queue2.name }), {})
		})

		it("GetQueueAttributes: Should return queue attributes", async () => {
			const attributes = await rsmq.getQueueAttributesAsync({ qname: queue2.name })
			assert.equal(attributes.totalrecv, 1500)
			assert.equal(attributes.totalsent, 1000)
			assert.equal(attributes.msgs, 0)
		})

		it("setQueueAttributes: Should return the queue2 with an umlimited maxsize", async () => {
			const attributes = await rsmq.setQueueAttributesAsync({ qname: queue2.name, delay: 0, vt: 30, maxsize: -1 })
			assert.equal(attributes.vt, 30)
			assert.equal(attributes.delay, 0)
			assert.equal(attributes.maxsize, -1)
		})

		it("Send/Recevice a longer than 64k msg to test unlimited functionality", async () => {
			const message = longString()
			const id = await rsmq.sendMessageAsync({ qname: queue2.name, message })
			const received = (await rsmq.receiveMessageAsync({ qname: queue2.name })) as RedisSMQ.QueueMessage
			assert.equal(received.message, message)
			assert.equal(received.id, id)
		})
	})

	describe("Realtime Pub/Sub notifications", () => {
		it("Send another message to queue1", async () => {
			await rsmq.sendMessageAsync({ qname: queue1.name, message: "Another World" })
		})

		it("check queue1 length. Should be 2", async () => {
			await wait(100)
			assert.equal(q1length, 2)
		})

		it("Send another message to queue1", async () => {
			await rsmq.sendMessageAsync({ qname: queue1.name, message: "Another World" })
		})

		it("check queue1 length. Should be 3", async () => {
			await wait(100)
			assert.equal(q1length, 3)
		})

		it("should not publish when realtime is off", async () => {
			const before = q1length
			await rsmq2.sendMessageAsync({ qname: queue1.name, message: "Quiet World" })
			await wait(100)
			assert.equal(q1length, before)
		})
	})

	describe("Message size is measured in bytes", () => {
		// 500 * "€" = 500 characters but 1500 bytes
		const tooLong = "€".repeat(500)
		// 300 * "€" = 300 characters and 900 bytes
		const fits = "€".repeat(300)

		it("Create a new queue: queue4 with a maxsize of 1024", async () => {
			assert.equal(await rsmq.createQueueAsync({ qname: queue4.name, maxsize: 1024 }), 1)
		})

		it("Should fail: Send a multi-byte message that is too long in bytes", async () => {
			assert.equal(tooLong.length, 500)
			assert.equal(Buffer.byteLength(tooLong, "utf8"), 1500)
			await assert.rejects(rsmq.sendMessageAsync({ qname: queue4.name, message: tooLong }), { message: "Message too long" })
		})

		it("Send/Receive a multi-byte message that fits into maxsize", async () => {
			assert.equal(Buffer.byteLength(fits, "utf8"), 900)
			const id = await rsmq.sendMessageAsync({ qname: queue4.name, message: fits })
			const received = (await rsmq.receiveMessageAsync({ qname: queue4.name })) as RedisSMQ.QueueMessage
			assert.equal(received.id, id)
			assert.equal(received.message, fits)
		})

		it("Delete queue4", async () => {
			assert.equal(await rsmq.deleteQueueAsync({ qname: queue4.name }), 1)
		})
	})
})
