const RedisSMQ = require("../dist/index");
const rsmq = new RedisSMQ({ host: "127.0.0.1", port: 6379, ns: "rsmq" });

/*
======================================
The same simple queue, without callbacks
======================================
*/

const queuename = "testqueue";

async function main() {
	try {
		await rsmq.createQueue({ qname: queuename });
	} catch (err) {
		// `queueExists` just tells us that the queue is already there
		if (err.name !== "queueExists") {
			throw err;
		}
		console.log("queue exists.. resuming..");
	}

	sendMessageLoop();
	receiveMessageLoop();
}

async function sendMessageLoop() {
	// push a message every 2 seconds into the queue
	while (true) {
		// send the messages with a random delay between 0-5 seconds
		await rsmq.sendMessage({
			qname: queuename,
			message: `Hello World at ${new Date().toISOString()}`,
			delay: Math.floor(Math.random() * 6)
		});
		console.log("pushed new message into queue..");
		await wait(2000);
	}
}

async function receiveMessageLoop() {
	// check for new messages every 2.5 seconds
	while (true) {
		// alternative to receiveMessage would be popMessage => receives the next message from the queue and deletes it.
		const message = await rsmq.receiveMessage({ qname: queuename });

		if (message.id) {
			console.log("received message:", message.message);
			// we are done with working on our message, we can now safely delete it
			await rsmq.deleteMessage({ qname: queuename, id: message.id });
			console.log("deleted message with id", message.id);
		} else {
			console.log("no available message in queue..");
		}
		await wait(2500);
	}
}

function wait(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
