/*
 ____    ____    __  __    ___
|  _ \  / ___|  |  \/  |  / _ \
| |_) | \___ \  | |\/| | | | | |
|  _ <   ___) | | |  | | | |_| |
|_| \_\ |____/  |_|  |_|  \__\_\

A Really Simple Message Queue based on Redis

*/
import * as _ from "lodash"
import * as RedisInst from "redis"
const EventEmitter = require("events").EventEmitter

/*
To create a new instance use:

	RedisSMQ = require("rsmq")
	rsmq = new RedisSMQ()

	Paramenters for RedisSMQ:

	* `host` (String): *optional (Default: "127.0.0.1")* The Redis server
	* `port` (Number): *optional (Default: 6379)* The Redis port
	* `options` (Object): *optional (Default: {})* The Redis options object.
	* `client` (RedisClient): *optional* A existing redis client instance. `host` and `server` will be ignored.
	* `ns` (String): *optional (Default: "rsmq")* The namespace prefix used for all keys created by **rsmq**
	* `realtime` (Boolean): *optional (Default: false)* Enable realtime PUBLISH of new messages
*/
class RedisSMQ extends EventEmitter {
	constructor (options: any = {}) {
		super(options);
		if (Promise) {
			// create async versions of methods
			_.forEach([
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
			], this.asyncify);
		}
		const opts = _.extend({
			host: "127.0.0.1",
			port: 6379,
			options: {
				password: options.password || null
			},
			client: null,
			ns: "rsmq",
			realtime: false
		}, options);
		opts.options.host = opts.host;
		opts.options.port = opts.port;
		this.realtime = opts.realtime;
		this.redisns = opts.ns + ":";

		if (opts.client && options.client.constructor.name === "RedisClient") {
			this.redis = opts.client
		}
		else {
			this.redis = RedisInst.createClient(opts.options)
		}

		this.connected = this.redis.connected || false;

		// If external client is used it might alrdy be connected. So we check here:
		if (this.connected) {
			this.emit("connect");
			this.initScript();
		}
		// Once the connection is up
		this.redis.on("connect", () => {
			this.connected = true;
			this.emit("connect");
			this.initScript();
		});

		this.redis.on("error", (err) => {
			if (err.message.indexOf( "ECONNREFUSED" )) {
				this.connected = false;
				this.emit("disconnect");
			}
			else {
				console.error( "Redis ERROR", err )
				this.emit( "error" )
			}
		});
		this._initErrors();
	}

	// helper to create async versions of our public methods (ie. methods that return promises)
	// example: getQueue -> getQueueAsync
	private asyncify = (methodKey) => {
		const asyncMethodKey = methodKey + "Async";
		this[asyncMethodKey] = (...args) => {
			return new Promise((resolve, reject) => {
				this[methodKey](...args, (err, result) => {
					if (err) {
						reject(err);
						return;
					}
					resolve(result);
				});
			});
		}
	}

	// kill the connection of the redis client, so your node script will be able to exit.
	public quit = (cb) => {
		if (cb === undefined) {
			cb = () => {}
		}
		this.redis.quit(cb);
	}

	private _getQueue = (qname, uid, cb) => {
		const mc = [
			["hmget", `${this.redisns}${qname}:Q`, "vt", "delay", "maxsize"],
			["time"]
		];
		this.redis.multi(mc).exec( (err, resp) => {
			if (err) { this._handleError(cb, err); return; }
			if (resp[0][0] === null || resp[0][1] === null || resp[0][2] === null) {
				this._handleError(cb, "queueNotFound");
				return;
			}
			// Make sure to always have correct 6digit millionth seconds from redis
			const ms: any = this._formatZeroPad(Number(resp[1][1]), 6);
			//  Create the epoch time in ms from the redis timestamp
			const ts = Number(resp[1][0] + ms.toString(10).slice(0, 3));

			const q: any = {
				vt: parseInt(resp[0][0], 10),
				delay: parseInt(resp[0][1], 10),
				maxsize: parseInt(resp[0][2], 10),
				ts: ts
			};

			// Need to create a uniqueid based on the redis timestamp,
			// the queue name and a random number.
			// The first part is the redis time.toString(36) which
			// lets redis order the messages correctly even when they are
			// in the same millisecond.
			if (uid) {
				uid = this._makeid(22);
				q.uid = Number(resp[1][0] + ms).toString(36) + uid;
			}
			cb(null, q);
		});
	}

	// This must be done via LUA script
	// We can only set a visibility of a message if it really exists.
	public changeMessageVisibility = (options, cb) => {
		if (this._validate(options, ["qname","id","vt"], cb) === false)
			return;

		this._getQueue(options.qname, false, (err, q) => {
			if (err) {
				this._handleError(cb, err);
				return;
			}
			// Make really sure that the LUA script is loaded
			if (this.changeMessageVisibility_sha1) {
				this._changeMessageVisibility(options, q, cb)
				return
			}
			this.on("scriptload:changeMessageVisibility", () => {
				this._changeMessageVisibility(options, q, cb);
			});
		});
	}

	private _changeMessageVisibility = (options, q, cb) => {
		this.redis.evalsha(this.changeMessageVisibility_sha1, 3, `${this.redisns}${options.qname}`, options.id, q.ts + options.vt * 1000, (err, resp) => {
			if (err) {
				this._handleError(cb, err);
				return;
			}
			cb(null, resp);
		});
	}

	public createQueue = (options, cb) => {
		const key = `${this.redisns}${options.qname}:Q`;
		options.vt = options.vt != null ? options.vt : 30;
		options.delay = options.delay != null ? options.delay : 0;
		options.maxsize = options.maxsize != null ? options.maxsize : 65536;
		if (this._validate(options, ["qname", "vt", "delay", "maxsize"], cb) === false)
			return;

		this.redis.time( (err, resp) => {
			if (err) {
				this._handleError(cb, err);
				return
			}

			const mc = [
				["hsetnx", key, "vt", options.vt],
				["hsetnx", key, "delay", options.delay],
				["hsetnx", key, "maxsize", options.maxsize],
				["hsetnx", key, "created", resp[0]],
				["hsetnx", key, "modified", resp[0]],
			];

			this.redis.multi(mc).exec( (err, resp) => {
				if (err) {
					this._handleError(cb, err);
					return
				}
				if (resp[0] === 0) {
					this._handleError(cb, "queueExists");
					return;
				}
				// We created a new queue
				// Also store it in the global set to keep an index of all queues
				this.redis.sadd(`${this.redisns}QUEUES`, options.qname, (err, resp) => {
					if (err) {
						this._handleError(cb, err);
						return;
					}
					cb(null, 1);
				});
			});
		});
	}

	public deleteMessage = (options, cb) => {
		if (this._validate(options, ["qname","id"],cb) === false)
			return;
		const key = `${this.redisns}${options.qname}`;
		const mc = [
			["zrem", key, options.id],
			["hdel", `${key}:Q`, `${options.id}`, `${options.id}:rc`, `${options.id}:fr`]
		];

		this.redis.multi(mc).exec( (err, resp) => {
			if (err) { this._handleError(cb, err); return; }
			if (resp[0] === 1 && resp[1] > 0) {
				cb(null, 1)
			}
			else {
				cb(null, 0)
			}
		});
	}

	public deleteQueue = (options, cb) => {
		if (this._validate(options, ["qname"],cb) === false)
			return;

		const key = `${this.redisns}${options.qname}`;
		const mc = [
			["del", `${key}:Q`, key], // The queue hash and messages zset
			["srem", `${this.redisns}QUEUES`, options.qname]
		];

		this.redis.multi(mc).exec( (err,resp) => {
			if (err) { this._handleError(cb, err); return; }
			if (resp[0] === 0) {
				this._handleError(cb, "queueNotFound");
				return;
			}
			cb(null, 1);
		});
	}

	public getQueueAttributes = (options, cb) => {
		if (this._validate(options, ["qname"],cb) === false)
			return;

		const key = `${this.redisns}${options.qname}`;
		this.redis.time( (err, resp) => {
			if (err) { this._handleError(cb, err); return; }

			// Get basic attributes and counter
			// Get total number of messages
			// Get total number of messages in flight (not visible yet)
			const mc = [
				["hmget", `${key}:Q`, "vt", "delay", "maxsize", "totalrecv", "totalsent", "created", "modified"],
				["zcard", key],
				["zcount", key, resp[0] + "000", "+inf"]
			];
			this.redis.multi(mc).exec( (err, resp) => {
				if (err) {
					this._handleError(cb, err);
					return;
				}

				if (resp[0][0] === null) {
					this._handleError(cb, "queueNotFound")
					return
				}
				const o = {
					vt: parseInt(resp[0][0], 10),
					delay: parseInt(resp[0][1], 10),
					maxsize: parseInt(resp[0][2], 10),
					totalrecv: parseInt(resp[0][3], 10) || 0,
					totalsent: parseInt(resp[0][4], 10) || 0,
					created: parseInt(resp[0][5], 10),
					modified: parseInt(resp[0][6], 10),
					msgs: resp[1],
					hiddenmsgs: resp[2]
				};
				cb(null, o);
			});
		});
	}

	private _handleReceivedMessage = (cb) => {
		return (err, resp) => {
			if (err) { this._handleError(cb, err); return; }
			if (!resp.length) {
				cb(null, {});
				return;
			}
			const o = {
				id: resp[0],
				message: resp[1],
				rc: resp[2],
				fr: Number(resp[3]),
				sent: Number(parseInt(resp[0].slice(0, 10), 36) / 1000)
			}
			cb(null, o);
		}
	}

	private initScript = () => {
		// The popMessage LUA Script
		//
		// Parameters:
		//
		// KEYS[1]: the zset key
		// KEYS[2]: the current time in ms
		//
		// * Find a message id
		// * Get the message
		// * Increase the rc (receive count)
		// * Use hset to set the fr (first receive) time
		// * Return the message and the counters
		//
		// Returns:
		//
		// {id, message, rc, fr}

		const script_popMessage = `local msg = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", KEYS[2], "LIMIT", "0", "1")
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

		// The receiveMessage LUA Script
		//
		// Parameters:
		//
		// KEYS[1]: the zset key
		// KEYS[2]: the current time in ms
		// KEYS[3]: the new calculated time when the vt runs out
		//
		// * Find a message id
		// * Get the message
		// * Increase the rc (receive count)
		// * Use hset to set the fr (first receive) time
		// * Return the message and the counters
		//
		// Returns:
		//
		// {id, message, rc, fr}

		const script_receiveMessage = `local msg = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", KEYS[2], "LIMIT", "0", "1")
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
			return o`;

		// The changeMessageVisibility LUA Script
		//
		// Parameters:
		//
		// KEYS[1]: the zset key
		// KEYS[2]: the message id
		//
		//
		// * Find the message id
		// * Set the new timer
		//
		// Returns:
		//
		// 0 or 1

		const script_changeMessageVisibility = `local msg = redis.call("ZSCORE", KEYS[1], KEYS[2])
			if not msg then
				return 0
			end
			redis.call("ZADD", KEYS[1], KEYS[3], KEYS[2])
			return 1`

		this.redis.script("load", script_popMessage, (err, resp) => {
			if (err) { console.log(err); return; }
			this.popMessage_sha1 = resp;
			this.emit("scriptload:popMessage");
		});

		this.redis.script("load", script_receiveMessage, (err, resp) => {
			if (err) { console.log(err); return; }
			this.receiveMessage_sha1 = resp;
			this.emit("scriptload:receiveMessage");
		});

		this.redis.script("load", script_changeMessageVisibility, (err, resp) => {
			if (err) { console.log(err); return; }
			this.changeMessageVisibility_sha1 = resp;
			this.emit('scriptload:changeMessageVisibility');
		});
	}

	public listQueues = (cb) => {
		this.redis.smembers(`${this.redisns}QUEUES`, (err, resp) => {
			if (err) { this._handleError(cb, err); return; }
			cb(null, resp)
		});
	}

	public popMessage = (options, cb) => {
		if (this._validate(options, ["qname"],cb) === false)
			return;

		this._getQueue(options.qname, false, (err, q) => {
			if (err) { this._handleError(cb, err); return; }
			// Make really sure that the LUA script is loaded
			if (this.popMessage_sha1) {
				this._popMessage(options, q, cb);
				return;
			}
			this.on("scriptload:popMessage", () => {
				this._popMessage(options, q, cb);
			});
		});
	}

	public receiveMessage = (options, cb) => {
		if (this._validate(options, ["qname"], cb) === false)
			return;

		this._getQueue(options.qname, false, (err, q) => {
			if (err) { this._handleError(cb, err); return; }
			// Now that we got the default queue settings
			options.vt = options.vt != null ? options.vt : q.vt;

			if (this._validate(options, ["vt"], cb) === false)
				return;

			// Make really sure that the LUA script is loaded
			if (this.receiveMessage_sha1) {
				this._receiveMessage(options, q, cb)
				return;
			}
			this.on("scriptload:receiveMessage", () => {
				this._receiveMessage(options, q, cb)
			});
		});
	}

	private _popMessage = (options, q, cb) => {
		this.redis.evalsha(this.popMessage_sha1, 2, `${this.redisns}${options.qname}`, q.ts, this._handleReceivedMessage(cb));
	}

	private _receiveMessage = (options, q, cb) => {
		this.redis.evalsha(this.receiveMessage_sha1, 3, `${this.redisns}${options.qname}`, q.ts, q.ts + options.vt * 1000, this._handleReceivedMessage(cb));
	}

	public sendMessage = (options, cb) => {
		if (this._validate(options, ["qname"],cb) === false)
			return

		this._getQueue(options.qname, true, (err, q) => {
			if (err) { this._handleError(cb, err); return; }
			// Now that we got the default queue settings
			options.delay = options.delay != null ? options.delay : q.delay;

			if (this._validate(options, ["delay"],cb) === false)
				return;

			// Check the message
			if (typeof options.message !== "string") {
				this._handleError(cb, "messageNotString");
				return;
			}
			// Check the message size
			if (q.maxsize !== -1 && options.message.length > q.maxsize) {
				this._handleError(cb, "messageTooLong");
				return;
			}
			// Ready to store the message
			const key = `${this.redisns}${options.qname}`;
			const mc = [
				["zadd", key, q.ts + options.delay * 1000, q.uid],
				["hset", `${key}:Q`, q.uid, options.message],
				["hincrby", `${key}:Q`, "totalsent", 1]
			];

			if (this.realtime) {
				mc.push(["zcard", key]);
			}
			this.redis.multi(mc).exec( (err, resp) => {
				if (err) {
					this._handleError(cb, err);
					return;
				}
				if (this.realtime) {
					this.redis.publish(`${this.redisns}rt:${options.qname}`, resp[3]);
				}
				cb(null, q.uid);
			});
		});
	}

	public setQueueAttributes = (options, cb) => {
		const props = ["vt", "maxsize", "delay"]
		let k = []
		for (let item of props) {
			if (options[item] != null) {
				k.push(item);
			}
		}

		// Not a single key was supplied
		if (k.length === 0) {
			this._handleError(cb, "noAttributeSupplied");
			return;
		}

		if (this._validate(options, ["qname"].concat(k), cb) === false)
			return

		const key = `${this.redisns}${options.qname}`;
		this._getQueue(options.qname, false, (err, q) => {
			if (err) { this._handleError(cb, err); return; }
			this.redis.time( (err, resp) => {
				if (err) {
					this._handleError(cb, err);
					return;
				}
				const mc = [
					["hset", `${this.redisns}${options.qname}:Q`, "modified", resp[0]]
				];
				for (let item of k) {
					mc.push(["hset", `${this.redisns}${options.qname}:Q`, item, options[item]])
				};
				this.redis.multi(mc).exec( (err) => {
					if (err) {
						this._handleError(cb, err);
						return;
					}
					this.getQueueAttributes(options, cb);
				})
			});
		});
	}

	// Helpers
	private _formatZeroPad (num, count) {
		return ((Math.pow(10, count) + num) + "").substr(1);
	}

	private _handleError = (cb, err, data = {}) => {
		// try to create a error Object with humanized message
		let _err = null;
		if (_.isString(err)) {
			_err = new Error();
			_err.name = err;

			// _err.message = this._ERRORS?[err]?(data) || "unkown";
			let ref = null;
			_err.message = ((ref = this._ERRORS) != null ? typeof ref[err] === "function" ? ref[err](data) : void 0 : void 0) || "unkown";
		}
		else {
			_err = err
		}
		cb(_err)
	}

	private _initErrors = () => {
		this._ERRORS = {};
		for (let key in this.ERRORS) {
			this._ERRORS[key] = _.template(this.ERRORS[key]);
		}
	}

	private _makeid (len) {
		let text = "";
		const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
		let i = 0;
		for (i = 0; i < len; i++) {
			text += possible.charAt(Math.floor(Math.random() * possible.length));
		}
		return text;
	}

	private _VALID = {
		qname: /^([a-zA-Z0-9_-]){1,160}$/,
		id: /^([a-zA-Z0-9:]){32}$/
	}

	private _validate = (o, items, cb) => {
		for (let item of items) {
			switch (item) {
				case "qname":
				case "id":
					if (!o[item]) {
						this._handleError(cb, "missingParameter", {item:item});
						return false;
					}
					o[item] = o[item].toString()
					if (!this._VALID[item].test(o[item])) {
						this._handleError(cb, "invalidFormat", {item:item});
						return false;
					}
					break;
				case "vt":
				case "delay":
					o[item] = parseInt(o[item],10);
					if (_.isNaN(o[item]) || !_.isNumber(o[item]) || o[item] < 0 || o[item] > 9999999) {
						this._handleError(cb, "invalidValue", {item: item, min: 0, max: 9999999});
						return false;
					}
					break;
				case "maxsize":
					o[item] = parseInt(o[item], 10)
					if (_.isNaN(o[item]) || !_.isNumber(o[item]) || o[item] < 1024 || o[item] > 65536) {
						// Allow unlimited messages
						if (o[item] !== -1) {
							this._handleError(cb, "invalidValue", {item: item, min: 1024, max: 65536});
							return false;
						}
					}
					break;
			}
		};
		return o;
	}

	private ERRORS = {
		"noAttributeSupplied": "No attribute was supplied",
		"missingParameter": "No <%= item %> supplied",
		"invalidFormat": "Invalid <%= item %> format",
		"invalidValue": "<%= item %> must be between <%= min %> and <%= max %>",
		"messageNotString": "Message must be a string",
		"messageTooLong": "Message too long",
		"queueNotFound": "Queue not found",
		"queueExists": "Queue exists"
	}
}
module.exports = RedisSMQ;