###
rsmq

A Really Simple Message Queue based on Redis

The MIT License (MIT)

Copyright © 2013 Patrick Liess, http://www.tcs.de

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
###

crypto = require "crypto"
_ = require "underscore"
RedisInst = require "redis"

# To create a new instance use:
#
# 	RedisSMQ = require("redis-simple-message-queue")
#	rsmq = new RedisSMQ()
#
#	Paramenters for RedisSMQ:
#
#	`redisport`, `redishost`, `redisns`
#
# Defaults are: `6379`, `"127.0.0.1"`, `"rsmq"`
#
class RedisSMQ

	constructor: (redisport=6379, redishost="127.0.0.1", @redisns="rsmq") ->
		@redisns = @redisns + ":"
		@redis = RedisInst.createClient(redisport, redishost)
		@initScript()


	_getQueue: (qname, uid, cb) =>
		mc = [
			["hmget", "#{@redisns}#{qname}:Q", "vt", "delay", "maxsize"]
			["time"]
		]
		@redis.multi(mc).exec (err, resp) =>
			if err
				cb(err)
				return
			if resp[0][0] is null or resp[0][1] is null or resp[0][2] is null
				cb("Queue not found")
				return
			# Make sure to always have correct 6digit millionth seconds from redis
			ms = @_formatZeroPad(Number(resp[1][1]), 6)
			# Create the epoch time in ms from the redis timestamp
			ts = Number(resp[1][0] + ms.toString(10)[0...3])

			q =
				vt: parseInt(resp[0][0], 10)
				delay: parseInt(resp[0][1], 10)
				maxsize: parseInt(resp[0][2], 10)
				ts: ts

			# Need to create a uniqueid based on the redis timestamp,
			# the queue name and a random number.
			# The first part is the redis time.toString(36) which
			# lets redis order the messages correctly even when they are
			# in the same millisecond.
			if uid
				uid = qname + Math.random()
				uid = crypto.createHash('md5').update(uid).digest("hex")
				q.uid = Number(resp[1][0] + ms).toString(36) + uid
			cb(null, q)
			return

		return

	# This must be done via LUA script
	# 
	# We can only set a visibility of a message if it really exists.
	#
	changeMessageVisibility: (options, cb) =>
		if @_validate(options, ["qname","id","vt"],cb) is false
			return

		@_getQueue options.qname, false, (err, q) =>
			if err
				cb(err)
				return

			@redis.evalsha @changeMessageVisibility_sha1, 3, "#{@redisns}#{options.qname}", options.id, q.ts + options.vt * 1000, (err, resp) ->
				if err
					cb(err)
					return
				cb(null, resp)
				return
		return


	createQueue: (options, cb) =>
		options.vt 		= options.vt ? 30
		options.delay	= options.delay ? 0
		options.maxsize	= options.maxsize ? 65536

		if @_validate(options, ["qname","vt","delay","maxsize"],cb) is false
			return

		mc = [
			["hsetnx", "#{@redisns}#{options.qname}:Q", "vt", options.vt]
			["hsetnx", "#{@redisns}#{options.qname}:Q", "delay", options.delay]
			["hsetnx", "#{@redisns}#{options.qname}:Q", "maxsize", options.maxsize]
		]

		@redis.multi(mc).exec (err, resp) =>
			if err
				cb(err)
				return
			if resp[0] is 0
				cb("Queue exists")
				return
			# We created a new queue
			# Also store it in the global set to keep an index of all queues
			@redis.sadd "#{@redisns}QUEUES", options.qname, (err, resp) ->
				if err
					cb(err)
					return
				cb(null, 1)
				return
			return
		return


	deleteMessage: (options, cb) =>
		if @_validate(options, ["qname","id"],cb) is false
			return
		key = "#{@redisns}#{options.qname}"
		mc = [
			["zrem", key, options.id]
			["hdel", "#{key}:Q", "#{options.id}", "#{options.id}:rc", "#{options.id}:fr" ]
		]

		@redis.multi(mc).exec (err, resp) ->
			if err
				cb(err)
				return
			if resp[0] is 1 and resp[1] > 0
				cb(null, 1)
			else
				cb(null, 0)
			return
		return

	deleteQueue: (options, cb) =>
		if @_validate(options, ["qname"],cb) is false
			return
		key = "#{@redisns}#{options.qname}"
		mc = [
			["del", "#{key}:Q"] # The queue hash
			["del", key] # The messages zset
			["srem", "#{@redisns}QUEUES", options.qname]
		]

		@redis.multi(mc).exec (err,resp) ->
			if err
				cb(err)
				return
			if resp[0] is 0
				cb("Queue not found")
				return

			cb(null, 1)
			return
		return

	initScript: (cb) ->
		# The receiveMessage LUA Script
		# 
		# Parameters:
		#
		# KEYS[1]: the zset key
		# KEYS[2]: the current time in ms
		# KEYS[3]: the new calculated time when the vt runs out
		#
		# * Find a message id
		# * Get the message
		# * Increase the rc (receive count)
		# * Use hset to set the fr (first receive) time
		# * Return the message and the counters
		#
		# Returns:
		# 
		# {id, message, rc, fr}

		script_receiveMessage = 'local msg = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", KEYS[2], "LIMIT", "0", "1")
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
			return o'	

		# The changeMessageVisibility LUA Script
		# 
		# Parameters:
		#
		# KEYS[1]: the zset key
		# KEYS[2]: the message id
		#
		#
		# * Find the message id
		# * Set the new timer
		#
		# Returns:
		# 
		# 0 or 1

		script_changeMessageVisibility = 'local msg = redis.call("ZSCORE", KEYS[1], KEYS[2])
			if not msg then
				return 0
			end
			redis.call("ZADD", KEYS[1], KEYS[3], KEYS[2])
			return 1'

		@redis.script "load", script_receiveMessage, (err, resp) =>
			@receiveMessage_sha1 = resp
			return
		@redis.script "load", script_changeMessageVisibility, (err, resp) =>
			@changeMessageVisibility_sha1 = resp
			return
		return

	receiveMessage: (options, cb) =>
		# Make sure the @receiveMessage_sha1 is there
		if not @receiveMessage_sha1
			cb(null, {})
			return

		if @_validate(options, ["qname"],cb) is false
			return

		@_getQueue options.qname, false, (err, q) =>
			if err
				cb(err)
				return

			# Now that we got the default queue settings
			options.vt = options.vt ? q.vt

			if @_validate(options, ["vt"],cb) is false
				return



			@redis.evalsha @receiveMessage_sha1, 3, "#{@redisns}#{options.qname}", q.ts, q.ts + options.vt * 1000, (err, resp) ->
				if err
					cb(err)
					return
				
				if not resp.length
					cb(null, {})
					return
				o =
					id:		 	resp[0]
					message:	resp[1]
					rc:			resp[2]
					fr:			Number(resp[3])
					sent:		parseInt(parseInt(resp[0][0...10],36)/1000)

				
				cb(null, o)
				return
			return
		return

	sendMessage: (options, cb) =>
		if @_validate(options, ["qname"],cb) is false
			return

		@_getQueue options.qname, true, (err, q) =>
			if err
				cb(err)
				return

			# Now that we got the default queue settings
			options.delay = options.delay ? q.delay
			
			if @_validate(options, ["delay"],cb) is false
				return

			# Check the message
			if typeof options.message isnt "string"
				cb("Message must be a string")
				return
			if options.message.length > q.maxsize
				cb("Message too long")
				return

			# Ready to store the message
			mc = [
				["zadd", "#{@redisns}#{options.qname}", q.ts + options.delay * 1000, q.uid]
				["hset", "#{@redisns}#{options.qname}:Q", q.uid, options.message]
				["hincrby", "#{@redisns}#{options.qname}:Q", "totalsent", 1]
			]

			@redis.multi(mc).exec (err, resp) ->
				if err
					cb(err)
					return
				cb(null, q.uid)
				return
			return
		return



	# Helpers

	_formatZeroPad: (num, count) ->
		((Math.pow(10, count)+num)+"").substr(1)

	_VALID:
		qname:	/^([a-zA-Z0-9_-]){1,80}$/
		id:		/^([a-zA-Z0-9:]){42}$/

                    
	_validate: (o, items, cb) ->
		for item in items
			switch item
				when "qname", "id"
					if not o[item]
						cb("No #{item} supplied")
						return false
					o[item] = o[item].toString()
					if not @_VALID[item].test(o[item])
						cb("Invalid #{item} format")
						return false
				when "vt", "delay"
					o[item] = parseInt(o[item],10)
					if _.isNaN(o[item]) or not _.isNumber(o[item]) or o[item] < 0 or o[item] > 9999999
						cb("#{item} must be between 0 and 9999999")
						return false
				when "maxsize"
					o[item] = parseInt(o[item],10)
					if _.isNaN(o[item]) or not _.isNumber(o[item]) or o[item] < 1024 or o[item] > 65536
						cb("#{item} must be between 1024 and 65536")
						return false
		return o



module.exports = RedisSMQ