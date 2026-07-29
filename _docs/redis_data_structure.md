# Redis Data Structure

This is the data contract of RSMQ. It has not changed since `0.x`, so clients of any version -
and the [ports to other languages](../README.md#rsmq-in-other-languages) - can share the same queues.

`rsmq:` is the default namespace and can be changed with the `ns` option.

## rsmq:QUEUES *SET*

**MEMBER** The queue name

The global SET, which stores all used queue names. When a queue is created the name is added to this set as a member. When a queue is deleted the member will be removed from this set.


## rsmq:{qname}:Q *HASH*

This hash keeps all data for a single queue.

**FIELDS**
* `vt`: The visibility timeout of the queue in seconds.
* `delay`: The delay for new messages of the queue in seconds.
* `maxsize`: The maximum message size in bytes, or `-1` for unlimited.
* `created`: The timestamp (epoch time in seconds) when the queue was created.
* `modified`: The timestamp (epoch time in seconds) of the last `setQueueAttributes`.
* `totalsent`: The total number of messages sent to this queue.
* `totalrecv`: The total number of messages received from this queue.
* `{msgid}`: The message
* `{msgid}:rc`: The receive counter for a single message. Will be incremented on each receive.
* `{msgid}:fr`: The timestamp when this message was received for the first time. Will be created on the first receive.

## rsmq:{qname} *ZSET*

A sorted set of all messages of a single queue

**SCORE** Next possible receive timestamp (epoch time in ms)

**MEMBER** The `{msgid}`

## The message id

A `{msgid}` is 32 characters long and consists of two parts:

* the first 10 characters are the Redis time (seconds and microseconds) of the moment the message was
  created, in base 36. Sorting by id therefore sorts by creation time, even for messages created
  within the same millisecond.
* the remaining 22 characters are random (`A-Z`, `a-z`, `0-9`).

## rsmq:rt:{qname} *PUBSUB CHANNEL*

Only used when the `realtime` option is enabled. Every `sendMessage` publishes the new number of
messages in the queue (the `ZCARD` of `rsmq:{qname}`) to this channel.
