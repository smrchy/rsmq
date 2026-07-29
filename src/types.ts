/** The node style callback used by all `rsmq` methods. */
export type Callback<T> = (err: any, response: T) => void

export interface ConstructorOptions {
	/** *(Default: false)* Enable realtime `PUBLISH` of new messages. */
	realtime?: boolean

	/** *(Default: "127.0.0.1")* The Redis server host. Ignored when `client` is supplied. */
	host?: string

	/** *(Default: 6379)* The Redis server port. Ignored when `client` is supplied. */
	port?: number

	/** *(Default: "rsmq")* The namespace prefix used for all keys created by rsmq. */
	ns?: string

	/**
	 * The redis client options. Passed on to `redis.createClient`.
	 * This is a `node-redis` v4+ options object.
	 * See https://github.com/redis/node-redis/blob/master/docs/client-configuration.md
	 */
	options?: any

	/**
	 * An existing `node-redis` (v4 or newer) client instance.
	 * `host`, `port`, `password` and `options` are ignored when it is supplied.
	 */
	client?: any

	/** The password of the Redis server. Ignored when `client` is supplied. */
	password?: string
}

interface BaseOptions {
	/**
	 * The queue name.
	 * Maximum 160 characters; alphanumeric characters, hyphens (-), and underscores (_) are allowed.
	 */
	qname: string
}

export interface CreateQueueOptions extends BaseOptions {
	/**
	 * *(Default: 30)*
	 * The length of time, in seconds, that a message received from a queue will
	 * be invisible to other receiving components when they ask to receive messages.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	vt?: number

	/**
	 * *(Default: 0)*
	 * The time in seconds that the delivery of all new messages in the queue will be delayed.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	delay?: number

	/**
	 * *(Default: 65536)*
	 * The maximum message size in bytes.
	 * Allowed values: 1024-65536 and -1 (for unlimited size)
	 */
	maxsize?: number
}

export interface DeleteQueueOptions extends BaseOptions {}

export interface GetQueueAttributesOptions extends BaseOptions {}

export interface SetQueueAttributesOptions extends BaseOptions {
	/**
	 * The length of time, in seconds, that a message received from a queue will be
	 * invisible to other receiving components when they ask to receive messages.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	vt?: number

	/**
	 * The time in seconds that the delivery of all new messages in the queue will be delayed.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	delay?: number

	/**
	 * The maximum message size in bytes.
	 * Allowed values: 1024-65536 and -1 (for unlimited size)
	 */
	maxsize?: number
}

export interface SendMessageOptions extends BaseOptions {
	/** Message for the queue. */
	message: string

	/**
	 * *(Default: queue settings)*
	 * The time in seconds that the delivery of the message will be delayed.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	delay?: number
}

export interface ReceiveMessageOptions extends BaseOptions {
	/**
	 * *(Default: queue settings)*
	 * The length of time, in seconds, that the received message will be invisible to others.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	vt?: number
}

export interface PopMessageOptions extends BaseOptions {}

export interface DeleteMessageOptions extends BaseOptions {
	/** The message id to delete. */
	id: string
}

export interface ChangeMessageVisibilityOptions extends BaseOptions {
	/** The message id to modify. */
	id: string

	/**
	 * The length of time, in seconds, that this message will not be visible.
	 * Allowed values: 0-9999999 (around 115 days)
	 */
	vt: number
}

export interface QueueMessage {
	/** The message's contents. */
	message: string

	/** The internal message id. */
	id: string

	/** Timestamp of when this message was sent / created. */
	sent: number

	/** Timestamp of when this message was first received. */
	fr: number

	/** Number of times this message was received. */
	rc: number
}

export interface QueueAttributes {
	/** The visibility timeout for the queue in seconds. */
	vt: number

	/** The delay for new messages in seconds. */
	delay: number

	/** The maximum size of a message in bytes. */
	maxsize: number

	/** Total number of messages received from the queue. */
	totalrecv: number

	/** Total number of messages sent to the queue. */
	totalsent: number

	/** Timestamp (epoch in seconds) when the queue was created. */
	created: number

	/** Timestamp (epoch in seconds) when the queue was last modified with `setQueueAttributes`. */
	modified: number

	/** Current number of messages in the queue. */
	msgs: number

	/**
	 * Current number of hidden / not visible messages.
	 * A message can be hidden while "in flight" due to a `vt` parameter or when sent with a `delay`.
	 */
	hiddenmsgs: number
}
