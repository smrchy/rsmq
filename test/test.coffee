_ = require "lodash"
should = require "should"
async = require "async"
RedisSMQ = require "../index" 

describe 'Redis-Simple-Message-Queue Test', ->
	rsmq = null
	queue1 = "test1"
	queue2 = "test2"

	q1m1 = null
	q1m2 = null
	q2m2 = null
	q2msgs = {}


	before (done) ->
		done()
		return

	after (done) ->
		done()		
		return
	


	it 'get a RedisSMQ instance', (done) ->
		rsmq = new RedisSMQ()
		rsmq.should.be.an.instanceOf RedisSMQ
		done()
		return

	describe 'Queues', ->

		it 'Should fail: Create a new queue with invalid characters in name', (done) ->
			rsmq.createQueue {qname:"should throw"}, (err, resp) ->
				err.message.should.equal("Invalid qname format")
				done()
				return
			return
		it 'Should fail: Create a new queue with name longer 80 chars', (done) ->
			rsmq.createQueue {qname:"name01234567890123456789012345678901234567890123456789012345678901234567890123456789"}, (err, resp) ->
				err.message.should.equal("Invalid qname format")
				done()
				return
			return
		it 'Should fail: Create a new queue with negative vt', (done) ->
			rsmq.createQueue {qname:queue1, vt: -20}, (err, resp) ->
				err.message.should.equal("vt must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with non numeric vt', (done) ->
			rsmq.createQueue {qname:queue1, vt: "not_a_number"}, (err, resp) ->
				err.message.should.equal("vt must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with vt too high', (done) ->
			rsmq.createQueue {qname:queue1, vt: 10000000}, (err, resp) ->
				err.message.should.equal("vt must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with negative delay', (done) ->
			rsmq.createQueue {qname:queue1, delay: -20}, (err, resp) ->
				err.message.should.equal("delay must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with non numeric delay', (done) ->
			rsmq.createQueue {qname:queue1, delay: "not_a_number"}, (err, resp) ->
				err.message.should.equal("delay must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with delay too high', (done) ->
			rsmq.createQueue {qname:queue1, delay: 10000000}, (err, resp) ->
				err.message.should.equal("delay must be between 0 and 9999999")
				done()
				return
			return
		it 'Should fail: Create a new queue with negative maxsize', (done) ->
			rsmq.createQueue {qname:queue1, maxsize: -20}, (err, resp) ->
				err.message.should.equal("maxsize must be between 1024 and 65536")
				done()
				return
			return
		it 'Should fail: Create a new queue with non numeric maxsize', (done) ->
			rsmq.createQueue {qname:queue1, maxsize: "not_a_number"}, (err, resp) ->
				err.message.should.equal("maxsize must be between 1024 and 65536")
				done()
				return
			return
		it 'Should fail: Create a new queue with maxsize too high', (done) ->
			rsmq.createQueue {qname:queue1, maxsize: 66000}, (err, resp) ->
				err.message.should.equal("maxsize must be between 1024 and 65536")
				done()
				return
			return
		it 'Should fail: Create a new queue with maxsize too low', (done) ->
			rsmq.createQueue {qname:queue1, maxsize: 900}, (err, resp) ->
				err.message.should.equal("maxsize must be between 1024 and 65536")
				done()
				return
			return

		it 'ListQueues: Should return empty array', (done) ->
			rsmq.listQueues (err, resp) ->
				should.not.exist(err)
				resp.length.should.equal(0)
				done()
				return
			return

		it 'Create a new queue: queue1', (done) ->
			rsmq.createQueue {qname:queue1}, (err, resp) ->
				should.not.exist(err)
				resp.should.equal(1)
				done()
				return
			return

		it 'Should fail: Create the same queue again', (done) ->
			rsmq.createQueue {qname:queue1}, (err, resp) ->
				err.message.should.equal("Queue exists")
				done()
				return
			return

		it 'ListQueues: Should return array with one element', (done) ->
			rsmq.listQueues (err, resp) ->
				should.not.exist(err)
				resp.length.should.equal(1)
				resp.should.containEql(queue1)
				done()
				return
			return


		it 'Create a new queue: queue2', (done) ->
			rsmq.createQueue {qname:queue2, maxsize:2048}, (err, resp) ->
				should.not.exist(err)
				resp.should.equal(1)
				done()
				return
			return
		

		it 'ListQueues: Should return array with two elements', (done) ->
			rsmq.listQueues (err, resp) ->
				should.not.exist(err)
				resp.length.should.equal(2)
				resp.should.containEql(queue1)
				resp.should.containEql(queue2)
				done()
				return
			return


		it 'Should fail: GetQueueAttributes of bogus queue', (done) ->
			rsmq.getQueueAttributes {qname:"sdfsdfsdf"}, (err, resp) ->
				err.message.should.equal("Queue not found")
				done()
				return
			return


		it 'Should fail: setQueueAttributes of bogus queue with no supplied attributes', (done) ->
			rsmq.setQueueAttributes {qname:"kjdsfh3h"}, (err, resp) ->
				err.message.should.equal("No attribute was supplied")
				done()
				return
			return

		it 'Should fail: setQueueAttributes of bogus queue with supplied attributes', (done) ->
			rsmq.setQueueAttributes {qname:"kjdsfh3h",vt: 1000}, (err, resp) ->
				err.message.should.equal("Queue not found")
				done()
				return
			return

		it 'setQueueAttributes: Should return the queue with a new vt attribute', (done) ->
			rsmq.setQueueAttributes {qname: queue1, vt: 1234}, (err, resp) ->
				resp.vt.should.equal(1234)
				resp.delay.should.equal(0)
				resp.maxsize.should.equal(65536)
				done()
				return
			return

		it 'setQueueAttributes: Should return the queue with a new delay attribute', (done) ->
			rsmq.setQueueAttributes {qname: queue1, delay: 7}, (err, resp) ->
				resp.vt.should.equal(1234)
				resp.delay.should.equal(7)
				resp.maxsize.should.equal(65536)
				done()
				return
			return

		it 'setQueueAttributes: Should return the queue with a new maxsize attribute', (done) ->
			rsmq.setQueueAttributes {qname: queue1, maxsize: 2048}, (err, resp) ->
				resp.vt.should.equal(1234)
				resp.delay.should.equal(7)
				resp.maxsize.should.equal(2048)
				done()
				return
			return

		it 'setQueueAttributes: Should return the queue with a new attribute', (done) ->
			rsmq.setQueueAttributes {qname: queue1, maxsize: 65536, vt: 30, delay: 0}, (err, resp) ->
				resp.vt.should.equal(30)
				resp.delay.should.equal(0)
				resp.maxsize.should.equal(65536)
				done()
				return
			return

		it 'Should fail:setQueueAttributes: Should not accept too small maxsize', (done) ->
			rsmq.setQueueAttributes {qname: queue1, maxsize: 50}, (err, resp) ->
				err.message.should.equal("maxsize must be between 1024 and 65536")
				done()
				return
			return

		it 'Should fail:setQueueAttributes: Should not accept negative value', (done) ->
			rsmq.setQueueAttributes {qname: queue1, vt: -5}, (err, resp) ->
				err.message.should.equal("vt must be between 0 and 9999999")
				done()
				return
			return

		return

	describe 'Messages', ->
		it 'Should fail: Send a message to non-existing queue', (done) ->
			rsmq.sendMessage {qname:"rtlbrmpft", message:"foo"}, (err, resp) ->
				err.message.should.equal("Queue not found")
				done()
				return
			return
		it 'Should fail: Send a message without any parameters', (done) ->
			rsmq.sendMessage {}, (err, resp) ->
				err.message.should.equal("No qname supplied")
				done()
				return
			return
		it 'Should fail: Send a message without a message key', (done) ->
			rsmq.sendMessage {qname:queue1, messXage:"Hello"}, (err, resp) ->
				err.message.should.equal("Message must be a string")
				done()
				return
			return
		it 'Should fail: Send a message with message being a number', (done) ->
			rsmq.sendMessage {qname:queue1, message:123}, (err, resp) ->
				err.message.should.equal("Message must be a string")
				done()
				return
			return
		
		# TODO: Try to send a loooong msg

		it 'Send message 1', (done) ->
			rsmq.sendMessage {qname:queue1, message:"Hello"}, (err, resp) ->
				should.not.exist(err)
				q1m1 =
					id: resp
					message: "Hello"
				done()
				return
			return

		# Send 1000 msgs to q2 so we can delay sending of msg 2 to q1
		
		it 'Send 1000 messages to queue2: succeed', (done) ->
			pq = []
			for i in [0...1000]
				pq.push({qname:queue2, message: "test message number:" + i})
			async.map pq, rsmq.sendMessage, (err, resp) ->
				for e in resp
					q2msgs[e] = 1
					e.length.should.equal(32)
				_.keys(q2msgs).length.should.equal(1000)
				done()
				return
			return
		
		it 'Send message 2', (done) ->
			rsmq.sendMessage {qname:queue1, message:"World"}, (err, resp) ->
				should.not.exist(err)
				q1m2 =
					id: resp
					message: "World"
				done()
				return
			return


		it 'Receive a message. Should return message 1', (done) ->
			rsmq.receiveMessage {qname:queue1}, (err, resp) ->
				resp.id.should.equal(q1m1.id)
				done()
				return
			return

		it 'Receive a message. Should return message 2', (done) ->
			rsmq.receiveMessage {qname:queue1}, (err, resp) ->
				resp.id.should.equal(q1m2.id)
				done()
				return
			return


		it 'Should fail. Set the visibility of a non existing message', (done) ->
			rsmq.changeMessageVisibility {qname:queue1, id:"abcdefghij0123456789abcdefghij01", vt:10}, (err, resp) ->
				resp.should.equal(0)
				done()
				return
			return

		it 'Set new visibility timeout of message 2 to 10s', (done) ->
			rsmq.changeMessageVisibility {qname:queue1, id:q1m2.id, vt:	10}, (err, resp) ->
				resp.should.equal(1)
				done()
				return
			return

		it 'Receive a message. Should return nothing', (done) ->
			rsmq.receiveMessage {qname:queue1}, (err, resp) ->
				should.not.exist(resp.id)
				done()
				return
			return

		it 'Set new visibility timeout of message 2 to 0s', (done) ->
			rsmq.changeMessageVisibility {qname:queue1, id:q1m2.id, vt:	0}, (err, resp) ->
				resp.should.equal(1)
				done()
				return
			return

		it 'Receive a message. Should return message 2', (done) ->
			rsmq.receiveMessage {qname:queue1}, (err, resp) ->
				resp.id.should.equal(q1m2.id)
				done()
				return
			return

		it 'Receive a message. Should return nothing', (done) ->
			rsmq.receiveMessage {qname:queue1}, (err, resp) ->
				should.not.exist(resp.id)
				done()
				return
			return

		it 'Should fail: Delete a message without supplying an id', (done) ->
			rsmq.deleteMessage {qname:queue1}, (err, resp) ->
				err.message.should.equal("No id supplied")
				done()
				return
			return

		it 'Should fail: Delete a message with invalid id', (done) ->
			rsmq.deleteMessage {qname:queue1, id:"sdafsdf"}, (err, resp) ->
				err.message.should.equal("Invalid id format")
				done()
				return
			return

		it 'Delete message 1. Should return 1', (done) ->
			rsmq.deleteMessage {qname:queue1, id: q1m1.id}, (err, resp) ->
				resp.should.equal(1)
				done()
				return
			return

		it 'Delete message 1 again. Should return 0', (done) ->
			rsmq.deleteMessage {qname:queue1, id: q1m1.id}, (err, resp) ->
				resp.should.equal(0)
				done()
				return
			return

		it 'Set new visibility timeout of message 1. Should return 0.', (done) ->
			rsmq.changeMessageVisibility {qname:queue1, id:q1m1.id, vt:	10}, (err, resp) ->
				resp.should.equal(0)
				done()
				return
			return

		it 'Should fail: Send a message that is too long', (done) ->
			text = JSON.stringify([0..15000])
			rsmq.sendMessage {qname:queue1, message:text}, (err, resp) ->
				should.not.exist(resp)
				err.message.should.equal("Message too long")
				done()
				return
			return
		
		it 'Receive 1000 messages from queue2 and delete 500 (those where number is even)', (done) ->
			pq = []
			# we keep vt = 0 so we can query them again quickly
			for i in [0...1000]
				pq.push({qname:queue2, vt:0})
			async.map pq, rsmq.receiveMessage, (err, resp) ->
				dq = []
				for e in resp when not (e.message.split(":")[1] % 2)
					dq.push({qname:queue2, id:e.id})
					delete q2msgs[e.id]
				async.map dq, rsmq.deleteMessage, (err, resp) ->
					for e in resp
						e.should.equal(1)
					done()
					return
				return
			return

		it 'GetQueueAttributes: Should return queue attributes', (done) ->
			rsmq.getQueueAttributes {qname:queue2}, (err, resp) ->
				should.not.exist(err)
				resp.msgs.should.equal(500)
				done()
				return
			return

		it 'Receive 500 messages from queue2 and delete them', (done) ->
			pq = []
			# we keep vt = 0 so we can query them again quickly
			for i in [0...500]
				pq.push({qname:queue2, vt:0})
			async.map pq, rsmq.receiveMessage, (err, resp) ->
				dq = []

				for e in resp when e.message.split(":")[1] % 2
					dq.push({qname:queue2, id:e.id})
					delete q2msgs[e.id]
				async.map dq, rsmq.deleteMessage, (err, resp) ->
					for e in resp
						e.should.equal(1)
					done()

					# q2msgs should be empty
					_.keys(q2msgs).length.should.equal(0)
					return
				return
			return
		
		it 'Receive a message from queue2. Should return {}', (done) ->
			rsmq.receiveMessage {qname:queue2}, (err, resp) ->
				should.not.exist(resp.id)
				done()
				return
			return


		it 'GetQueueAttributes: Should return queue attributes', (done) ->
			rsmq.getQueueAttributes {qname:queue2}, (err, resp) ->
				should.not.exist(err)
				resp.totalrecv.should.equal(1500)
				resp.totalsent.should.equal(1000)
				resp.msgs.should.equal(0)
				done()
				return
			return
	
		# TODO: Check different vt values on receive
		
	describe 'CLEANUP', ->
		# Kill all queues
		it 'Remove queue1', (done) ->
			rsmq.deleteQueue {qname:queue1}, (err, resp) ->
				should.not.exist(err)
				resp.should.equal(1)
				done()
				return
			return

		it 'Remove queue2', (done) ->
			rsmq.deleteQueue {qname:queue2}, (err, resp) ->
				should.not.exist(err)
				resp.should.equal(1)
				done()
				return
			return
		return
	
	return
	