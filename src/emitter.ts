import { EventEmitter } from "node:events"

/**
 * The event surface of a {@link RedisSMQ} instance.
 *
 * `rsmq` extends Node's `EventEmitter` at runtime, but the typings deliberately
 * describe only the methods below instead of re-exporting Node's `EventEmitter`
 * type: that way a consuming project does not need `@types/node` installed to
 * use the shipped typings (see `test/typings`).
 */
export interface RsmqEventEmitter {
	on(event: "connect" | "disconnect", listener: () => void): this
	on(event: "error", listener: (err: any) => void): this
	on(event: string, listener: (...args: any[]) => void): this
	once(event: "connect" | "disconnect", listener: () => void): this
	once(event: "error", listener: (err: any) => void): this
	once(event: string, listener: (...args: any[]) => void): this
	off(event: string, listener: (...args: any[]) => void): this
	emit(event: string, ...args: any[]): boolean
	listenerCount(event: string): number
	removeListener(event: string, listener: (...args: any[]) => void): this
	removeAllListeners(event?: string): this
	setMaxListeners(n: number): this
}

/**
 * `EventEmitter` presented as the minimal constructor described by
 * {@link RsmqEventEmitter}, so that declaration emit does not leak `node:events`.
 */
export const RsmqEventEmitterBase = EventEmitter as unknown as {
	new (): RsmqEventEmitter
}
