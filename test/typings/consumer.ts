// Compile-only check for the shipped `index.d.ts`.
// Runs with `"types": []` (see tsconfig.json in this folder) to make sure the typings
// work without `@types/redis` or `@types/node` being installed in a consuming project.

import RedisSMQ = require("../../index");

const rsmq = new RedisSMQ();
const rsmqWithOptions = new RedisSMQ({
	host: "127.0.0.1",
	port: 6379,
	ns: "rsmq",
	realtime: true,
	password: "secret",
	options: { db: 2 }
});
const rsmqWithClient = new RedisSMQ({ client: {} });

rsmq.on("connect", () => { });
rsmq.on("disconnect", () => { });
rsmq.on("error", (err) => { console.error(err); });
rsmq.once("connect", () => { });

rsmq.createQueue({ qname: "myqueue", vt: 30, delay: 0, maxsize: 65536 }, (err, resp) => { });
rsmq.listQueues((err, queues: string[]) => { });
rsmq.getQueueAttributes({ qname: "myqueue" }, (err, attributes) => {
	const msgs: number = attributes.msgs;
});
rsmq.setQueueAttributes({ qname: "myqueue", vt: 20 }, (err, attributes) => { });
rsmq.sendMessage({ qname: "myqueue", message: "Hello", delay: 0 }, (err, id: string) => { });
rsmq.receiveMessage({ qname: "myqueue", vt: 10 }, (err, message) => { });
rsmq.popMessage({ qname: "myqueue" }, (err, message) => { });
rsmq.deleteMessage({ qname: "myqueue", id: "id" }, (err, resp) => { });
rsmq.changeMessageVisibility({ qname: "myqueue", id: "id", vt: 10 }, (err, resp) => { });
rsmq.deleteQueue({ qname: "myqueue" }, (err, resp) => { });
rsmq.quit();
rsmq.quit((err, resp) => { });

// Promise API
async function promiseApi() {
	await rsmq.createQueueAsync({ qname: "myqueue" });
	const id: string = await rsmq.sendMessageAsync({ qname: "myqueue", message: "Hello" });
	await rsmq.receiveMessageAsync({ qname: "myqueue" });
	await rsmq.popMessageAsync({ qname: "myqueue" });
	await rsmq.deleteMessageAsync({ qname: "myqueue", id: id });
	await rsmq.changeMessageVisibilityAsync({ qname: "myqueue", id: id, vt: 0 });
	await rsmq.getQueueAttributesAsync({ qname: "myqueue" });
	await rsmq.setQueueAttributesAsync({ qname: "myqueue", vt: 30 });
	await rsmq.listQueuesAsync();
	await rsmq.deleteQueueAsync({ qname: "myqueue" });
	await rsmq.quitAsync();
}
