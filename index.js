"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const RedisInst = require("redis");
const EventEmitter = require("events").EventEmitter;
const RSMQ_OPTIONS = ["client", "ns", "realtime", "options"];
class RedisSMQ extends EventEmitter {
    constructor(options = {}) {
        super(options);
        this.asyncify = (methodKey) => {
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
            };
        };
        this.quit = (cb) => {
            if (cb === undefined) {
                cb = () => { };
            }
            this.redis.quit(cb);
        };
        this._getQueue = (qname, uid, cb) => {
            const mc = [
                ["hmget", `${this.redisns}${qname}:Q`, "vt", "delay", "maxsize"],
                ["time"]
            ];
            this.redis.multi(mc).exec((err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                if (resp[0][0] === null || resp[0][1] === null || resp[0][2] === null) {
                    this._handleError(cb, "queueNotFound");
                    return;
                }
                const ms = this._formatZeroPad(Number(resp[1][1]), 6);
                const ts = Number(resp[1][0] + ms.toString(10).slice(0, 3));
                const q = {
                    vt: parseInt(resp[0][0], 10),
                    delay: parseInt(resp[0][1], 10),
                    maxsize: parseInt(resp[0][2], 10),
                    ts: ts
                };
                if (uid) {
                    uid = this._makeid(22);
                    q.uid = Number(resp[1][0] + ms).toString(36) + uid;
                }
                cb(null, q);
            });
        };
        this.changeMessageVisibility = (options, cb) => {
            if (this._validate(options, ["qname", "id", "vt"], cb) === false)
                return;
            this._getQueue(options.qname, false, (err, q) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                if (this.changeMessageVisibility_sha1) {
                    this._changeMessageVisibility(options, q, cb);
                    return;
                }
                this.on("scriptload:changeMessageVisibility", () => {
                    this._changeMessageVisibility(options, q, cb);
                });
            });
        };
        this._changeMessageVisibility = (options, q, cb) => {
            this.redis.evalsha(this.changeMessageVisibility_sha1, 3, `${this.redisns}${options.qname}`, options.id, q.ts + options.vt * 1000, (err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                cb(null, resp);
            });
        };
        this.createQueue = (options, cb) => {
            const key = `${this.redisns}${options.qname}:Q`;
            options.vt = options.vt != null ? options.vt : 30;
            options.delay = options.delay != null ? options.delay : 0;
            options.maxsize = options.maxsize != null ? options.maxsize : 65536;
            if (this._validate(options, ["qname", "vt", "delay", "maxsize"], cb) === false)
                return;
            this.redis.time((err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                const mc = [
                    ["hsetnx", key, "vt", options.vt],
                    ["hsetnx", key, "delay", options.delay],
                    ["hsetnx", key, "maxsize", options.maxsize],
                    ["hsetnx", key, "created", resp[0]],
                    ["hsetnx", key, "modified", resp[0]],
                ];
                this.redis.multi(mc).exec((err, resp) => {
                    if (err) {
                        this._handleError(cb, err);
                        return;
                    }
                    if (resp[0] === 0) {
                        this._handleError(cb, "queueExists");
                        return;
                    }
                    this.redis.sadd(`${this.redisns}QUEUES`, options.qname, (err, resp) => {
                        if (err) {
                            this._handleError(cb, err);
                            return;
                        }
                        cb(null, 1);
                    });
                });
            });
        };
        this.deleteMessage = (options, cb) => {
            if (this._validate(options, ["qname", "id"], cb) === false)
                return;
            const key = `${this.redisns}${options.qname}`;
            const mc = [
                ["zrem", key, options.id],
                ["hdel", `${key}:Q`, `${options.id}`, `${options.id}:rc`, `${options.id}:fr`]
            ];
            this.redis.multi(mc).exec((err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                if (resp[0] === 1 && resp[1] > 0) {
                    cb(null, 1);
                }
                else {
                    cb(null, 0);
                }
            });
        };
        this.deleteQueue = (options, cb) => {
            if (this._validate(options, ["qname"], cb) === false)
                return;
            const key = `${this.redisns}${options.qname}`;
            const mc = [
                ["del", `${key}:Q`, key],
                ["srem", `${this.redisns}QUEUES`, options.qname]
            ];
            this.redis.multi(mc).exec((err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                if (resp[0] === 0) {
                    this._handleError(cb, "queueNotFound");
                    return;
                }
                cb(null, 1);
            });
        };
        this.getQueueAttributes = (options, cb) => {
            if (this._validate(options, ["qname"], cb) === false)
                return;
            const key = `${this.redisns}${options.qname}`;
            this.redis.time((err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                const mc = [
                    ["hmget", `${key}:Q`, "vt", "delay", "maxsize", "totalrecv", "totalsent", "created", "modified"],
                    ["zcard", key],
                    ["zcount", key, resp[0] + "000", "+inf"]
                ];
                this.redis.multi(mc).exec((err, resp) => {
                    if (err) {
                        this._handleError(cb, err);
                        return;
                    }
                    if (resp[0][0] === null) {
                        this._handleError(cb, "queueNotFound");
                        return;
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
        };
        this._handleReceivedMessage = (cb) => {
            return (err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
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
                };
                cb(null, o);
            };
        };
        this.initScript = () => {
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
			return o`;
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
            const script_changeMessageVisibility = `local msg = redis.call("ZSCORE", KEYS[1], KEYS[2])
			if not msg then
				return 0
			end
			redis.call("ZADD", KEYS[1], KEYS[3], KEYS[2])
			return 1`;
            this.redis.script("load", script_popMessage, (err, resp) => {
                if (err) {
                    console.log(err);
                    return;
                }
                this.popMessage_sha1 = resp;
                this.emit("scriptload:popMessage");
            });
            this.redis.script("load", script_receiveMessage, (err, resp) => {
                if (err) {
                    console.log(err);
                    return;
                }
                this.receiveMessage_sha1 = resp;
                this.emit("scriptload:receiveMessage");
            });
            this.redis.script("load", script_changeMessageVisibility, (err, resp) => {
                if (err) {
                    console.log(err);
                    return;
                }
                this.changeMessageVisibility_sha1 = resp;
                this.emit('scriptload:changeMessageVisibility');
            });
        };
        this.listQueues = (cb) => {
            this.redis.smembers(`${this.redisns}QUEUES`, (err, resp) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                cb(null, resp);
            });
        };
        this.popMessage = (options, cb) => {
            if (this._validate(options, ["qname"], cb) === false)
                return;
            this._getQueue(options.qname, false, (err, q) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                if (this.popMessage_sha1) {
                    this._popMessage(options, q, cb);
                    return;
                }
                this.on("scriptload:popMessage", () => {
                    this._popMessage(options, q, cb);
                });
            });
        };
        this.receiveMessage = (options, cb) => {
            if (this._validate(options, ["qname"], cb) === false)
                return;
            this._getQueue(options.qname, false, (err, q) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                options.vt = options.vt != null ? options.vt : q.vt;
                if (this._validate(options, ["vt"], cb) === false)
                    return;
                if (this.receiveMessage_sha1) {
                    this._receiveMessage(options, q, cb);
                    return;
                }
                this.on("scriptload:receiveMessage", () => {
                    this._receiveMessage(options, q, cb);
                });
            });
        };
        this._popMessage = (options, q, cb) => {
            this.redis.evalsha(this.popMessage_sha1, 2, `${this.redisns}${options.qname}`, q.ts, this._handleReceivedMessage(cb));
        };
        this._receiveMessage = (options, q, cb) => {
            this.redis.evalsha(this.receiveMessage_sha1, 3, `${this.redisns}${options.qname}`, q.ts, q.ts + options.vt * 1000, this._handleReceivedMessage(cb));
        };
        this.sendMessage = (options, cb) => {
            if (this._validate(options, ["qname"], cb) === false)
                return;
            this._getQueue(options.qname, true, (err, q) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                options.delay = options.delay != null ? options.delay : q.delay;
                if (this._validate(options, ["delay"], cb) === false)
                    return;
                if (typeof options.message !== "string") {
                    this._handleError(cb, "messageNotString");
                    return;
                }
                if (q.maxsize !== -1 && Buffer.byteLength(options.message, "utf8") > q.maxsize) {
                    this._handleError(cb, "messageTooLong");
                    return;
                }
                const key = `${this.redisns}${options.qname}`;
                const mc = [
                    ["zadd", key, q.ts + options.delay * 1000, q.uid],
                    ["hset", `${key}:Q`, q.uid, options.message],
                    ["hincrby", `${key}:Q`, "totalsent", 1]
                ];
                if (this.realtime) {
                    mc.push(["zcard", key]);
                }
                this.redis.multi(mc).exec((err, resp) => {
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
        };
        this.setQueueAttributes = (options, cb) => {
            const props = ["vt", "maxsize", "delay"];
            let k = [];
            for (let item of props) {
                if (options[item] != null) {
                    k.push(item);
                }
            }
            if (k.length === 0) {
                this._handleError(cb, "noAttributeSupplied");
                return;
            }
            if (this._validate(options, ["qname"].concat(k), cb) === false)
                return;
            const key = `${this.redisns}${options.qname}`;
            this._getQueue(options.qname, false, (err, q) => {
                if (err) {
                    this._handleError(cb, err);
                    return;
                }
                this.redis.time((err, resp) => {
                    if (err) {
                        this._handleError(cb, err);
                        return;
                    }
                    const mc = [
                        ["hset", `${this.redisns}${options.qname}:Q`, "modified", resp[0]]
                    ];
                    for (let item of k) {
                        mc.push(["hset", `${this.redisns}${options.qname}:Q`, item, options[item]]);
                    }
                    ;
                    this.redis.multi(mc).exec((err) => {
                        if (err) {
                            this._handleError(cb, err);
                            return;
                        }
                        this.getQueueAttributes(options, cb);
                    });
                });
            });
        };
        this._handleError = (cb, err, data = {}) => {
            let _err = null;
            if (typeof err === "string") {
                _err = new Error();
                _err.name = err;
                let ref = null;
                _err.message = ((ref = this._ERRORS) != null ? typeof ref[err] === "function" ? ref[err](data) : void 0 : void 0) || "unkown";
            }
            else {
                _err = err;
            }
            cb(_err);
        };
        this._initErrors = () => {
            this._ERRORS = {};
            for (let key in this.ERRORS) {
                this._ERRORS[key] = this._compileTemplate(this.ERRORS[key]);
            }
        };
        this._VALID = {
            qname: /^([a-zA-Z0-9_-]){1,160}$/,
            id: /^([a-zA-Z0-9:]){32}$/
        };
        this._validate = (o, items, cb) => {
            for (let item of items) {
                switch (item) {
                    case "qname":
                    case "id":
                        if (!o[item]) {
                            this._handleError(cb, "missingParameter", { item: item });
                            return false;
                        }
                        o[item] = o[item].toString();
                        if (!this._VALID[item].test(o[item])) {
                            this._handleError(cb, "invalidFormat", { item: item });
                            return false;
                        }
                        break;
                    case "vt":
                    case "delay":
                        o[item] = parseInt(o[item], 10);
                        if (Number.isNaN(o[item]) || typeof o[item] !== "number" || o[item] < 0 || o[item] > 9999999) {
                            this._handleError(cb, "invalidValue", { item: item, min: 0, max: 9999999 });
                            return false;
                        }
                        break;
                    case "maxsize":
                        o[item] = parseInt(o[item], 10);
                        if (Number.isNaN(o[item]) || typeof o[item] !== "number" || o[item] < 1024 || o[item] > 65536) {
                            if (o[item] !== -1) {
                                this._handleError(cb, "invalidValue", { item: item, min: 1024, max: 65536 });
                                return false;
                            }
                        }
                        break;
                }
            }
            ;
            return o;
        };
        this.ERRORS = {
            "noAttributeSupplied": "No attribute was supplied",
            "missingParameter": "No <%= item %> supplied",
            "invalidFormat": "Invalid <%= item %> format",
            "invalidValue": "<%= item %> must be between <%= min %> and <%= max %>",
            "messageNotString": "Message must be a string",
            "messageTooLong": "Message too long",
            "queueNotFound": "Queue not found",
            "queueExists": "Queue exists"
        };
        if (Promise) {
            const methods = [
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
            ];
            for (const methodKey of methods) {
                this.asyncify(methodKey);
            }
        }
        const opts = Object.assign({
            host: "127.0.0.1",
            port: 6379,
            options: {},
            client: null,
            ns: "rsmq",
            realtime: false
        }, options);
        this.realtime = opts.realtime;
        this.redisns = opts.ns + ":";
        if (opts.client && this._isRedisClient(opts.client)) {
            this.redis = opts.client;
        }
        else {
            this.redis = RedisInst.createClient(this._clientOptions(opts));
        }
        this.connected = this.redis.connected || false;
        if (this.connected) {
            this.emit("connect");
            this.initScript();
        }
        this.redis.on("connect", () => {
            this.connected = true;
            this.emit("connect");
            this.initScript();
        });
        this.redis.on("error", (err) => {
            const message = (err && err.message) || "";
            if ((err && err.code === "ECONNREFUSED") || message.indexOf("ECONNREFUSED") !== -1) {
                this.connected = false;
                this.emit("disconnect");
            }
            else {
                console.error("Redis ERROR", err);
                if (this.listenerCount("error") > 0) {
                    this.emit("error", err);
                }
            }
        });
        this._initErrors();
    }
    _isRedisClient(client) {
        const RedisClient = RedisInst.RedisClient;
        if (RedisClient && client instanceof RedisClient) {
            return true;
        }
        return client.constructor != null && client.constructor.name === "RedisClient";
    }
    _clientOptions(opts) {
        const clientOptions = {};
        for (const key of Object.keys(opts)) {
            if (RSMQ_OPTIONS.indexOf(key) === -1) {
                clientOptions[key] = opts[key];
            }
        }
        Object.assign(clientOptions, opts.options);
        clientOptions.host = opts.host;
        clientOptions.port = opts.port;
        if (opts.password != null && clientOptions.password == null) {
            clientOptions.password = opts.password;
        }
        return clientOptions;
    }
    _formatZeroPad(num, count) {
        return ((Math.pow(10, count) + num) + "").slice(1);
    }
    _compileTemplate(template) {
        return (data = {}) => {
            return template.replace(/<%=\s*([a-zA-Z0-9_$]+)\s*%>/g, (match, key) => {
                return data[key] != null ? String(data[key]) : "";
            });
        };
    }
    _makeid(len) {
        let text = "";
        const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        let i = 0;
        for (i = 0; i < len; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}
module.exports = RedisSMQ;
