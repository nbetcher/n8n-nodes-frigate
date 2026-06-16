import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';

import WebSocket from 'ws';

import { eventOptions } from './FrigateDescription';
import type { IFrigateCredentials, IFrigateMessage } from './GenericFunctions';
import {
	buildAuthHeaders,
	buildWsUrl,
	parseInboundMessage,
	resolveTopicTemplate,
	topicMatches,
} from './GenericFunctions';

const RECONNECT_BASE_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const MANUAL_TIMEOUT_MS = 30000;

export class FrigateTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Frigate Trigger',
		name: 'frigateTrigger',
		icon: 'file:frigate.svg',
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts a workflow when Frigate publishes a matching /ws event',
		eventTriggerDescription: '',
		defaults: {
			name: 'Frigate Trigger',
		},
		inputs: [],
		outputs: ['main'],
		credentials: [
			{
				name: 'frigateApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: eventOptions,
				default: 'events',
				description: 'Which Frigate /ws topic to listen for',
			},
			{
				displayName: 'Custom Topic',
				name: 'customTopic',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'front_door/person or +/person or front_door/#',
				displayOptions: {
					show: {
						event: ['custom'],
					},
				},
				description:
					"Exact topic or wildcard pattern to subscribe to. Supports MQTT-style '+' (single level) and '#' (multi level). The 'frigate/' prefix is omitted.",
			},
			{
				displayName: 'Camera',
				name: 'camera',
				type: 'string',
				default: '',
				placeholder: 'front_door',
				displayOptions: {
					show: {
						event: [
							'<camera>/<object>',
							'<camera>/<object>/active',
							'<camera>/all',
							'<camera>/all/active',
							'<camera>/<object>/snapshot',
							'<camera>/audio/<audio_type>',
							'<camera>/audio/all',
							'<camera>/audio/dBFS',
							'<camera>/audio/rms',
							'<camera>/audio/transcription',
							'<camera>/enabled/state',
							'<camera>/detect/state',
							'<camera>/recordings/state',
							'<camera>/snapshots/state',
							'<camera>/audio/state',
							'<camera>/motion',
							'<camera>/motion/state',
							'<camera>/improve_contrast/state',
							'<camera>/motion_threshold/state',
							'<camera>/motion_contour_area/state',
							'<camera>/birdseye/state',
							'<camera>/birdseye_mode/state',
							'<camera>/ptz_autotracker/state',
							'<camera>/ptz_autotracker/active',
							'<camera>/review_alerts/state',
							'<camera>/review_detections/state',
							'<camera>/object_descriptions/state',
							'<camera>/review_descriptions/state',
							'<camera>/notifications/state',
							'<camera>/notifications/suspended',
							'<camera>/status/<role>',
							'<camera>/review_status',
							'<camera>/classification/<model_name>',
						],
					},
				},
				description:
					'Camera name to substitute into the topic. Leave blank to subscribe to all cameras (matched as a wildcard).',
			},
			{
				displayName: 'Object',
				name: 'object',
				type: 'string',
				default: '',
				placeholder: 'person',
				displayOptions: {
					show: {
						event: [
							'<camera>/<object>',
							'<camera>/<object>/active',
							'<camera>/<object>/snapshot',
							'<zone>/<object>',
							'<zone>/<object>/active',
						],
					},
				},
				description:
					'Object type (e.g. person, car) to substitute into the topic. Leave blank to match any object.',
			},
			{
				displayName: 'Zone',
				name: 'zone',
				type: 'string',
				default: '',
				placeholder: 'driveway',
				displayOptions: {
					show: {
						event: ['<zone>/<object>', '<zone>/<object>/active', '<zone>/all', '<zone>/all/active'],
					},
				},
				description:
					'Zone name to substitute into the topic. Leave blank to match any zone.',
			},
			{
				displayName: 'Audio Type',
				name: 'audioType',
				type: 'string',
				default: '',
				placeholder: 'speech',
				displayOptions: {
					show: {
						event: ['<camera>/audio/<audio_type>'],
					},
				},
				description:
					'Audio type (e.g. speech, bark, scream) to substitute into the topic. Leave blank to match any audio type.',
			},
			{
				displayName: 'Role',
				name: 'role',
				type: 'string',
				default: '',
				placeholder: 'detect',
				displayOptions: {
					show: {
						event: ['<camera>/status/<role>'],
					},
				},
				description:
					'Stream role (e.g. detect, record) to substitute into the topic. Leave blank to match any role.',
			},
			{
				displayName: 'Model Name',
				name: 'modelName',
				type: 'string',
				default: '',
				placeholder: 'my_classifier',
				displayOptions: {
					show: {
						event: ['<camera>/classification/<model_name>'],
					},
				},
				description:
					'Classification model name to substitute into the topic. Leave blank to match any model.',
			},
			{
				displayName:
					'This trigger keeps a persistent WebSocket open to Frigate. It reconnects automatically with backoff after a network drop or a Frigate restart. The "frigate/" prefix is omitted from all topics.',
				name: 'notice',
				type: 'notice',
				default: '',
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const credentials = (await this.getCredentials('frigateApi')) as unknown as IFrigateCredentials;
		const wsUrl = buildWsUrl(credentials);
		const subscriptionPattern = buildSubscriptionPattern(this);

		let ws: WebSocket | undefined;
		let manuallyClosed = false;
		let reconnectAttempts = 0;
		let reconnectTimer: NodeJS.Timeout | undefined;

		const emitMessage = (parsed: IFrigateMessage) => {
			const item: IDataObject = {
				topic: parsed.topic,
				payload: parsed.payload as IDataObject,
				raw: parsed.raw,
			};
			if (parsed.binary !== undefined) {
				item.binary = parsed.binary;
			}
			this.emit([this.helpers.returnJsonArray([item])]);
		};

		const connect = async () => {
			if (manuallyClosed) {
				return;
			}

			let headers: IDataObject;
			try {
				headers = await buildAuthHeaders(this, credentials);
			} catch (error) {
				this.logger.error(`Frigate Trigger auth failed: ${(error as Error).message}`);
				scheduleReconnect();
				return;
			}

			ws = new WebSocket(wsUrl, {
				headers: headers as Record<string, string>,
				handshakeTimeout: 10000,
			});

			ws.on('open', () => {
				reconnectAttempts = 0;
				this.logger.debug('Frigate Trigger WebSocket connected');
				// No subscribe frame is needed: /ws broadcasts all topics and we
				// filter client-side.
			});

			ws.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
				const parsed = parseInboundMessage(data, isBinary);
				if (parsed && topicMatches(subscriptionPattern, parsed.topic)) {
					emitMessage(parsed);
				}
			});

			ws.on('error', (err: Error) => {
				this.logger.error(`Frigate Trigger WebSocket error: ${err.message}`);
			});

			ws.on('close', () => {
				if (manuallyClosed) {
					return;
				}
				scheduleReconnect();
			});
		};

		const scheduleReconnect = () => {
			if (manuallyClosed) {
				return;
			}
			reconnectAttempts += 1;
			const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempts - 1), RECONNECT_MAX_MS);
			this.logger.debug(`Frigate Trigger reconnecting in ${delay}ms`);
			reconnectTimer = setTimeout(() => {
				void connect();
			}, delay);
		};

		// Only run continuously when actually activated as a trigger.
		if (this.getMode() === 'trigger') {
			await connect();
		}

		// Used by the n8n editor's "listen for test event" button: open a
		// short-lived socket, wait for the first matching message, emit it, close.
		const manualTriggerFunction = async () => {
			const headers = await buildAuthHeaders(this, credentials);
			await new Promise<void>((resolve, reject) => {
				const manualWs = new WebSocket(wsUrl, {
					headers: headers as Record<string, string>,
					handshakeTimeout: 10000,
				});

				const timer = setTimeout(() => {
					manualWs.close();
					reject(new Error('Timed out waiting for a matching Frigate event.'));
				}, MANUAL_TIMEOUT_MS);

				manualWs.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
					const parsed = parseInboundMessage(data, isBinary);
					if (parsed && topicMatches(subscriptionPattern, parsed.topic)) {
						clearTimeout(timer);
						emitMessage(parsed);
						manualWs.close();
						resolve();
					}
				});

				manualWs.on('error', (err: Error) => {
					clearTimeout(timer);
					reject(err);
				});
			});
		};

		const closeFunction = async () => {
			manuallyClosed = true;
			if (reconnectTimer) {
				clearTimeout(reconnectTimer);
			}
			if (ws) {
				ws.removeAllListeners();
				ws.close();
			}
		};

		return {
			closeFunction,
			manualTriggerFunction,
		};
	}
}

/**
 * Build the resolved subscription pattern from the selected event plus the
 * placeholder fields. Unfilled placeholders become MQTT '+' single-level
 * wildcards so the user can subscribe to all cameras/zones/objects at once.
 */
function buildSubscriptionPattern(context: ITriggerFunctions): string {
	const event = context.getNodeParameter('event', 0) as string;

	if (event === 'custom') {
		return context.getNodeParameter('customTopic', 0) as string;
	}

	const replacements: Record<string, string | undefined> = {
		camera: getOptional(context, 'camera'),
		object: getOptional(context, 'object'),
		zone: getOptional(context, 'zone'),
		audio_type: getOptional(context, 'audioType'),
		role: getOptional(context, 'role'),
		model_name: getOptional(context, 'modelName'),
	};

	// Substitute the values that were provided.
	let resolved = resolveTopicTemplate(event, replacements);

	// Any remaining placeholders become '+' single-level wildcards.
	resolved = resolved.replace(/<[^>]+>/g, '+');

	return resolved;
}

function getOptional(context: ITriggerFunctions, name: string): string | undefined {
	try {
		const value = context.getNodeParameter(name, 0, '' as unknown as object) as string;
		return value === '' ? undefined : value;
	} catch {
		return undefined;
	}
}
