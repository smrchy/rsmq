const RedisSMQ = require("../index");
const rsmq = new RedisSMQ( {host: "127.0.0.1", port: 6379, ns: "rsmq"} );

/*
======================================
Create simple wrappers for rsmq functions
======================================
*/

// create a new queue
function createQueue(queue, cb) {
	rsmq.createQueue({ qname: queue }, function (err, resp) {
		if (err) {
			cb(err);
			return;
		}

		if (resp) {
			cb(null);
		}
	});
}

// push a message into a queue
function sendMessage(queue, msg, cb) { // `Hello World at ${new Date().toISOString()}`
	rsmq.sendMessage({ qname: queue, message: msg }, function (err, resp) {
		if (err) {
			cb(err);
			return;
		}

		if (resp) {
			cb(null, resp);
		}
	});
}

// retreive latest message from a queue
function receiveMessage(queue, cb) {
	rsmq.receiveMessage({ qname: queue }, function (err, resp) {
		if (err) {
			cb(err);
			return;
		}

		if (resp.id) {
			cb(null, resp);
		} else {
			cb("No messages in queue...");
		}
	});
}

// delete a message from a queue
function deleteMessage(queue, msgid, cb) {
	rsmq.deleteMessage({ qname: queue, id: msgid }, function (err, resp) {
		if (err) {
			cb(err);
			return;
		}

		cb(null, resp);
	});
}

function getQueueAttributes(queue, cb) {
	rsmq.getQueueAttributes({ qname: queue }, function (err, resp) {
		if (err) {
			cb(err);
			return;
		}

		cb(null, resp);
	});
}

/*
======================================
Test all available functions
======================================
*/

function main() {
	const queuename = "testqueue";

	// create a queue
	createQueue(queuename, (err) => {
		if (err) {
			console.error(err);

			if (err.name !== "queueExists") {
				return;
			} else {
				console.log("queue exists.. resuming..");
			}
		}

		sendMessageLoop(queuename);
		receiveMessageLoop(queuename);
	});
}
main();

function sendMessageLoop(queuename) {
	// push a message every 2 seconds into the queue
	setInterval(() => {
		sendMessage(queuename, `Hello World at ${new Date().toISOString()}`, (err) => {
			if (err) {
				console.error(err);
				return;
			}

			console.log("pushed new message into queue..");
		});
	}, 2000);
}

function receiveMessageLoop(queuename) {
	// check for new messages every 2.5 seconds
	setInterval(() => {
		// alternative to receiveMessage would be popMessage => receives the next message from the queue and deletes it.
		receiveMessage(queuename, (err, resp) => {
			if (err) {
				console.error(err);
				return;
			}

			// checks if a message has been received
			if (resp.id) {
				console.log("received message:", resp.message);

				// we are done with working on our message, we can now safely delete it
				deleteMessage(queuename, resp.id, (err) => {
					if (err) {
						console.error(err);
						return;
					}

					console.log("deleted message with id", resp.id);
				});
			}
		});
	}, 500);
}