import { rsmqError } from "./errors"

/**
 * Validation of the user supplied options.
 *
 * Same rules, same error messages as `0.x`. Unlike `0.x` these helpers do not
 * write back into the options object the caller handed in - they return the
 * normalized value instead.
 */
const VALID = {
	qname: /^([a-zA-Z0-9_-]){1,160}$/,
	id: /^([a-zA-Z0-9:]){32}$/
} as const

/** A queue name: 1-160 characters, `a-z`, `A-Z`, `0-9`, `_` and `-`. */
export function validQname(value: unknown): string {
	return validPattern("qname", value)
}

/** A message id as returned by `sendMessage`: 32 characters. */
export function validId(value: unknown): string {
	return validPattern("id", value)
}

function validPattern(item: "qname" | "id", value: unknown): string {
	if (!value) {
		throw rsmqError("missingParameter", { item })
	}
	const str = String(value)
	if (!VALID[item].test(str)) {
		throw rsmqError("invalidFormat", { item })
	}
	return str
}

/** A `vt` or `delay` in seconds: 0 - 9999999 (around 115 days). */
export function validSeconds(item: "vt" | "delay", value: unknown): number {
	const num = parseInt(value as string, 10)
	if (Number.isNaN(num) || num < 0 || num > 9999999) {
		throw rsmqError("invalidValue", { item, min: 0, max: 9999999 })
	}
	return num
}

/** A `maxsize` in bytes: 1024 - 65536, or `-1` for unlimited. */
export function validMaxsize(value: unknown): number {
	const num = parseInt(value as string, 10)
	if (num === -1) {
		return num
	}
	if (Number.isNaN(num) || num < 1024 || num > 65536) {
		throw rsmqError("invalidValue", { item: "maxsize", min: 1024, max: 65536 })
	}
	return num
}
