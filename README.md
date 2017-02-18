![RSMQ: Redis Simple Message Queue for Node.js](https://img.webmart.de/rsmq_wide.png)

# Redis Simple Message Queue

A lightweight message queue for Node.js that requires no dedicated queue server. Just a Redis server.

[![Build Status](https://secure.travis-ci.org/smrchy/rsmq.png?branch=master)](http://travis-ci.org/smrchy/rsmq)
[![Dependency Status](https://david-dm.org/smrchy/rsmq.svg)](https://david-dm.org/smrchy/rsmq)

**tl;dr:** If you run a Redis server and currently use Amazon SQS or a similar message queue you might as well use this fast little replacement. Using a shared Redis server multiple Node.js processes can send / receive messages.

## Features

* Lightweight: **Just Redis** and ~500 lines of javascript.
* Speed: Send and receive 1000+ messages per second on an average machine. It's **just Redis**.
* Guaranteed **delivery of a message to exactly one recipient** within a messages visibility timeout.
* Received messages that are not deleted will reappear after the visibility timeout.
* [Test coverage](http://travis-ci.org/smrchy/rsmq)
* A message is deleted by the message id. The message id is returned by the `sendMessage` and `receiveMessage` method.
* Messages stay in the queue unless deleted.
* Optional RESTful interface via [rest-rsmq](https://github.com/smrchy/rest-rsmq)  
  
**Note:** RSMQ uses the Redis EVAL command (LUA scripts) so the minimum Redis version is 2.6+. 

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


## Modules for RSMQ

To keep the core of *RSMQ* small additional functionality is available as modules:

* [**rsmq-worker**](https://github.com/mpneuried/rsmq-worker) Helper to implement a worker with RSMQ.
* [**rest-rsmq**](https://github.com/smrchy/rest-rsmq) A RESTful interface for RSMQ.
* [**rsmq-cli**](https://github.com/mpneuried/rsmq-cli) A command-line interface / Terminal client for RSMQ.


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
* `ns` (String): *optional (Default: "rsmq")* The namespace prefix used for all keys created by RSMQ


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

### List queues


```javascript
rsmq.listQueues( function (err, queues) {
	if( err ){
		console.error( err )
		return
	}
	console.log("Active queues: " + queues.join( "," ) )
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

* `qname` (String): The Queue name. Maximum 160 characters; alphanumeric characters, hyphens (-), and underscores (_) are allowed.
* `vt` (Number): *optional* *(Default: 30)* The length of time, in seconds, that a message received from a queue will be invisible to other receiving components when they ask to receive messages. Allowed values: 0-9999999 (around 115 days)
* `delay` (Number): *optional* *(Default: 0)* The time in seconds that the delivery of all new messages in the queue will be delayed. Allowed values: 0-9999999 (around 115 days)
* `maxsize` (Number): *optional* *(Default: 65536)* The maximum message size in bytes. Allowed values: 1024-65536
* `allowLargeMessages` (Boolean): *optional* *(Default: false)* If you want to allow use a  `maxsize` over 65536 set this to true

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



### popMessage

Receive the next message from the queue **and delete it**.

**Important:** This method deletes the message it receives right away. There is no way to receive the message again if something goes wrong while working on the message.

Parameters:

* `qname` (String): The Queue name.

Returns an object:

  * `message`: The message's contents.
  * `id`: The internal message id.
  * `sent`: Timestamp of when this message was sent / created.
  * `fr`: Timestamp of when this message was first received.
  * `rc`: Number of times this message was received.

Note: Will return an empty object if no message is there  



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

    
### quit

Disconnect the redis client.
This is only useful if you are using rsmq within a script and want node to be able to exit.

## Changes

see the [CHANGELOG](https://github.com/smrchy/rsmq/blob/master/CHANGELOG.md)


## Other projects

|Name|Description|
|:--|:--|
|[**node-cache**](https://github.com/tcs-de/nodecache)|Simple and fast Node.js internal caching. Node internal in memory cache like memcached.|
|[**redis-tagging**](https://github.com/smrchy/redis-tagging)|A Node.js helper library to make tagging of items in any legacy database (SQL or NoSQL) easy and fast.|
|[**redis-sessions**](https://github.com/smrchy/redis-sessions)|An advanced session store for Node.js and Redis|
|[**rsmq-worker**](https://github.com/mpneuried/rsmq-worker)|Helper to implement a worker based on [RSMQ (Redis Simple Message Queue)](https://github.com/smrchy/rsmq).|
|[**redis-notifications**](https://github.com/mpneuried/redis-notifications)|A Redis based notification engine. It implements the rsmq-worker to safely create notifications and recurring reports.|
|[**task-queue-worker**](https://github.com/smrchy/task-queue-worker)|A powerful tool for background processing of tasks that are run by making standard http requests.|
|[**obj-schema**](https://github.com/mpneuried/obj-schema)|Simple module to validate an object by a predefined schema|
|[**connect-redis-sessions**](https://github.com/mpneuried/connect-redis-sessions)|A connect or express middleware to use [redis sessions](https://github.com/smrchy/redis-sessions) that lets you handle multiple sessions per user_id.|
|[**systemhealth**](https://github.com/mpneuried/systemhealth)|Node module to run simple custom checks for your machine or it's connections. It will use [redis-heartbeat](https://github.com/mpneuried/redis-heartbeat) to send the current state to Redis.|
|[**soyer**](https://github.com/mpneuried/soyer)|Soyer is small lib for serverside use of Google Closure Templates with node.js.|
|[**grunt-soy-compile**](https://github.com/mpneuried/grunt-soy-compile)|Compile Goggle Closure Templates (SOY) templates including the handling of XLIFF language files.|
|[**backlunr**](https://github.com/mpneuried/backlunr)|A solution to bring Backbone Collections together with the browser fulltext search engine Lunr.js|

## The MIT License

Please see the LICENSE.md file.
