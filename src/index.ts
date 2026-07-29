/*
 ____    ____    __  __    ___
|  _ \  / ___|  |  \/  |  / _ \
| |_) | \___ \  | |\/| | | | | |
|  _ <   ___) | | |  | | | |_| |
|_| \_\ |____/  |_|  |_|  \__\_\

A Really Simple Message Queue based on Redis

*/
import { createClient } from "redis"
import { type CommandArg, isRedisClient, type NodeRedisClient, RedisClientWrapper } from "./client"
import { RsmqEventEmitterBase } from "./emitter"
import { rsmqError } from "./errors"
import { type ScriptName, SCRIPTS } from "./scripts"
import type * as T from "./types"
import { validId, validMaxsize, validQname, validSeconds } from "./validate"

const DEFAULT_HOST = "127.0.0.1"
const DEFAULT_PORT = 6379
const DEFAULT_NS = "rsmq"
const DEFAULT_VT = 30
const DEFAULT_DELAY = 0
const DEFAULT_MAXSIZE = 65536

/** Options that belong to rsmq itself and must not be forwarded to the redis client. */
const RSMQ_OPTIONS = ["client", "ns", "realtime", "options", "host", "port", "password"]

/** The attributes a queue is defined by, plus the current Redis time. */
interface Queue {
	vt: number
	delay: number
	maxsize: number
	/** The Redis time in ms when the queue was read. */
	ts: number
	/** A fresh message id. Only set when one was requested. */
	uid?: string
}

/**
 * Build the `redis.createClient` options.
 *
 * Everything that is not an rsmq option is passed through - both from the top
 * level (as in `0.x`) and from the documented `options` object, which is now a
 * `node-redis` v4+ options object. `host` / `port` / `password` are mapped into
 * their new places.
 */
function buildClientOptions(options: T.ConstructorOptions): Record<string, any> {
	const clientOptions: Record<string, any> = {}
	for (const key of Object.keys(options)) {
		if (RSMQ_OPTIONS.indexOf(key) === -1) {
			clientOptions[key] = (options as Record<string, any>)[key]
		}
	}
	Object.assign(clientOptions, options.options)

	if (options.password != null && clientOptions.password == null) {
		clientOptions.password = options.password
	}
	// `db` was the name in the redis@3 options object rsmq used to take
	if (clientOptions.db != null && clientOptions.database == null) {
		clientOptions.database = clientOptions.db
		delete clientOptions.db
	}

	const socket: Record<string, any> = { ...clientOptions.socket }
	if (options.host != null || (socket.host == null && clientOptions.url == null)) {
		socket.host = options.host ?? DEFAULT_HOST
	}
	if (options.port != null || (socket.port == null && clientOptions.url == null)) {
		socket.port = options.port ?? DEFAULT_PORT
	}
	clientOptions.socket = socket
	return clientOptions
}

function formatZeroPad(num: number, count: number): string {
	return (Math.pow(10, count) + num + "").slice(1)
}

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"

function makeid(len: number): string {
	let text = ""
	for (let i = 0; i < len; i++) {
		text += ID_CHARS.charAt(Math.floor(Math.random() * ID_CHARS.length))
	}
	return text
}

function isNoScriptError(err: unknown): boolean {
	const message = (err as { message?: string } | null)?.message
	return typeof message === "string" && message.indexOf("NOSCRIPT") !== -1
}

/**
 * Hand the result of an internal promise to a node style callback, or return the
 * promise when no callback was supplied.
 *
 * The callback is invoked from a fresh microtask so that an exception thrown
 * inside it does not turn into an unhandled promise rejection.
 */
function respond<R>(promise: Promise<R>, cb?: T.Callback<R>): Promise<R> | void {
	if (typeof cb !== "function") {
		return promise
	}
	promise.then(
		(result) => {
			queueMicrotask(() => cb(null, result))
		},
		(err) => {
			queueMicrotask(() => cb(err, undefined as never))
		}
	)
}

/** The methods that are bound to the instance, so they can be passed around detached. */
const PUBLIC_METHODS = [
	"changeMessageVisibility",
	"createQueue",
	"deleteMessage",
	"deleteQueue",
	"getQueueAttributes",
	"listQueues",
	"popMessage",
	"receiveMessage",
	"sendMessage",
	"setQueueAttributes",
	"quit"
] as const

/**
 * A Really Simple Message Queue based on Redis.
 *
 * ```js
 * const RedisSMQ = require("rsmq")
 * const rsmq = new RedisSMQ({ host: "127.0.0.1", port: 6379, ns: "rsmq" })
 * ```
 *
 * Every method takes a node style callback and returns a promise when the
 * callback is omitted. The `*Async` variants of `0.x` are still there and always
 * return a promise.
 *
 * Emits `connect`, `disconnect` and `error`.
 */
class RedisSMQ extends RsmqEventEmitterBase {
	/** The underlying `node-redis` client. */
	public redis: NodeRedisClient

	/** Is realtime `PUBLISH` of new messages enabled? */
	public realtime: boolean

	/** The key prefix of all keys created by this instance, e.g. `rsmq:`. */
	public redisns: string

	/** Is the Redis client connected and ready? */
	public connected: boolean

	private _client: RedisClientWrapper
	private _scripts: Promise<Record<ScriptName, string>> | null = null

	constructor(options: T.ConstructorOptions = {}) {
		super()
		this.realtime = options.realtime === true
		this.redisns = (options.ns ?? DEFAULT_NS) + ":"

		if (options.client != null) {
			if (!isRedisClient(options.client)) {
				throw rsmqError("invalidClient")
			}
			this.redis = options.client
			this._client = new RedisClientWrapper(this.redis, true)
		} else {
			this.redis = createClient(buildClientOptions(options)) as unknown as NodeRedisClient
			this._client = new RedisClientWrapper(this.redis, false)
		}

		const self = this as unknown as Record<string, (...args: any[]) => any>
		for (const name of PUBLIC_METHODS) {
			self[name] = self[name].bind(this)
			self[`${name}Async`] = self[`${name}Async`].bind(this)
		}

		this.connected = this.redis.isReady === true
		this._listen()

		// An existing client that was handed in may be connected already. Emit on
		// the next tick, so a listener attached right after `new RedisSMQ()` sees it.
		if (this.connected) {
			setImmediate(() => {
				this.emit("connect")
			})
			void this._loadScripts()
		}
		void this._client.connect()
	}

	private _listen(): void {
		this.redis.on("ready", () => {
			this.connected = true
			// The scripts have to be loaded again: a reconnect may have landed on a
			// different Redis instance or one that was restarted.
			this._scripts = null
			this.emit("connect")
			void this._loadScripts()
		})

		this.redis.on("end", () => {
			this.connected = false
		})

		this.redis.on("error", (err: any) => {
			const message = (err && err.message) || ""
			if ((err && err.code === "ECONNREFUSED") || message.indexOf("ECONNREFUSED") !== -1) {
				this.connected = false
				this.emit("disconnect")
				return
			}
			this._onError(err)
		})
	}

	/**
	 * Route an error to the `error` listeners. An unhandled `error` event would
	 * take the whole process down, so it is only emitted when someone listens.
	 */
	private _onError(err: any): void {
		if (this.listenerCount("error") > 0) {
			this.emit("error", err)
			return
		}
		console.error("Redis ERROR", err)
	}

	/** Load the LUA scripts and cache their sha1 by script name. */
	private _loadScripts(): Promise<Record<ScriptName, string>> {
		if (!this._scripts) {
			const names = Object.keys(SCRIPTS) as Array<ScriptName>
			const loading = (async () => {
				const shas = await Promise.all(
					names.map(async (name) => {
						const sha = await this._client.scriptLoad(SCRIPTS[name])
						// Kept for compatibility: 0.x announced every loaded script
						this.emit(`scriptload:${name}`)
						return [name, sha] as const
					})
				)
				return Object.fromEntries(shas) as Record<ScriptName, string>
			})()
			this._scripts = loading
			loading.catch(() => {
				if (this._scripts === loading) {
					this._scripts = null
				}
			})
		}
		return this._scripts
	}

	/** Run one of the LUA scripts, reloading it once when Redis lost it. */
	private async _evalsha<R>(name: ScriptName, keys: Array<CommandArg>): Promise<R> {
		const shas = await this._loadScripts()
		const command: Array<CommandArg> = ["evalsha", shas[name], keys.length, ...keys]
		try {
			return await this._client.command<R>(command)
		} catch (err) {
			if (!isNoScriptError(err)) {
				throw err
			}
			this._scripts = null
			const reloaded = await this._loadScripts()
			command[1] = reloaded[name]
			return await this._client.command<R>(command)
		}
	}

	/**
	 * Read the queue attributes and the current Redis time, optionally with a new
	 * message id.
	 *
	 * The first 10 characters of a message id are the Redis time in base 36, which
	 * is what makes Redis order messages correctly even within the same millisecond.
	 */
	private async _getQueue(qname: string, uid: boolean): Promise<Queue> {
		const [attributes, time] = await this._client.multi<[Array<string | null>, [string, string]]>([
			["hmget", `${this.redisns}${qname}:Q`, "vt", "delay", "maxsize"],
			["time"]
		])

		if (attributes[0] === null || attributes[1] === null || attributes[2] === null) {
			throw rsmqError("queueNotFound")
		}

		// Make sure to always have correct 6digit millionth seconds from redis
		const ms = formatZeroPad(Number(time[1]), 6)
		const queue: Queue = {
			vt: parseInt(attributes[0], 10),
			delay: parseInt(attributes[1], 10),
			maxsize: parseInt(attributes[2], 10),
			// Create the epoch time in ms from the redis timestamp
			ts: Number(time[0] + ms.slice(0, 3))
		}

		if (uid) {
			queue.uid = Number(time[0] + ms).toString(36) + makeid(22)
		}
		return queue
	}

	private _formatMessage(reply: Array<any>): T.QueueMessage | {} {
		if (!reply.length) {
			return {}
		}
		return {
			id: reply[0],
			message: reply[1],
			rc: reply[2],
			fr: Number(reply[3]),
			sent: Number(parseInt(String(reply[0]).slice(0, 10), 36) / 1000)
		}
	}

	// --- createQueue -------------------------------------------------------------

	/** Create a new queue. */
	public createQueue(options: T.CreateQueueOptions, cb: T.Callback<1>): void
	public createQueue(options: T.CreateQueueOptions): Promise<1>
	public createQueue(options: T.CreateQueueOptions, cb?: T.Callback<1>): Promise<1> | void {
		return respond(this._createQueue(options), cb)
	}

	/** Create a new queue. */
	public createQueueAsync(options: T.CreateQueueOptions): Promise<1> {
		return this._createQueue(options)
	}

	private async _createQueue(options: T.CreateQueueOptions): Promise<1> {
		const qname = validQname(options.qname)
		const vt = validSeconds("vt", options.vt ?? DEFAULT_VT)
		const delay = validSeconds("delay", options.delay ?? DEFAULT_DELAY)
		const maxsize = validMaxsize(options.maxsize ?? DEFAULT_MAXSIZE)
		const key = `${this.redisns}${qname}:Q`

		const time = await this._client.command<[string, string]>(["time"])
		const replies = await this._client.multi<Array<number>>([
			["hsetnx", key, "vt", vt],
			["hsetnx", key, "delay", delay],
			["hsetnx", key, "maxsize", maxsize],
			["hsetnx", key, "created", time[0]],
			["hsetnx", key, "modified", time[0]]
		])

		if (replies[0] === 0) {
			throw rsmqError("queueExists")
		}
		// We created a new queue. Also store it in the global set to keep an index
		// of all queues.
		await this._client.command(["sadd", `${this.redisns}QUEUES`, qname])
		return 1
	}

	// --- listQueues --------------------------------------------------------------

	/** List all queues. */
	public listQueues(cb: T.Callback<Array<string>>): void
	public listQueues(): Promise<Array<string>>
	public listQueues(cb?: T.Callback<Array<string>>): Promise<Array<string>> | void {
		return respond(this._listQueues(), cb)
	}

	/** List all queues. */
	public listQueuesAsync(): Promise<Array<string>> {
		return this._listQueues()
	}

	private _listQueues(): Promise<Array<string>> {
		return this._client.command<Array<string>>(["smembers", `${this.redisns}QUEUES`])
	}

	// --- deleteQueue -------------------------------------------------------------

	/** Delete a queue and all its messages. */
	public deleteQueue(options: T.DeleteQueueOptions, cb: T.Callback<1>): void
	public deleteQueue(options: T.DeleteQueueOptions): Promise<1>
	public deleteQueue(options: T.DeleteQueueOptions, cb?: T.Callback<1>): Promise<1> | void {
		return respond(this._deleteQueue(options), cb)
	}

	/** Delete a queue and all its messages. */
	public deleteQueueAsync(options: T.DeleteQueueOptions): Promise<1> {
		return this._deleteQueue(options)
	}

	private async _deleteQueue(options: T.DeleteQueueOptions): Promise<1> {
		const qname = validQname(options.qname)
		const key = `${this.redisns}${qname}`
		const replies = await this._client.multi<Array<number>>([
			// The queue hash and messages zset
			["del", `${key}:Q`, key],
			["srem", `${this.redisns}QUEUES`, qname]
		])

		if (replies[0] === 0) {
			throw rsmqError("queueNotFound")
		}
		return 1
	}

	// --- getQueueAttributes ------------------------------------------------------

	/** Get queue attributes, message count and hidden message count of a queue. */
	public getQueueAttributes(options: T.GetQueueAttributesOptions, cb: T.Callback<T.QueueAttributes>): void
	public getQueueAttributes(options: T.GetQueueAttributesOptions): Promise<T.QueueAttributes>
	public getQueueAttributes(options: T.GetQueueAttributesOptions, cb?: T.Callback<T.QueueAttributes>): Promise<T.QueueAttributes> | void {
		return respond(this._getQueueAttributes(options), cb)
	}

	/** Get queue attributes, message count and hidden message count of a queue. */
	public getQueueAttributesAsync(options: T.GetQueueAttributesOptions): Promise<T.QueueAttributes> {
		return this._getQueueAttributes(options)
	}

	private async _getQueueAttributes(options: T.GetQueueAttributesOptions): Promise<T.QueueAttributes> {
		const qname = validQname(options.qname)
		const key = `${this.redisns}${qname}`
		const time = await this._client.command<[string, string]>(["time"])

		// Get basic attributes and counters, the total number of messages and the
		// number of messages in flight (not visible yet).
		const [attributes, msgs, hiddenmsgs] = await this._client.multi<[Array<string | null>, number, number]>([
			["hmget", `${key}:Q`, "vt", "delay", "maxsize", "totalrecv", "totalsent", "created", "modified"],
			["zcard", key],
			["zcount", key, time[0] + "000", "+inf"]
		])

		if (attributes[0] === null) {
			throw rsmqError("queueNotFound")
		}

		return {
			vt: parseInt(attributes[0], 10),
			delay: parseInt(attributes[1] as string, 10),
			maxsize: parseInt(attributes[2] as string, 10),
			totalrecv: parseInt(attributes[3] as string, 10) || 0,
			totalsent: parseInt(attributes[4] as string, 10) || 0,
			created: parseInt(attributes[5] as string, 10),
			modified: parseInt(attributes[6] as string, 10),
			msgs,
			hiddenmsgs
		}
	}

	// --- setQueueAttributes ------------------------------------------------------

	/** Change the `vt`, `delay` and / or `maxsize` of a queue. */
	public setQueueAttributes(options: T.SetQueueAttributesOptions, cb: T.Callback<T.QueueAttributes>): void
	public setQueueAttributes(options: T.SetQueueAttributesOptions): Promise<T.QueueAttributes>
	public setQueueAttributes(options: T.SetQueueAttributesOptions, cb?: T.Callback<T.QueueAttributes>): Promise<T.QueueAttributes> | void {
		return respond(this._setQueueAttributes(options), cb)
	}

	/** Change the `vt`, `delay` and / or `maxsize` of a queue. */
	public setQueueAttributesAsync(options: T.SetQueueAttributesOptions): Promise<T.QueueAttributes> {
		return this._setQueueAttributes(options)
	}

	private async _setQueueAttributes(options: T.SetQueueAttributesOptions): Promise<T.QueueAttributes> {
		const supplied = (["vt", "maxsize", "delay"] as const).filter((item) => options[item] != null)
		// Not a single key was supplied
		if (supplied.length === 0) {
			throw rsmqError("noAttributeSupplied")
		}

		const qname = validQname(options.qname)
		const attributes = supplied.map((item): [string, number] => {
			if (item === "maxsize") {
				return [item, validMaxsize(options.maxsize)]
			}
			return [item, validSeconds(item, options[item])]
		})

		const key = `${this.redisns}${qname}:Q`
		// Makes sure the queue exists
		await this._getQueue(qname, false)
		const time = await this._client.command<[string, string]>(["time"])

		const commands: Array<Array<CommandArg>> = [["hset", key, "modified", time[0]]]
		for (const [item, value] of attributes) {
			commands.push(["hset", key, item, value])
		}
		await this._client.multi(commands)
		return this._getQueueAttributes({ qname })
	}

	// --- sendMessage -------------------------------------------------------------

	/** Send a message to a queue. Resolves with the message id. */
	public sendMessage(options: T.SendMessageOptions, cb: T.Callback<string>): void
	public sendMessage(options: T.SendMessageOptions): Promise<string>
	public sendMessage(options: T.SendMessageOptions, cb?: T.Callback<string>): Promise<string> | void {
		return respond(this._sendMessage(options), cb)
	}

	/** Send a message to a queue. Resolves with the message id. */
	public sendMessageAsync(options: T.SendMessageOptions): Promise<string> {
		return this._sendMessage(options)
	}

	private async _sendMessage(options: T.SendMessageOptions): Promise<string> {
		const qname = validQname(options.qname)
		const queue = await this._getQueue(qname, true)
		// Now that we got the default queue settings
		const delay = validSeconds("delay", options.delay ?? queue.delay)

		// Check the message
		if (typeof options.message !== "string") {
			throw rsmqError("messageNotString")
		}
		// Check the message size in bytes (maxsize is documented as bytes)
		if (queue.maxsize !== -1 && Buffer.byteLength(options.message, "utf8") > queue.maxsize) {
			throw rsmqError("messageTooLong")
		}

		// Ready to store the message
		const uid = queue.uid as string
		const key = `${this.redisns}${qname}`
		const commands: Array<Array<CommandArg>> = [
			["zadd", key, queue.ts + delay * 1000, uid],
			["hset", `${key}:Q`, uid, options.message],
			["hincrby", `${key}:Q`, "totalsent", 1]
		]
		if (this.realtime) {
			commands.push(["zcard", key])
		}

		const replies = await this._client.multi<Array<any>>(commands)
		if (this.realtime) {
			// Not awaited on purpose: a `PUBLISH` must not slow down `sendMessage`
			this._client.command(["publish", `${this.redisns}rt:${qname}`, replies[3]]).catch((err) => {
				this._onError(err)
			})
		}
		return uid
	}

	// --- receiveMessage ----------------------------------------------------------

	/** Receive the next message from the queue and hide it for `vt` seconds. */
	public receiveMessage(options: T.ReceiveMessageOptions, cb: T.Callback<T.QueueMessage | {}>): void
	public receiveMessage(options: T.ReceiveMessageOptions): Promise<T.QueueMessage | {}>
	public receiveMessage(options: T.ReceiveMessageOptions, cb?: T.Callback<T.QueueMessage | {}>): Promise<T.QueueMessage | {}> | void {
		return respond(this._receiveMessage(options), cb)
	}

	/** Receive the next message from the queue and hide it for `vt` seconds. */
	public receiveMessageAsync(options: T.ReceiveMessageOptions): Promise<T.QueueMessage | {}> {
		return this._receiveMessage(options)
	}

	private async _receiveMessage(options: T.ReceiveMessageOptions): Promise<T.QueueMessage | {}> {
		const qname = validQname(options.qname)
		const queue = await this._getQueue(qname, false)
		// Now that we got the default queue settings
		const vt = validSeconds("vt", options.vt ?? queue.vt)

		const reply = await this._evalsha<Array<any>>("receiveMessage", [`${this.redisns}${qname}`, queue.ts, queue.ts + vt * 1000])
		return this._formatMessage(reply)
	}

	// --- popMessage --------------------------------------------------------------

	/** Receive the next message from the queue and delete it. */
	public popMessage(options: T.PopMessageOptions, cb: T.Callback<T.QueueMessage | {}>): void
	public popMessage(options: T.PopMessageOptions): Promise<T.QueueMessage | {}>
	public popMessage(options: T.PopMessageOptions, cb?: T.Callback<T.QueueMessage | {}>): Promise<T.QueueMessage | {}> | void {
		return respond(this._popMessage(options), cb)
	}

	/** Receive the next message from the queue and delete it. */
	public popMessageAsync(options: T.PopMessageOptions): Promise<T.QueueMessage | {}> {
		return this._popMessage(options)
	}

	private async _popMessage(options: T.PopMessageOptions): Promise<T.QueueMessage | {}> {
		const qname = validQname(options.qname)
		const queue = await this._getQueue(qname, false)
		const reply = await this._evalsha<Array<any>>("popMessage", [`${this.redisns}${qname}`, queue.ts])
		return this._formatMessage(reply)
	}

	// --- deleteMessage -----------------------------------------------------------

	/** Delete a message. Resolves with `1` when it was deleted, `0` when it was not there. */
	public deleteMessage(options: T.DeleteMessageOptions, cb: T.Callback<0 | 1>): void
	public deleteMessage(options: T.DeleteMessageOptions): Promise<0 | 1>
	public deleteMessage(options: T.DeleteMessageOptions, cb?: T.Callback<0 | 1>): Promise<0 | 1> | void {
		return respond(this._deleteMessage(options), cb)
	}

	/** Delete a message. Resolves with `1` when it was deleted, `0` when it was not there. */
	public deleteMessageAsync(options: T.DeleteMessageOptions): Promise<0 | 1> {
		return this._deleteMessage(options)
	}

	private async _deleteMessage(options: T.DeleteMessageOptions): Promise<0 | 1> {
		const qname = validQname(options.qname)
		const id = validId(options.id)
		const key = `${this.redisns}${qname}`
		const replies = await this._client.multi<Array<number>>([
			["zrem", key, id],
			["hdel", `${key}:Q`, id, `${id}:rc`, `${id}:fr`]
		])
		return replies[0] === 1 && replies[1] > 0 ? 1 : 0
	}

	// --- changeMessageVisibility -------------------------------------------------

	/** Change the visibility timer of a single message. */
	public changeMessageVisibility(options: T.ChangeMessageVisibilityOptions, cb: T.Callback<0 | 1>): void
	public changeMessageVisibility(options: T.ChangeMessageVisibilityOptions): Promise<0 | 1>
	public changeMessageVisibility(options: T.ChangeMessageVisibilityOptions, cb?: T.Callback<0 | 1>): Promise<0 | 1> | void {
		return respond(this._changeMessageVisibility(options), cb)
	}

	/** Change the visibility timer of a single message. */
	public changeMessageVisibilityAsync(options: T.ChangeMessageVisibilityOptions): Promise<0 | 1> {
		return this._changeMessageVisibility(options)
	}

	private async _changeMessageVisibility(options: T.ChangeMessageVisibilityOptions): Promise<0 | 1> {
		const qname = validQname(options.qname)
		const id = validId(options.id)
		const vt = validSeconds("vt", options.vt)
		// We can only set the visibility of a message if it really exists, so this
		// is done in a LUA script.
		const queue = await this._getQueue(qname, false)
		return this._evalsha<0 | 1>("changeMessageVisibility", [`${this.redisns}${qname}`, id, queue.ts + vt * 1000])
	}

	// --- quit --------------------------------------------------------------------

	/** Close the Redis connection, so a node script is able to exit. */
	public quit(cb: T.Callback<string>): void
	public quit(): Promise<string>
	public quit(cb?: T.Callback<string>): Promise<string> | void {
		return respond(this._quit(), cb)
	}

	/** Close the Redis connection, so a node script is able to exit. */
	public quitAsync(): Promise<string> {
		return this._quit()
	}

	private _quit(): Promise<string> {
		return this._client.quit()
	}
}

declare namespace RedisSMQ {
	export type Callback<R> = T.Callback<R>
	export type ConstructorOptions = T.ConstructorOptions
	export type CreateQueueOptions = T.CreateQueueOptions
	export type DeleteQueueOptions = T.DeleteQueueOptions
	export type GetQueueAttributesOptions = T.GetQueueAttributesOptions
	export type SetQueueAttributesOptions = T.SetQueueAttributesOptions
	export type SendMessageOptions = T.SendMessageOptions
	export type ReceiveMessageOptions = T.ReceiveMessageOptions
	export type PopMessageOptions = T.PopMessageOptions
	export type DeleteMessageOptions = T.DeleteMessageOptions
	export type ChangeMessageVisibilityOptions = T.ChangeMessageVisibilityOptions
	export type QueueMessage = T.QueueMessage
	export type QueueAttributes = T.QueueAttributes
}

export = RedisSMQ
