/**
 * A thin wrapper around a `node-redis` client.
 *
 * `rsmq` only ever talks to Redis through raw commands (`sendCommand` /
 * `multi().addCommand()`). That has two upsides:
 *
 * * the replies are the plain Redis replies this code has always been written
 *   against - no per-command reply transformers that change between client
 *   versions,
 * * an existing client that a user hands in via `options.client` works no matter
 *   whether it comes from `redis@4`, `redis@5` or `redis@6`.
 */

/** An argument of a Redis command. Numbers are stringified before sending. */
export type CommandArg = string | number

export interface NodeRedisMulti {
	addCommand(args: Array<string>): NodeRedisMulti
	exec(): Promise<Array<unknown>>
}

/** The part of the `node-redis` client surface that `rsmq` uses. */
export interface NodeRedisClient {
	isOpen: boolean
	isReady: boolean
	connect(): Promise<unknown>
	sendCommand(args: Array<string>): Promise<unknown>
	multi(): NodeRedisMulti
	quit(): Promise<unknown>
	destroy?(): void
	on(event: string, listener: (...args: any[]) => void): unknown
	once(event: string, listener: (...args: any[]) => void): unknown
}

/**
 * Is this a usable `node-redis` (v4 or newer) client?
 *
 * Duck typed on purpose: a client created by a different copy of the `redis`
 * package - a very common setup - would fail an `instanceof` check.
 */
export function isRedisClient(value: unknown): value is NodeRedisClient {
	if (value == null || typeof value !== "object") {
		return false
	}
	const client = value as Partial<NodeRedisClient>
	return typeof client.sendCommand === "function" && typeof client.multi === "function" && typeof client.connect === "function" && typeof client.on === "function"
}

function toArg(arg: CommandArg): string {
	return typeof arg === "string" ? arg : String(arg)
}

function noop(): void {
	// nothing to do
}

/** Same wording as the `ClientClosedError` of `node-redis`. */
function clientClosed(): Error {
	return new Error("The client is closed")
}

/** A timer that never keeps the node process alive on its own. */
function delay(ms: number): Promise<void> {
	return new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, ms)
		timer.unref?.()
	})
}

export class RedisClientWrapper {
	/** The wrapped `node-redis` client. */
	public readonly client: NodeRedisClient

	/** Was the client handed in by the user (`options.client`)? */
	public readonly external: boolean

	private _ready: Promise<void> | null = null
	private _closed = false
	private _markClosed!: () => void
	private _markFailed!: () => void
	/** Resolves once `quit()` or `destroy()` was called. */
	private _closedPromise: Promise<void>
	/** Resolves on the first connection error, i.e. when there is no socket to lose. */
	private _failedPromise: Promise<void>
	/** The connect attempt that is currently in flight, if any. */
	private _connectAttempt: Promise<void> | null = null

	constructor(client: NodeRedisClient, external: boolean) {
		this.client = client
		this.external = external
		this._closedPromise = new Promise<void>((resolve) => {
			this._markClosed = resolve
		})
		this._failedPromise = new Promise<void>((resolve) => {
			this._markFailed = resolve
		})
		this.client.on("error", () => {
			if (!this.client.isReady) {
				this._markFailed()
			}
		})
	}

	/**
	 * Open the connection if it is not open yet.
	 *
	 * A failing `connect()` is not thrown: `node-redis` reports connection
	 * problems on the `error` event and keeps retrying, which is what `rsmq` has
	 * always relied on. Commands simply wait until the client is ready.
	 */
	public async connect(): Promise<void> {
		if (this._closed || this.client.isOpen) {
			return
		}
		const attempt = this.client.connect().then(noop, noop)
		this._connectAttempt = attempt
		// A connect attempt against a server that is not there never settles - it
		// keeps retrying - so the first error and a `quit()` also end the wait.
		await Promise.race([attempt, this._failedPromise, this._closedPromise])
	}

	/** Resolves as soon as the client is ready to take commands. */
	public whenReady(): Promise<void> {
		if (this.client.isReady) {
			return Promise.resolve()
		}
		if (this._closed) {
			return Promise.reject(clientClosed())
		}
		if (!this._ready) {
			this._ready = new Promise<void>((resolve, reject) => {
				this.client.once("ready", () => {
					this._ready = null
					resolve()
				})
				// Never leave a command hanging when the connection is given up on
				this._closedPromise.then(() => {
					this._ready = null
					reject(clientClosed())
				}, noop)
			})
		}
		return this._ready
	}

	/** Send a single command once the client is ready. */
	public async command<T>(args: Array<CommandArg>): Promise<T> {
		await this.whenReady()
		return (await this.client.sendCommand(args.map(toArg))) as T
	}

	/**
	 * Send commands as a `MULTI`/`EXEC` transaction, in the array form the `0.x`
	 * code used: `[["hmget", key, "vt"], ["time"]]`.
	 */
	public async multi<T extends Array<unknown>>(commands: Array<Array<CommandArg>>): Promise<T> {
		await this.whenReady()
		const multi = this.client.multi()
		for (const command of commands) {
			multi.addCommand(command.map(toArg))
		}
		return (await multi.exec()) as T
	}

	/** `SCRIPT LOAD`, returns the sha1 of the script. */
	public scriptLoad(script: string): Promise<string> {
		return this.command<string>(["script", "load", script])
	}

	/**
	 * Close the connection. Always resolves - a client that is not connected, is
	 * still busy reconnecting or refuses to shut down gets destroyed instead, so
	 * that `quit()` reliably lets a node process exit.
	 */
	public async quit(): Promise<string> {
		this._closed = true
		this._markClosed()

		if (this._connectAttempt) {
			// A client must never be dropped while its socket is still being
			// established: `node-redis` finishes opening it right afterwards and then
			// considers itself closed, so that socket would stay open forever and keep
			// the node process alive. Waiting ends on the first connection error (there
			// is no socket then) and after a second in the worst case.
			await Promise.race([this._connectAttempt, this._failedPromise, delay(1000)])
		}

		// A `QUIT` needs an established connection. A client that never got one or is
		// busy reconnecting is dropped instead.
		if (!this.client.isOpen || !this.client.isReady) {
			this.destroy()
			return "OK"
		}

		const reply = await Promise.race([this.client.quit().catch(() => null), delay(1000).then(() => null)])
		if (reply === null) {
			this.destroy()
			return "OK"
		}
		return typeof reply === "string" ? reply : "OK"
	}

	/** Drop the connection without a `QUIT` and stop any reconnect attempts. */
	public destroy(): void {
		this._closed = true
		this._markClosed()
		try {
			this.client.destroy?.()
		} catch {
			// already destroyed
		}
	}
}
