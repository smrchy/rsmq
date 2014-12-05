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
_ = require "lodash"
RedisInst = require "redis"

EventEmitter = require( "events" ).EventEmitter

# To create a new instance use:
#
# 	RedisSMQ = require("redis-simple-message-queue")
#	rsmq = new RedisSMQ()
#
#	Paramenters for RedisSMQ:
#
#	* `host` (String): *optional (Default: "127.0.0.1")* The Redis server
#	* `port` (Number): *optional (Default: 6379)* The Redis port
#	* `options` (Object): *optional (Default: {})* The Redis options object.
#   * `client` (RedisClient): *optional* A existing redis client instance. `host` and `server` will be ignored.
#	* `ns` (String): *optional (Default: "rsmq")* The namespace prefix used for all keys created by **rsmq**
##
class RedisSMQ extends EventEmitter

	constructor: (options = {}) ->
		
		opts = _.extend
			host: "127.0.0.1"
			port: 6379
			options: {}
			client: null
			ns: "rsmq"
		, options

		@redisns = opts.ns + ":"
		if opts.client?.constructor?.name is "RedisClient"
			@redis = opts.client
		else
			@redis = RedisInst.createClient(opts.port, opts.host, opts.options)

		@connected = @redis.connected or false
		@redis.on "connect", =>
			@connected = true
			@emit( "connect" )
			@initScript()
			return


		@redis.on "error", ( err )=>
			if err.message.indexOf( "ECONNREFUSED" )
				@connected = false
				@emit( "disconnect" )
			else
				console.error( "Redis ERROR", err )
				@emit( "error" )
			return

		@_initErrors()
		return

	_getQueue: (qname, uid, cb) =>
		mc = [
			["hmget", "#{@redisns}#{qname}:Q", "vt", "delay", "maxsize"]
			["time"]
		]
		@redis.multi(mc).exec (err, resp) =>
			if err
				@_handleError(cb, err)
				return
			if resp[0][0] is null or resp[0][1] is null or resp[0][2] is null
				@_handleError(cb, "queueNotFound")
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
				uid = @_makeid(22)
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
				@_handleError(cb, err)
				return
			# Make really sure that the LUA script is loaded
			if @changeMessageVisibility_sha1
				@_changeMessageVisibility(options, q, cb)
				return
			changeMessageVisibility.on 'scriptload:changeMessageVisibility', =>
				@_changeMessageVisibility(options, q, cb)
				return
			return
			
		return


	_changeMessageVisibility: (options, q, cb) =>
		@redis.evalsha @changeMessageVisibility_sha1, 3, "#{@redisns}#{options.qname}", options.id, q.ts + options.vt * 1000, (err, resp) =>
			if err
				@_handleError(cb, err)
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

		@redis.time (err, resp) =>
			if err
				@_handleError(cb, err)
				return

			mc = [
				["hsetnx", "#{@redisns}#{options.qname}:Q", "vt", options.vt]
				["hsetnx", "#{@redisns}#{options.qname}:Q", "delay", options.delay]
				["hsetnx", "#{@redisns}#{options.qname}:Q", "maxsize", options.maxsize]
				["hsetnx", "#{@redisns}#{options.qname}:Q", "created", resp[0]]
				["hsetnx", "#{@redisns}#{options.qname}:Q", "modified", resp[0]]
			]

			@redis.multi(mc).exec (err, resp) =>
				if err
					@_handleError(cb, err)
					return
				if resp[0] is 0
					@_handleError(cb, "queueExists")
					return
				# We created a new queue
				# Also store it in the global set to keep an index of all queues
				@redis.sadd "#{@redisns}QUEUES", options.qname, (err, resp) =>
					if err
						@_handleError(cb, err)
						return
					cb(null, 1)
					return
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

		@redis.multi(mc).exec (err, resp) =>
			if err
				@_handleError(cb, err)
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

		@redis.multi(mc).exec (err,resp) =>
			if err
				@_handleError(cb, err)
				return
			if resp[0] is 0
				@_handleError(cb, "queueNotFound")
				return

			cb(null, 1)
			return
		return

	getQueueAttributes: (options, cb) =>
		if @_validate(options, ["qname"],cb) is false
			return
		key = "#{@redisns}#{options.qname}"
		@redis.time (err, resp) =>
			if err
				@_handleError(cb, err)
				return

			# Get basic attributes and counter
			# Get total number of messages
			# Get total number of messages in flight (not visible yet)
			mc = [
				["hmget", "#{key}:Q", "vt", "delay", "maxsize", "totalrecv", "totalsent", "created", "modified"]
				["zcard", key]
				["zcount", key, "-inf", resp[0] + "000"]
			]
			@redis.multi(mc).exec (err, resp) =>
				if err
					@_handleError(cb, err)
					return

				if resp[0][0] is null
					@_handleError(cb, "queueNotFound")
					return

				o =
					vt: parseInt(resp[0][0], 10)
					delay: parseInt(resp[0][1], 10)
					maxsize: parseInt(resp[0][2], 10)
					totalrecv: parseInt(resp[0][3], 10) or 0
					totalsent: parseInt(resp[0][4], 10) or 0
					created: parseInt(resp[0][5], 10)
					modified: parseInt(resp[0][6], 10)
					msgs: resp[1]
					hiddenmsgs: resp[2]
					
				cb(null, o)
				return
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
			@emit('scriptload:receiveMessage');
			return
		@redis.script "load", script_changeMessageVisibility, (err, resp) =>
			@changeMessageVisibility_sha1 = resp
			@emit('scriptload:changeMessageVisibility');
			return
		return


	listQueues: (cb) =>
		@redis.smembers "#{@redisns}QUEUES", (err, resp) =>
			if err
				@_handleError(cb, err)
				return
			cb(null, resp)
			return
		return


	receiveMessage: (options, cb) =>
		if @_validate(options, ["qname"],cb) is false
			return

		@_getQueue options.qname, false, (err, q) =>
			if err
				@_handleError(cb, err)
				return

			# Now that we got the default queue settings
			options.vt = options.vt ? q.vt

			if @_validate(options, ["vt"],cb) is false
				return

			# Make really sure that the LUA script is loaded
			if @receiveMessage_sha1
				@_receiveMessage(options, q, cb)
				return
			@on 'scriptload:receiveMessage', =>
				@_receiveMessage(options, q, cb)
				return
			return
		return


	_receiveMessage: (options, q, cb) =>
		@redis.evalsha @receiveMessage_sha1, 3, "#{@redisns}#{options.qname}", q.ts, q.ts + options.vt * 1000, (err, resp) =>
			if err
				@_handleError(cb, err)
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

	sendMessage: (options, cb) =>
		if @_validate(options, ["qname"],cb) is false
			return

		@_getQueue options.qname, true, (err, q) =>
			if err
				@_handleError(cb, err)
				return
			# Now that we got the default queue settings
			options.delay = options.delay ? q.delay
			
			if @_validate(options, ["delay"],cb) is false
				return

			# Check the message
			if typeof options.message isnt "string"
				@_handleError(cb, "messageNotString")
				return
			if options.message.length > q.maxsize
				@_handleError(cb, "messageTooLong")
				return

			# Ready to store the message
			mc = [
				["zadd", "#{@redisns}#{options.qname}", q.ts + options.delay * 1000, q.uid]
				["hset", "#{@redisns}#{options.qname}:Q", q.uid, options.message]
				["hincrby", "#{@redisns}#{options.qname}:Q", "totalsent", 1]
			]

			@redis.multi(mc).exec (err, resp) =>
				if err
					@_handleError(cb, err)
					return
				cb(null, q.uid)
				return
			return
		return

	setQueueAttributes: (options, cb) =>
		props = ["vt", "maxsize", "delay"]
		k = []
		for item in props
			if options[item]?
				k.push(item)
		# Not a single key was supplied
		if not k.length
			@_handleError(cb, "noAttributeSupplied")
			return
		if @_validate(options, ["qname"].concat(k), cb) is false
			return
		key = "#{@redisns}#{options.qname}"
		@_getQueue options.qname, false, (err, q) =>
			if err
				@_handleError(cb, err)
				return
			@redis.time (err, resp) =>
				if err
					@_handleError(cb, err)
					return
				mc = [
					["hsetnx", "#{@redisns}#{options.qname}:Q", "modified", resp[0]]
				]
				for item in k
					mc.push(["hset", "#{@redisns}#{options.qname}:Q", item, options[item]])
				@redis.multi(mc).exec (err, resp) =>
					if err
						@_handleError(cb, err)
						return
					@getQueueAttributes options, cb
					return
				return
			return
		return


	# Helpers

	_formatZeroPad: (num, count) ->
		((Math.pow(10, count)+num)+"").substr(1)


	_handleError: (cb, err, data={}) =>
		# try to create a error Object with humanized message
		if _.isString(err)
			_err = new Error()
			_err.name = err
			_err.message = @_ERRORS?[err]?(data) or "unkown"
		else 
			_err = err
		cb(_err)
		return

	_initErrors: =>
		@_ERRORS = {}
		for key, msg of @ERRORS
			@_ERRORS[key] = _.template(msg)
		return

	_makeid: (len) ->
		text = ""
		possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		for i in [0...len]
			text += possible.charAt(Math.floor(Math.random() * possible.length))
		return text
	
	_VALID:
		qname:	/^([a-zA-Z0-9_-]){1,80}$/
		id:		/^([a-zA-Z0-9:]){32}$/

                    
	_validate: (o, items, cb) ->
		for item in items
			switch item
				when "qname", "id"
					if not o[item]
						@_handleError(cb, "missingParameter", {item:item})
						return false
					o[item] = o[item].toString()
					if not @_VALID[item].test(o[item])
						@_handleError(cb, "invalidFormat", {item:item})
						return false
				when "vt", "delay"
					o[item] = parseInt(o[item],10)
					if _.isNaN(o[item]) or not _.isNumber(o[item]) or o[item] < 0 or o[item] > 9999999
						@_handleError(cb, "invalidValue", {item:item,min:0,max:9999999})
						return false
				when "maxsize"
					o[item] = parseInt(o[item],10)
					if _.isNaN(o[item]) or not _.isNumber(o[item]) or o[item] < 1024 or o[item] > 65536
						@_handleError(cb, "invalidValue", {item:item,min:1024,max:65536})
						return false
		return o



	ERRORS:
		"noAttributeSupplied": "No attribute was supplied"
		"missingParameter": "No <%= item %> supplied"
		"invalidFormat": "Invalid <%= item %> format"
		"invalidValue": "<%= item %> must be between <%= min %> and <%= max %>"
		"messageNotString": "Message must be a string"
		"messageTooLong": "Message too long"
		"queueNotFound": "Queue not found"
		"queueExists": "Queue exists"




module.exports = RedisSMQ
