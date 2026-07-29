import assert from "node:assert/strict"
import { after, describe, it } from "node:test"
import { createClient } from "redis"
import RedisSMQ from "../dist/index.js"

/**
 * The queue semantics that the rest of the suite only touches in passing:
 * delay, visibility timeout, exactly-once delivery, message ids and the
 * remaining validation paths.
 */

const DELAY_Q = "testdelay"
const QUEUE_DELAY_Q = "testqueuedelay"
const VT_Q = "testvt"
const ONCE_Q = "testonce"
const ID_Q = "testids"

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

describe("Queue semantics", () => {
	const rsmq = new RedisSMQ()

	after(async () => {
		for (const qname of [DELAY_Q, QUEUE_DELAY_Q, VT_Q, ONCE_Q, ID_Q]) {
			await rsmq.deleteQueueAsync({ qname }).catch(() => {})
		}
		await rsmq.quitAsync()
	})

	describe("delay", () => {
		it("hides a message that was sent with a delay", async () => {
			await rsmq.createQueueAsync({ qname: DELAY_Q, vt: 0 })
			const id = await rsmq.sendMessageAsync({ qname: DELAY_Q, message: "later", delay: 1 })

			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: DELAY_Q }), {}, "should not be visible yet")
			const attributes = await rsmq.getQueueAttributesAsync({ qname: DELAY_Q })
			assert.equal(attributes.msgs, 1)
			assert.equal(attributes.hiddenmsgs, 1)

			await wait(1050)
			const message = (await rsmq.receiveMessageAsync({ qname: DELAY_Q })) as RedisSMQ.QueueMessage
			assert.equal(message.id, id)
			assert.equal(message.message, "later")
			// the queue has `vt: 0`, so the message stays visible - take it out
			assert.equal(await rsmq.deleteMessageAsync({ qname: DELAY_Q, id }), 1)
		})

		it("uses the delay of the queue when the message has none", async () => {
			await rsmq.createQueueAsync({ qname: QUEUE_DELAY_Q, vt: 0, delay: 1 })
			const id = await rsmq.sendMessageAsync({ qname: QUEUE_DELAY_Q, message: "queue delay" })

			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: QUEUE_DELAY_Q }), {}, "should not be visible yet")
			await wait(1050)
			const message = (await rsmq.receiveMessageAsync({ qname: QUEUE_DELAY_Q })) as RedisSMQ.QueueMessage
			assert.equal(message.id, id)
			assert.equal(await rsmq.deleteMessageAsync({ qname: QUEUE_DELAY_Q, id }), 1)
		})

		it("lets `delay: 0` override the delay of the queue", async () => {
			const id = await rsmq.sendMessageAsync({ qname: QUEUE_DELAY_Q, message: "right away", delay: 0 })
			const message = (await rsmq.receiveMessageAsync({ qname: QUEUE_DELAY_Q })) as RedisSMQ.QueueMessage
			assert.equal(message.id, id)
		})

		it("rejects an invalid delay", async () => {
			await assert.rejects(rsmq.sendMessageAsync({ qname: DELAY_Q, message: "nope", delay: -1 }), {
				name: "invalidValue",
				message: "delay must be between 0 and 9999999"
			})
		})
	})

	describe("visibility timeout", () => {
		it("hides a received message for `vt` seconds and keeps the first receive time", async () => {
			await rsmq.createQueueAsync({ qname: VT_Q, vt: 1 })
			const id = await rsmq.sendMessageAsync({ qname: VT_Q, message: "comes back" })

			const first = (await rsmq.receiveMessageAsync({ qname: VT_Q })) as RedisSMQ.QueueMessage
			assert.equal(first.id, id)
			assert.equal(first.rc, 1)
			assert.ok(first.fr > 0, "fr should be the time of the first receive")

			assert.deepEqual(await rsmq.receiveMessageAsync({ qname: VT_Q }), {}, "should be invisible while the vt runs")
			const attributes = await rsmq.getQueueAttributesAsync({ qname: VT_Q })
			assert.equal(attributes.msgs, 1)
			assert.equal(attributes.hiddenmsgs, 1)

			await wait(1050)
			const second = (await rsmq.receiveMessageAsync({ qname: VT_Q })) as RedisSMQ.QueueMessage
			assert.equal(second.id, id)
			assert.equal(second.rc, 2, "the receive counter goes up")
			assert.equal(second.fr, first.fr, "fr stays the time of the *first* receive")
		})

		it("rejects an invalid vt on receiveMessage", async () => {
			await assert.rejects(rsmq.receiveMessageAsync({ qname: VT_Q, vt: -1 }), {
				message: "vt must be between 0 and 9999999"
			})
		})
	})

	describe("delivery to exactly one recipient", () => {
		it("hands a message to one receiver only, no matter how many ask at once", async () => {
			const other = new RedisSMQ()
			await rsmq.createQueueAsync({ qname: ONCE_Q, vt: 30 })
			const id = await rsmq.sendMessageAsync({ qname: ONCE_Q, message: "only once" })

			// two instances, ten receives, all at the same time
			const results = await Promise.all(
				Array.from({ length: 10 }, (_unused, i) => {
					return (i % 2 === 0 ? rsmq : other).receiveMessageAsync({ qname: ONCE_Q }) as Promise<RedisSMQ.QueueMessage>
				})
			)

			const received = results.filter((message) => message.id === id)
			assert.equal(received.length, 1, "exactly one receiver gets the message")
			assert.equal(results.length - received.length, 9, "everyone else gets an empty object")
			for (const message of results) {
				if (message.id === undefined) {
					assert.deepEqual(message, {})
				}
			}

			const attributes = await rsmq.getQueueAttributesAsync({ qname: ONCE_Q })
			assert.equal(attributes.totalrecv, 1, "only the successful receive is counted")
			await other.quitAsync()
		})
	})

	describe("message ids", () => {
		it("are 32 characters and carry the send time", async () => {
			await rsmq.createQueueAsync({ qname: ID_Q, vt: 0 })
			const before = Date.now()
			const id = await rsmq.sendMessageAsync({ qname: ID_Q, message: "id check" })

			assert.match(id, /^[a-zA-Z0-9]{32}$/)
			// popMessage so the message does not stay behind in this `vt: 0` queue
			const message = (await rsmq.popMessageAsync({ qname: ID_Q })) as RedisSMQ.QueueMessage
			assert.equal(message.id, id)
			assert.ok(Math.abs(message.sent - before) < 5000, `sent (${message.sent}) should be around now (${before})`)
		})

		it("sort by the time the message was sent", async () => {
			const ids = []
			for (let i = 0; i < 3; i++) {
				ids.push(await rsmq.sendMessageAsync({ qname: ID_Q, message: "message " + i }))
			}
			// the first 10 characters are the redis time in base 36
			const times = ids.map((id) => parseInt(id.slice(0, 10), 36))
			assert.ok(times[0] <= times[1] && times[1] <= times[2], `not ascending: ${times.join(", ")}`)
			// and that is also the order they are received in
			for (const id of ids) {
				const message = (await rsmq.popMessageAsync({ qname: ID_Q })) as RedisSMQ.QueueMessage
				assert.equal(message.id, id)
			}
		})
	})

	describe("validation", () => {
		it("needs a vt for changeMessageVisibility", async () => {
			const id = await rsmq.sendMessageAsync({ qname: ID_Q, message: "no vt" })
			await assert.rejects(rsmq.changeMessageVisibilityAsync({ qname: ID_Q, id } as RedisSMQ.ChangeMessageVisibilityOptions), {
				message: "vt must be between 0 and 9999999"
			})
		})

		it("needs a qname for popMessage", async () => {
			await assert.rejects(rsmq.popMessageAsync({} as RedisSMQ.PopMessageOptions), {
				name: "missingParameter",
				message: "No qname supplied"
			})
		})

		it("reports a missing queue on deleteQueue", async () => {
			await assert.rejects(rsmq.deleteQueueAsync({ qname: "doesnotexist" }), {
				name: "queueNotFound",
				message: "Queue not found"
			})
		})
	})
})

describe("Realtime notifications", () => {
	const NS = "testrt"
	const QNAME = "rtqueue"

	it("publishes the new queue length to `{ns}:rt:{qname}`", async () => {
		const rsmq = new RedisSMQ({ ns: NS, realtime: true })
		const subscriber = createClient()
		await subscriber.connect()

		const lengths: Array<string> = []
		await subscriber.subscribe(`${NS}:rt:${QNAME}`, (message: string) => {
			lengths.push(message)
		})

		await rsmq.deleteQueueAsync({ qname: QNAME }).catch(() => {})
		await rsmq.createQueueAsync({ qname: QNAME, vt: 30 })
		await rsmq.sendMessageAsync({ qname: QNAME, message: "one" })
		await rsmq.sendMessageAsync({ qname: QNAME, message: "two" })
		await wait(200)

		assert.deepEqual(lengths, ["1", "2"], "each message publishes the number of messages in the queue")

		await subscriber.unsubscribe(`${NS}:rt:${QNAME}`)
		await subscriber.quit()
		await rsmq.deleteQueueAsync({ qname: QNAME })
		await rsmq.quitAsync()
	})
})
