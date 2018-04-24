// Type definitions for rsmq 0.8.3
// Project: rsmq
// Definitions by: erdii https://github.com/erdii

/*~ This is the module template file for class modules.
*~ You should rename it to index.d.ts and place it in a folder with the same name as the module.
*~ For example, if you were writing a file for "super-greeter", this
*~ file should be 'super-greeter/index.d.ts'
*/

/*~ Note that ES6 modules cannot directly export class objects.
*~ This file should be imported using the CommonJS-style:
*~   import x = require('someLibrary');
*~
*~ Refer to the documentation to understand common
*~ workarounds for this limitation of ES6 modules.
*/

import { ClientOpts, RedisClient } from "redis";

/*~ This declaration specifies that the class constructor function
*~ is the exported object from the file
*/
export = RedisSMQ;

/*~ Write your module's methods and properties in this class */
declare class RedisSMQ {
	constructor(options: RedisSMQ.ConstructorOptions);

	quit(): void;

	createQueue(opts: RedisSMQ.CreateQueueOptions, cb: RedisSMQ.Callback<1>): void;
	listQueues(cb: RedisSMQ.Callback<string[]>): void;
	deleteQueue(opts: RedisSMQ.DeleteQueueOptions, cb: RedisSMQ.Callback<1>): void;
	getQueueAttributes(opts: RedisSMQ.GetQueueAttributesOptions, cb: RedisSMQ.Callback<RedisSMQ.QueueAttributes>): void;
	setQueueAttributes(opts: RedisSMQ.SetQueueAttributesOptions, cb: RedisSMQ.Callback<RedisSMQ.QueueAttributes>): void;

	sendMessage(opts: RedisSMQ.SendMessageOptions, cb: RedisSMQ.Callback<number>): void;
	receiveMessage(opts: RedisSMQ.ReceiveMessageOptions, cb: RedisSMQ.Callback<RedisSMQ.QueueMessage|{}>): void;
	popMessage(opts: RedisSMQ.PopMessageOptions, cb: RedisSMQ.Callback<RedisSMQ.QueueMessage|{}>): void;
	deleteMessage(opts: RedisSMQ.DeleteMessageOptions, cb: RedisSMQ.Callback<0|1>): void;
	changeMessageVisibility(opts: RedisSMQ.ChangeMessageVisibilityOptions, cb: RedisSMQ.Callback<0|1>): void;
}

declare namespace RedisSMQ {
	export type Callback<T> = (err: any, response: T) => void;

	export interface ConstructorOptions {
		host?: string;
		port?: number;
		ns?: string;
		options?: ClientOpts;
		client?: RedisClient;
	}

	interface BaseOptions {
		/**
		 * The Queue name.
		 * Maximum 160 characters; alphanumeric characters, hyphens (-), and underscores (_) are allowed.
		 * 
		 * @type {string}
		 * @memberof BaseQueueOptions
		 */
		qname: string;
	}

	export interface CreateQueueOptions extends BaseOptions {
		/**
		 * *(Default: 30)*
		 * The length of time, in seconds, that a message received from a queue will
		 * be invisible to other receiving components when they ask to receive messages.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof CreateQueueOptions
		 */
		vt?: number;

		/**
		 * *(Default: 0)*
		 * The time in seconds that the delivery of all new messages in the queue will be delayed.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof CreateQueueOptions
		 */
		delay?: number;

		/**
		 * *(Default: 65536)*
		 * The maximum message size in bytes.
		 * Allowed values: 1024-65536 and -1 (for unlimited size)
		 * 
		 * @type {number}
		 * @memberof CreateQueueOptions
		 */
		maxsize?: number;
	}

	export interface DeleteQueueOptions extends BaseOptions {}

	export interface GetQueueAttributesOptions extends BaseOptions {}

	export interface SetQueueAttributesOptions extends BaseOptions {
		/**
		 * The length of time, in seconds,
		 * that a message received from a queue will be invisible to other receiving components
		 * when they ask to receive messages.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof SetQueueAttributesOptions
		 */
		vt?: number;

		/**
		 * The time in seconds that the delivery of all new messages in the queue will be delayed.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof SetQueueAttributesOptions
		 */
		delay?: number;

		/**
		 * The maximum message size in bytes.
		 * Allowed values: 1024-65536 and -1 (for unlimited size)
		 * 
		 * @type {number}
		 * @memberof SetQueueAttributesOptions
		 */
		maxsize?: number;
	}


	export interface SendMessageOptions extends BaseOptions {
		/**
		 * Message for the queue
		 * 
		 * @type {string}
		 * @memberof SendMessageOptions
		 */
		message: string;

		/**
		 * *(Default: queue settings)*
		 * The time in seconds that the delivery of the message will be delayed.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof SendMessageOptions
		 */
		delay?: number;
	}

	export interface ReceiveMessageOptions extends BaseOptions {
		/**
		 * *(Default: queue settings)*
		 * The length of time, in seconds, that the received message will be invisible to others.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof ReceiveMessageOptions
		 */
		vt?: number;
	}

	export interface PopMessageOptions extends BaseOptions {}

	export interface DeleteMessageOptions extends BaseOptions {
		/**
		 * message id to delete.
		 * 
		 * @type {string}
		 * @memberof DeleteMessageOptions
		 */
		id: string;
	}

	export interface ChangeMessageVisibilityOptions extends BaseOptions {
		/**
		 * message id to modify.
		 * 
		 * @type {string}
		 * @memberof DeleteMessageOptions
		 */
		id: string;

		/**
		 * The length of time, in seconds, that this message will not be visible.
		 * Allowed values: 0-9999999 (around 115 days)
		 * 
		 * @type {number}
		 * @memberof ChangeMessageVisibilityOptions
		 */
		vt: number;
	}



	export interface QueueMessage {
		/**
		 * The message's contents.
		 * 
		 * @type {string}
		 * @memberof QueueMessage
		 */
		message: string;

		/**
		 * The internal message id.
		 * 
		 * @type {string}
		 * @memberof QueueMessage
		 */
		id: string;

		/**
		 * Timestamp of when this message was sent / created.
		 * 
		 * @type {number}
		 * @memberof QueueMessage
		 */
		sent: number;

		/**
		 * Timestamp of when this message was first received.
		 * 
		 * @type {number}
		 * @memberof QueueMessage
		 */
		fr: number;

		/**
		 * Number of times this message was received.
		 * 
		 * @type {number}
		 * @memberof QueueMessage
		 */
		rc: number;
	}

	export interface QueueAttributes {
		/**
		 * The visibility timeout for the queue in seconds
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		vt: number;

		/**
		 * The delay for new messages in seconds
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		delay: number;

		/**
		 * The maximum size of a message in bytes
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		maxsize: number;

		/**
		 * Total number of messages received from the queue
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		totalrecv: number;

		/**
		 * Total number of messages sent to the queue
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		totalsent: number;

		/**
		 * Timestamp (epoch in seconds) when the queue was created
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		created: number;

		/**
		 * Timestamp (epoch in seconds) when the queue was last modified with `setQueueAttributes`
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		modified: number;

		/**
		 * Current number of messages in the queue
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		msgs: number;

		/**
		 * Current number of hidden / not visible messages.
		 * A message can be hidden while "in flight" due to a `vt` parameter or when sent with a `delay`
		 * 
		 * @type {number}
		 * @memberof QueueAttributes
		 */
		hiddenmsgs: number;
	}
}