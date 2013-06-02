# rsmq

A really simple message queue based on Redis

[![Build Status](https://secure.travis-ci.org/smrchy/rsmq.png?branch=master)](http://travis-ci.org/smrchy/rsmq)

## Alpha version. 

This is still an alpha version. Use with care.


## Features

* Lightweight: **Just Redis**. Every client can send and receive messages via a shared Redis server. 
* Guaranteed **delivery of a message to exactly one recipient** within a messages visibility timeout.
* No security: **Like memcached**. Only for internal use in trusted environments.
* Similar to Amazon SQS (Simple Queue Service) - with some differences:
  * Durability depends on your Redis setup.
  * No ReceiptHandle. A message is deleted by the message id.
    * This means that a message can be deleted if you store the id that is returned from the `sendMessage` method. 
  * No MessageRetentionPeriod: Messages stay in the queue unless deleted.
  * No bulk operations (SendMessageBatch, DeleteMessageBatch)
  * Some AWS specific features are missing
  
  
  
## Usage

* After creating a queue you can send messages to that queue.
* The messages will be handled in a **FIFO** (first in first out) manner unless specified differently with a delay.
* Every message has a unique `id` that you can use to delete the message. 
* The `sendMessage` method will return the `id` for a sent message.
* The `receiveMessage` method will return an `id` along with the message and some stats.
* Should you not delete the message it will be eligible to be received again after the visibility timeout is reached.
* Please have a look at the `createQueue` and `receiveMessage` methods described below for optional parameters like **visibility timeout** and **delay**.


## Installation

`npm install rsmq`


## Example

### Initialize

```
RedisSMQ = require("rsmq");
// Initialize RedisSMQ(redisport, redishost, namespaceprefix)
rsmq = new RedisSMQ(6379,"127.0.0.1","rsmq");
```

### Create a queue

Please look at the *Methods* section for optional parameters when creating a queue.

```
rsmq.createQueue({qname:"myqueue"}, function (err, resp) {
		if (resp===1) {
			console.log("queue created")
		}
});

```


### Send a message


```
rsmq.sendMessage({qname:"myqueue", message:"Hello World"}, function (err, resp) {
	if (resp) {
		console.log("Message sent. ID:", resp);
	}
});
```


### Receive a message


```
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


```
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


### createQueue

Create a new queue.

Parameters:

* `qname` (String): The Queue name. Maximum 80 characters; alphanumeric characters, hyphens (-), and underscores (_) are allowed.
* `vt` (Number): *optional* *(Default: 30)* The length of time, in seconds, that a message received from a queue will be invisible to other receiving components when they ask to receive messages. Allowed values: 0-86400
* `delay` (Number): *optional* *(Default: 0)* The time in seconds that the delivery of all new messages in the queue will be delayed. Allowed values: 0-86400
* `maxsize` (Number): *optional* *(Default: 65536)* The maximum message size in bytes. Allowed values: 1024-65536

Returns:

* `1`

Errors:

* `"Invalid qname format"`
* `"Queue exists"`



### deleteMessage

Parameters:

* `qname` (String): The Queue name.
* `id` (String): message id to delete.

Returns:

* `1` if successful, `0` if the message was not found.

Errors:

* `"Queue not found"`



### deleteQueue

Deletes a queue and all messages.

Parameters:

* `QueueName` (String): The Queue name.

Returns:

* `1`

Errors:

* `"Invalid qname format"`
* `"Queue not found"`



### receiveMessage

Parameters:

* `qname` (String): The Queue name.
* `vt` (Number): *optional* *(Default: queue settings)* The length of time, in seconds, that the received message will be invisible to others. Allowed values: 0-86400

Returns:

  * `message`: The message's contents.
  * `id`: The internal message id.
  * `sent`: Timestamp of when this message was sent / created.
  * `fr`: Timestamp of when this message was first received.
  * `rc`: Number of times this message was received.

Note: Will return an empty object if no message is there  

Errors:

* `"Queue not found"`



### sendMessage

Sends a new message

Parameters:

* `qname` (String)
* `message` (String)
* `delay` (Number): *optional* *(Default: queue settings)* The time in seconds that the delivery of the message will be delayed. Allowed values: 0-2592000 (30 days)

Returns:

* `id`: The internal message id.

Error:

* `"Queue not found"`






## Not implemented yet

### changeMessageVisibility

Change the `VisibilityTimeout` of a single message.

### getQueueAttributes

Lists the queue parameters.

### listQueues

Lists all queues.

### setQueueAttributes

Sets queue parameters.



## The MIT License (MIT)

Copyright © 2013 Patrick Liess, http://www.tcs.de

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the “Software”), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED “AS IS”, WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

