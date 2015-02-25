# Redis Data Structure

## rsmq:QUEUES *SET*

**MEMBER** The queue name

The global SET, which stores all used queue names. When a queue is created the name is added to this set as a member. When a queue is deleted the member will be removed from this set.


## rsmq:{qname}:Q *HASH*

This hash keeps all data for a single queue.

**FIELDS** 
* `{msgid}`: The message
* `{msgid}:rc`: The receive counter for a single message. Will be incremented on each receive.
* `{msgid}:fr`: The timestamp when this message was received for the first time. Will be created on the first receive.
* `totalsent`: The total number of messages sent to this queue.
* `totalrecv`: The total number of messages received from this queue.

## rsmq:{qname} *ZSET*

A sorted set of all messages of a single queue

**SCORE** Next possible receive timestamp (epoch time in ms)

**MEMBER** The `{msgid}'
