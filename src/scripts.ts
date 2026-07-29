/**
 * The LUA scripts used by `rsmq`.
 *
 * These define the queue semantics and are unchanged since `0.x` - a message id
 * received, popped or made visible again by this version behaves exactly like it
 * did before. Do not "optimize" them without a very good reason.
 */

/**
 * Pop the next available message and delete it.
 *
 * Parameters:
 * * `KEYS[1]`: the zset key
 * * `KEYS[2]`: the current time in ms
 *
 * Returns `{id, message, rc, fr}` or `{}`.
 */
export const POP_MESSAGE = `local msg = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", KEYS[2], "LIMIT", "0", "1")
	if #msg == 0 then
		return {}
	end
	redis.call("HINCRBY", KEYS[1] .. ":Q", "totalrecv", 1)
	local mbody = redis.call("HGET", KEYS[1] .. ":Q", msg[1])
	local rc = redis.call("HINCRBY", KEYS[1] .. ":Q", msg[1] .. ":rc", 1)
	local o = {msg[1], mbody, rc}
	if rc==1 then
		table.insert(o, KEYS[2])
	else
		local fr = redis.call("HGET", KEYS[1] .. ":Q", msg[1] .. ":fr")
		table.insert(o, fr)
	end
	redis.call("ZREM", KEYS[1], msg[1])
	redis.call("HDEL", KEYS[1] .. ":Q", msg[1], msg[1] .. ":rc", msg[1] .. ":fr")
	return o`

/**
 * Receive the next available message and hide it for `vt` seconds.
 *
 * Parameters:
 * * `KEYS[1]`: the zset key
 * * `KEYS[2]`: the current time in ms
 * * `KEYS[3]`: the new calculated time when the vt runs out
 *
 * Returns `{id, message, rc, fr}` or `{}`.
 */
export const RECEIVE_MESSAGE = `local msg = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", KEYS[2], "LIMIT", "0", "1")
	if #msg == 0 then
		return {}
	end
	redis.call("ZADD", KEYS[1], KEYS[3], msg[1])
	redis.call("HINCRBY", KEYS[1] .. ":Q", "totalrecv", 1)
	local mbody = redis.call("HGET", KEYS[1] .. ":Q", msg[1])
	local rc = redis.call("HINCRBY", KEYS[1] .. ":Q", msg[1] .. ":rc", 1)
	local o = {msg[1], mbody, rc}
	if rc==1 then
		redis.call("HSET", KEYS[1] .. ":Q", msg[1] .. ":fr", KEYS[2])
		table.insert(o, KEYS[2])
	else
		local fr = redis.call("HGET", KEYS[1] .. ":Q", msg[1] .. ":fr")
		table.insert(o, fr)
	end
	return o`

/**
 * Set a new visibility timeout on an existing message.
 *
 * Parameters:
 * * `KEYS[1]`: the zset key
 * * `KEYS[2]`: the message id
 * * `KEYS[3]`: the new calculated time when the vt runs out
 *
 * Returns `0` or `1`.
 */
export const CHANGE_MESSAGE_VISIBILITY = `local msg = redis.call("ZSCORE", KEYS[1], KEYS[2])
	if not msg then
		return 0
	end
	redis.call("ZADD", KEYS[1], KEYS[3], KEYS[2])
	return 1`

export const SCRIPTS = {
	popMessage: POP_MESSAGE,
	receiveMessage: RECEIVE_MESSAGE,
	changeMessageVisibility: CHANGE_MESSAGE_VISIBILITY
} as const

export type ScriptName = keyof typeof SCRIPTS
