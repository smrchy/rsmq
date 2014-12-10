![RSMQ: Redis Simple Message Queue for Node.js](https://img.webmart.de/rsmq_wide.png)

# Redis Simple Message Queue for Node.js - RSMQ

A lightweight message queue for Node.js that requires no dedicated queue server. Just a Redis server.

[![Build Status](https://secure.travis-ci.org/smrchy/rsmq.png?branch=master)](http://travis-ci.org/smrchy/rsmq)
[![Dependency Status](https://david-dm.org/smrchy/rsmq.svg)](https://david-dm.org/smrchy/rsmq)

**tl;dr:** If you run a Redis server and currently use Amazon SQS or a similar message queue you might as well use this fast little replacement. Using a shared Redis server multiple Node.js processes can send / receive messages.

## Features

* Lightweight: **Just Redis**. Every client can send and receive messages via a shared Redis server. 
* Guaranteed **delivery of a message to exactly one recipient** within a messages visibility timeout.
* No security: **Like memcached**. Only for internal use in trusted environments.
* [Test coverage](http://travis-ci.org/smrchy/rsmq)
* Similar to Amazon SQS (Simple Queue Service) - with some differences:
  * Durability depends on your Redis setup.
  * No ReceiptHandle. A message is deleted by the message id. A message can be deleted if you store the id that is returned from the `sendMessage` method.
  * No MessageRetentionPeriod: Messages stay in the queue unless deleted.
  * No bulk operations (SendMessageBatch, DeleteMessageBatch)
  * Some SQS specific features are missing
* Optional RESTful interface via [rest-rsmq](https://github.com/smrchy/rest-rsmq)  
  
  
## Usage

* After creating a queue you can send messages to that queue.
* The messages will be handled in a **FIFO** (first in first out) manner unless specified with a delay.
* Every message has a unique `id` that you can use to delete the message. 
* The `sendMessage` method will return the `id` for a sent message.
* The `receiveMessage` method will return an `id` along with the message and some stats.
* Should you not delete the message it will be eligible to be received again after the visibility timeout is reached.
* Please have a look at the `createQueue` and `receiveMessage` methods described below for optional parameters like **visibility timeout** and **delay**.


## Installation

`npm install rsmq`


## Example

### Initialize

```javascript
RedisSMQ = require("rsmq");
rsmq = new RedisSMQ( {host: "127.0.0.1", port: 6379, ns: "rsmq"} );
```
Parameters for RedisSMQ via an *options* object:

* `host` (String): *optional (Default: "127.0.0.1")* The Redis server
* `port` (Number): *optional (Default: 6379)* The Redis port
* `options` (Object): *optional (Default: {})* The Redis [https://github.com/mranney/node_redis#rediscreateclientport-host-options](redis.createClient) `options` object. 
* `client` (RedisClient): *optional* A existing redis client instance. `host` and `server` will be ignored.
* `ns` (String): *optional (Default: "rsmq")* The namespace prefix used for all keys created by **rsmq**


### Create a queue

Please look at the *Methods* section for optional parameters when creating a queue.

```javascript
rsmq.createQueue({qname:"myqueue"}, function (err, resp) {
		if (resp===1) {
			console.log("queue created")
		}
});

```


### Send a message


```javascript
rsmq.sendMessage({qname:"myqueue", message:"Hello World"}, function (err, resp) {
	if (resp) {
		console.log("Message sent. ID:", resp);
	}
});
```


### Receive a message


```javascript
rsmq.receiveMessage({qname:"myqueue"}, function (err, resp) {
	if (resp.id) {
		console.log("Message received.", resp)	
	}
	else {
		console.log("No messages for me...")
	}
});
```

### Delete a message


```javascript
rsmq.deleteMessage({qname:"myqueue", id:"dhoiwpiirm15ce77305a5c3a3b0f230c6e20f09b55"}, function (err, resp) {
	if (resp===1) {
		console.log("Message deleted.")	
	}
	else {
		console.log("Message not found.")
	}
});
```

  
## Methods


### changeMessageVisibility

Change the visibility timer of a single message.
The time when the message will be visible again is calculated from the current time (now) + `vt`.

Parameters:

* `qname` (String): The Queue name.
* `id` (String): The message id.
* `vt` (Number): The length of time, in seconds, that this message will not be visible. Allowed values: 0-9999999 (around 115 days)

Returns: 

* `1` if successful, `0` if the message was not found.



### createQueue

Create a new queue.

Parameters:

* `qname` (String): The Queue name. Maximum 80 characters; alphanumeric characters, hyphens (-), and underscores (_) are allowed.
* `vt` (Number): *optional* *(Default: 30)* The length of time, in seconds, that a message received from a queue will be invisible to other receiving components when they ask to receive messages. Allowed values: 0-9999999 (around 115 days)
* `delay` (Number): *optional* *(Default: 0)* The time in seconds that the delivery of all new messages in the queue will be delayed. Allowed values: 0-9999999 (around 115 days)
* `maxsize` (Number): *optional* *(Default: 65536)* The maximum message size in bytes. Allowed values: 1024-65536

Returns:

* `1`



### deleteMessage

Parameters:

* `qname` (String): The Queue name.
* `id` (String): message id to delete.

Returns:

* `1` if successful, `0` if the message was not found.



### deleteQueue

Deletes a queue and all messages.

Parameters:

* `qname` (String): The Queue name.

Returns:

* `1`



### getQueueAttributes

Get queue attributes, counter and stats

Parameters:

* `qname` (String): The Queue name.

Returns an object:

* `vt`: The visibility timeout for the queue in seconds
* `delay`: The delay for new messages in seconds
* `maxsize`: The maximum size of a message in bytes
* `totalrecv`: Total number of messages received from the queue
* `totalsent`: Total number of messages sent to the queue
* `created`: Timestamp (epoch in seconds) when the queue was created
* `modified`: Timestamp (epoch in seconds) when the queue was last modified with `setQueueAttributes`
* `msgs`: Current number of messages in the queue
* `hiddenmsgs`: Current number of hidden / not visible messages. A message can be hidden while "in flight" due to a `vt` parameter or when sent with a `delay`



### listQueues

List all queues

Returns an array:

* `["qname1", "qname2"]`



### receiveMessage

Receive the next message from the queue.

Parameters:

* `qname` (String): The Queue name.
* `vt` (Number): *optional* *(Default: queue settings)* The length of time, in seconds, that the received message will be invisible to others. Allowed values: 0-9999999 (around 115 days)

Returns an object:

  * `message`: The message's contents.
  * `id`: The internal message id.
  * `sent`: Timestamp of when this message was sent / created.
  * `fr`: Timestamp of when this message was first received.
  * `rc`: Number of times this message was received.

Note: Will return an empty object if no message is there  



### sendMessage

Sends a new message.

Parameters:

* `qname` (String)
* `message` (String)
* `delay` (Number): *optional* *(Default: queue settings)* The time in seconds that the delivery of the message will be delayed. Allowed values: 0-9999999 (around 115 days)

Returns:

* `id`: The internal message id.


    
### setQueueAttributes

Sets queue parameters.

Parameters:

* `qname` (String): The Queue name.
* `vt` (Number): *optional* * The length of time, in seconds, that a message received from a queue will be invisible to other receiving components when they ask to receive messages. Allowed values: 0-9999999 (around 115 days)
* `delay` (Number): *optional* The time in seconds that the delivery of all new messages in the queue will be delayed. Allowed values: 0-9999999 (around 115 days)
* `maxsize` (Number): *optional* The maximum message size in bytes. Allowed values: 1024-65536

Note: At least one attribute (vt, delay, maxsize) must be supplied. Only attributes that are supplied will be modified.

Returns an object:

* `vt`: The visibility timeout for the queue in seconds
* `delay`: The delay for new messages in seconds
* `maxsize`: The maximum size of a message in bytes
* `totalrecv`: Total number of messages received from the queue
* `totalsent`: Total number of messages sent to the queue
* `created`: Timestamp (epoch in seconds) when the queue was created
* `modified`: Timestamp (epoch in seconds) when the queue was last modified with `setQueueAttributes`
* `msgs`: Current number of messages in the queue
* `hiddenmsgs`: Current number of hidden / not visible messages. A message can be hidden while "in flight" due to a `vt` parameter or when sent with a `delay`



## Changes

see the [CHANGELOG](https://github.com/smrchy/rsmq/blob/master/CHANGELOG.md)


## More Node.js and Redis projects?

Check out our other projects which are based on Node.js and Redis as a datastore:


### [Redis-Tagging](https://github.com/smrchy/redis-tagging)

A Node.js helper library to make tagging of items in any legacy database (SQL or NoSQL) easy and fast. Redis is used to store tag-item associations and to allow fast queries and paging over large sets of tagged items.

* **Maintains order** of tagged items
* **Unions** and **intersections** while maintaining the order
* Counters for each tag
* **Fast paging** over results with `limit` and `offset`
* Optional **RESTful interface** via [REST-tagging](https://github.com/smrchy/rest-tagging)
* [Read more...](https://github.com/smrchy/redis-tagging)


### [Redis-Sessions](https://github.com/smrchy/redis-sessions)

This is a Node.js module to keep sessions in a Redis datastore and add some useful methods.

The main purpose of this module is to **generalize sessions across application server platforms**. We use nginx reverse proxy to route parts of a website to a Node.js server and other parts could be Python, .net, PHP, Coldfusion or Java servers. You can then use [rest-sessions](https://github.com/smrchy/rest-sessions) to access the same sessions on all app server via a REST interface.

* Standard features: Set, update, delete a single session
* Advanced features: List / delete all sessions, all sessions of a single UserID
* Activity in the last *n* seconds
* [and more...](https://github.com/smrchy/redis-sessions)

## The MIT License (MIT)

Copyright © Patrick Liess, http://www.tcs.de

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

