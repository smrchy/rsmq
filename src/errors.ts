/**
 * The error names and messages of `rsmq` are part of the public API - a lot of
 * code out there matches on `err.message`. Do not reword them.
 */
const ERRORS = {
	noAttributeSupplied: () => "No attribute was supplied",
	missingParameter: (d: ErrorData) => `No ${d.item} supplied`,
	invalidFormat: (d: ErrorData) => `Invalid ${d.item} format`,
	invalidValue: (d: ErrorData) => `${d.item} must be between ${d.min} and ${d.max}`,
	messageNotString: () => "Message must be a string",
	messageTooLong: () => "Message too long",
	queueNotFound: () => "Queue not found",
	queueExists: () => "Queue exists",
	invalidClient: () => "The supplied client is not a node-redis client"
} as const

export type ErrorName = keyof typeof ERRORS

export interface ErrorData {
	item?: string
	min?: number
	max?: number
}

/**
 * An error raised by `rsmq` itself (as opposed to one coming from Redis).
 * `name` is the internal error key, `message` the humanized text.
 */
export class RsmqError extends Error {
	constructor(name: ErrorName, data: ErrorData = {}) {
		super(ERRORS[name] ? ERRORS[name](data) : "unkown")
		this.name = name
	}
}

export function rsmqError(name: ErrorName, data: ErrorData = {}): RsmqError {
	return new RsmqError(name, data)
}
