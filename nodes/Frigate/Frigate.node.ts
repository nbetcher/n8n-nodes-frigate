import type {
	ICredentialsDecrypted,
	ICredentialTestFunctions,
	IDataObject,
	IExecuteFunctions,
	INodeCredentialTestResult,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import {
	birdseyeModeOptions,
	onOffOptions,
	ptzCommandOptions,
} from './FrigateDescription';
import type { IFrigateCredentials } from './GenericFunctions';
import {
	buildAuthHeaders,
	buildHttpBase,
	buildWsUrl,
	FrigateWsSession,
	normalizePayload,
	resolveTopicTemplate,
} from './GenericFunctions';

/**
 * Maps each toggle/setter operation to its /set topic template and the matching
 * /state read-back topic template (or null when there is no read-back).
 */
interface IOperationMeta {
	setTopic: string;
	stateTopic: string | null;
}

const OPERATION_META: Record<string, IOperationMeta> = {
	setDetect: { setTopic: '<camera>/detect/set', stateTopic: '<camera>/detect/state' },
	setRecordings: { setTopic: '<camera>/recordings/set', stateTopic: '<camera>/recordings/state' },
	setSnapshots: { setTopic: '<camera>/snapshots/set', stateTopic: '<camera>/snapshots/state' },
	setAudio: { setTopic: '<camera>/audio/set', stateTopic: '<camera>/audio/state' },
	setMotion: { setTopic: '<camera>/motion/set', stateTopic: '<camera>/motion/state' },
	setImproveContrast: {
		setTopic: '<camera>/improve_contrast/set',
		stateTopic: '<camera>/improve_contrast/state',
	},
	setEnabled: { setTopic: '<camera>/enabled/set', stateTopic: '<camera>/enabled/state' },
	setMotionThreshold: {
		setTopic: '<camera>/motion_threshold/set',
		stateTopic: '<camera>/motion_threshold/state',
	},
	setMotionContourArea: {
		setTopic: '<camera>/motion_contour_area/set',
		stateTopic: '<camera>/motion_contour_area/state',
	},
	setBirdseye: { setTopic: '<camera>/birdseye/set', stateTopic: '<camera>/birdseye/state' },
	setBirdseyeMode: {
		setTopic: '<camera>/birdseye_mode/set',
		stateTopic: '<camera>/birdseye_mode/state',
	},
	ptz: { setTopic: '<camera>/ptz', stateTopic: null },
	setPtzAutotracker: {
		setTopic: '<camera>/ptz_autotracker/set',
		stateTopic: '<camera>/ptz_autotracker/state',
	},
	setGlobalNotifications: { setTopic: 'notifications/set', stateTopic: 'notifications/state' },
	setCameraNotifications: {
		setTopic: '<camera>/notifications/set',
		stateTopic: '<camera>/notifications/state',
	},
	suspendNotifications: {
		// The /suspended read-back is a UNIX expiry timestamp, not the minutes
		// value that was sent, so it is not a meaningful confirmation of the set.
		// Treat suspend as fire-and-forget (no Await State Confirmation option).
		setTopic: '<camera>/notifications/suspend',
		stateTopic: null,
	},
	setAudioTranscription: {
		setTopic: '<camera>/audio_transcription/set',
		stateTopic: null,
	},
	setReviewAlerts: {
		setTopic: '<camera>/review_alerts/set',
		stateTopic: '<camera>/review_alerts/state',
	},
	setReviewDetections: {
		setTopic: '<camera>/review_detections/set',
		stateTopic: '<camera>/review_detections/state',
	},
	setObjectDescriptions: {
		setTopic: '<camera>/object_descriptions/set',
		stateTopic: '<camera>/object_descriptions/state',
	},
	setReviewDescriptions: {
		setTopic: '<camera>/review_descriptions/set',
		stateTopic: '<camera>/review_descriptions/state',
	},
	setMotionMask: {
		setTopic: '<camera>/motion_mask/<mask_name>/set',
		stateTopic: '<camera>/motion_mask/<mask_name>/state',
	},
	setObjectMask: {
		setTopic: '<camera>/object_mask/<mask_name>/set',
		stateTopic: '<camera>/object_mask/<mask_name>/state',
	},
	setZone: {
		setTopic: '<camera>/zone/<zone_name>/set',
		stateTopic: '<camera>/zone/<zone_name>/state',
	},
	restart: { setTopic: 'restart', stateTopic: null },
};

/** Operations that take a camera + ON/OFF value and expose a /state read-back. */
const ON_OFF_CAMERA_OPS = [
	'setDetect',
	'setRecordings',
	'setSnapshots',
	'setAudio',
	'setMotion',
	'setImproveContrast',
	'setEnabled',
	'setBirdseye',
	'setPtzAutotracker',
	'setCameraNotifications',
	'setAudioTranscription',
	'setReviewAlerts',
	'setReviewDetections',
	'setObjectDescriptions',
	'setReviewDescriptions',
];

const AWAITABLE_OPS = Object.entries(OPERATION_META)
	.filter(([, meta]) => meta.stateTopic !== null)
	.map(([op]) => op);

export class Frigate implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Frigate',
		name: 'frigate',
		icon: 'file:frigate.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Control Frigate over its real-time /ws API',
		defaults: {
			name: 'Frigate',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'frigateApi',
				required: true,
				testedBy: 'frigateApiTest',
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: [
					{
						name: 'Set Detect',
						value: 'setDetect',
						action: 'Set object detection on or off',
						description: 'Turn object detection ON/OFF for a camera',
					},
					{
						name: 'Set Recordings',
						value: 'setRecordings',
						action: 'Set recordings on or off',
						description: 'Turn recordings ON/OFF for a camera',
					},
					{
						name: 'Set Snapshots',
						value: 'setSnapshots',
						action: 'Set snapshots on or off',
						description: 'Turn snapshot capture ON/OFF for a camera',
					},
					{
						name: 'Set Audio Detection',
						value: 'setAudio',
						action: 'Set audio detection on or off',
						description: 'Turn audio detection ON/OFF for a camera',
					},
					{
						name: 'Set Motion Detection',
						value: 'setMotion',
						action: 'Set motion detection on or off',
						description: 'Turn motion detection ON/OFF for a camera',
					},
					{
						name: 'Set Improve Contrast',
						value: 'setImproveContrast',
						action: 'Set improve contrast on or off',
						description: 'Turn contrast improvement for motion ON/OFF for a camera',
					},
					{
						name: 'Set Camera Enabled',
						value: 'setEnabled',
						action: 'Set whole camera processing on or off',
						description: "Turn Frigate's whole-camera processing ON/OFF",
					},
					{
						name: 'Set Motion Threshold',
						value: 'setMotionThreshold',
						action: 'Set the motion sensitivity threshold',
						description: 'Set the motion sensitivity threshold',
					},
					{
						name: 'Set Motion Contour Area',
						value: 'setMotionContourArea',
						action: 'Set the motion contour area',
						description: 'Set the minimum contour size counted as motion',
					},
					{
						name: 'Set Birdseye (Camera)',
						value: 'setBirdseye',
						action: 'Set camera birdseye inclusion on or off',
						description: 'Include/exclude this camera in the birdseye view',
					},
					{
						name: 'Set Birdseye Mode',
						value: 'setBirdseyeMode',
						action: 'Set the camera birdseye mode',
						description: 'Set when the camera appears in birdseye',
					},
					{
						name: 'PTZ Command',
						value: 'ptz',
						action: 'Send a PTZ command',
						description: 'Send a PTZ command to an ONVIF-capable camera',
					},
					{
						name: 'Set PTZ Autotracker',
						value: 'setPtzAutotracker',
						action: 'Set PTZ autotracking on or off',
						description: 'Turn PTZ autotracking ON/OFF for a camera',
					},
					{
						name: 'Set Global Notifications',
						value: 'setGlobalNotifications',
						action: 'Set notifications on or off for all cameras',
						description: 'Enable/disable notifications for ALL cameras',
					},
					{
						name: 'Set Per-Camera Notifications',
						value: 'setCameraNotifications',
						action: 'Set per camera notifications on or off',
						description: 'Turn per-camera notifications ON/OFF',
					},
					{
						name: 'Suspend Per-Camera Notifications',
						value: 'suspendNotifications',
						action: 'Suspend a camera notifications for n minutes',
						description: "Suspend a camera's notifications for N minutes",
					},
					{
						name: 'Set Audio Transcription',
						value: 'setAudioTranscription',
						action: 'Set live audio transcription on or off',
						description: 'Turn live audio transcription ON/OFF for a camera (0.16+)',
					},
					{
						name: 'Set Review Alerts',
						value: 'setReviewAlerts',
						action: 'Set alert review items on or off',
						description: "Turn generation of 'alert' review items ON/OFF for a camera (0.16+)",
					},
					{
						name: 'Set Review Detections',
						value: 'setReviewDetections',
						action: 'Set detection review items on or off',
						description: "Turn generation of 'detection' review items ON/OFF for a camera (0.16+)",
					},
					{
						name: 'Set Object Descriptions',
						value: 'setObjectDescriptions',
						action: 'Set gen ai object descriptions on or off',
						description: 'Turn GenAI object descriptions ON/OFF for a camera (0.16+)',
					},
					{
						name: 'Set Review Descriptions',
						value: 'setReviewDescriptions',
						action: 'Set gen ai review descriptions on or off',
						description: 'Turn GenAI review summaries ON/OFF for a camera (0.16+)',
					},
					{
						name: 'Set Motion Mask',
						value: 'setMotionMask',
						action: 'Set a named motion mask on or off',
						description: 'Enable/disable a named motion mask on a camera',
					},
					{
						name: 'Set Object Mask',
						value: 'setObjectMask',
						action: 'Set a named object mask on or off',
						description: 'Enable/disable a named object mask on a camera',
					},
					{
						name: 'Set Zone',
						value: 'setZone',
						action: 'Set a named zone on or off',
						description: 'Enable/disable a named zone on a camera',
					},
					{
						name: 'Restart',
						value: 'restart',
						action: 'Restart frigate',
						description: 'Cause Frigate to exit so Docker restarts the container',
					},
					{
						name: 'Publish to Custom Topic',
						value: 'publishCustom',
						action: 'Publish to a custom topic',
						description: 'Publish an arbitrary { topic, payload } envelope over /ws',
					},
					{
						name: 'Wait for Next Topic Value',
						value: 'getCurrentValue',
						action: 'Wait for the next value of a topic',
						description:
							'Open the socket and return the NEXT broadcast of a topic. Frigate /ws does not replay current/retained state, so a /state value only arrives when it next changes — on a quiet system this can time out even though the state exists.',
					},
				],
				default: 'setDetect',
			},

			// --- Camera (used by most operations) ---
			{
				displayName: 'Camera',
				name: 'camera',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'front_door',
				displayOptions: {
					show: {
						operation: [
							'setDetect',
							'setRecordings',
							'setSnapshots',
							'setAudio',
							'setMotion',
							'setImproveContrast',
							'setEnabled',
							'setMotionThreshold',
							'setMotionContourArea',
							'setBirdseye',
							'setBirdseyeMode',
							'ptz',
							'setPtzAutotracker',
							'setCameraNotifications',
							'suspendNotifications',
							'setAudioTranscription',
							'setReviewAlerts',
							'setReviewDetections',
							'setObjectDescriptions',
							'setReviewDescriptions',
							'setMotionMask',
							'setObjectMask',
							'setZone',
						],
					},
				},
				description: 'The camera name as configured in Frigate',
			},

			// --- ON/OFF value (toggle operations) ---
			{
				displayName: 'Value',
				name: 'value',
				type: 'options',
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: onOffOptions,
				default: 'ON',
				required: true,
				displayOptions: {
					show: {
						operation: [
							'setDetect',
							'setRecordings',
							'setSnapshots',
							'setAudio',
							'setMotion',
							'setImproveContrast',
							'setEnabled',
							'setBirdseye',
							'setPtzAutotracker',
							'setGlobalNotifications',
							'setCameraNotifications',
							'setAudioTranscription',
							'setReviewAlerts',
							'setReviewDetections',
							'setObjectDescriptions',
							'setReviewDescriptions',
							'setMotionMask',
							'setObjectMask',
							'setZone',
						],
					},
				},
				description: 'Whether to turn the feature on or off',
			},

			// --- Motion threshold (0..255) ---
			{
				displayName: 'Threshold',
				name: 'motionThreshold',
				type: 'number',
				default: 30,
				required: true,
				typeOptions: {
					minValue: 0,
					maxValue: 255,
				},
				displayOptions: {
					show: {
						operation: ['setMotionThreshold'],
					},
				},
				description: 'Motion sensitivity threshold (integer 0-255; Frigate default is 30)',
			},

			// --- Motion contour area (0..10000) ---
			{
				displayName: 'Contour Area',
				name: 'motionContourArea',
				type: 'number',
				default: 10,
				required: true,
				typeOptions: {
					minValue: 0,
					maxValue: 10000,
				},
				displayOptions: {
					show: {
						operation: ['setMotionContourArea'],
					},
				},
				description: 'Minimum contour size counted as motion (integer 0-10000; Frigate default is 10)',
			},

			// --- Minutes (suspend notifications) ---
			{
				displayName: 'Minutes',
				name: 'minutes',
				type: 'number',
				default: 30,
				required: true,
				typeOptions: {
					minValue: 0,
					maxValue: 10080,
				},
				displayOptions: {
					show: {
						operation: ['suspendNotifications'],
					},
				},
				description: 'Number of minutes to suspend notifications for (0-10080)',
			},

			// --- Birdseye mode ---
			{
				displayName: 'Mode',
				name: 'birdseyeMode',
				type: 'options',
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: birdseyeModeOptions,
				default: 'CONTINUOUS',
				required: true,
				displayOptions: {
					show: {
						operation: ['setBirdseyeMode'],
					},
				},
				description: 'When the camera should appear in birdseye',
			},

			// --- PTZ command ---
			{
				displayName: 'Command',
				name: 'ptzCommand',
				type: 'options',
				// eslint-disable-next-line n8n-nodes-base/node-param-options-type-unsorted-items
				options: ptzCommandOptions,
				default: 'MOVE_LEFT',
				required: true,
				displayOptions: {
					show: {
						operation: ['ptz'],
					},
				},
				description: 'The PTZ command to send',
			},
			{
				displayName: 'Preset / Relative Value',
				name: 'ptzCustomValue',
				type: 'string',
				default: '',
				placeholder: 'preset_door or MOVE_RELATIVE_0.1_-0.2',
				displayOptions: {
					show: {
						operation: ['ptz'],
						ptzCommand: ['preset', 'relative'],
					},
				},
				description: 'The exact payload to send, e.g. \'preset_door\', \'preset_1\', or \'MOVE_RELATIVE_&lt;pan&gt;_&lt;tilt&gt;\' / \'MOVE_RELATIVE_&lt;pan&gt;_&lt;tilt&gt;_&lt;zoom&gt;\'',
			},

			// --- Mask name ---
			{
				displayName: 'Mask Name',
				name: 'maskName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'driveway_mask',
				displayOptions: {
					show: {
						operation: ['setMotionMask', 'setObjectMask'],
					},
				},
				description: 'The configured mask name',
			},

			// --- Zone name ---
			{
				displayName: 'Zone Name',
				name: 'zoneName',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'front_yard',
				displayOptions: {
					show: {
						operation: ['setZone'],
					},
				},
				description: 'The configured zone name',
			},

			// --- Restart payload (optional) ---
			{
				displayName: 'Payload',
				name: 'restartPayload',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['restart'],
					},
				},
				description: 'Optional payload sent with the restart command (any value)',
			},

			// --- Publish to custom topic ---
			{
				displayName: 'Topic',
				name: 'customTopic',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'front_door/detect/state',
				displayOptions: {
					show: {
						operation: ['publishCustom', 'getCurrentValue'],
					},
				},
				description:
					"The bare topic (without the 'frigate/' prefix). For Get Current Value, use a topic Frigate actually broadcasts (a /state topic or an event topic such as 'events') — Frigate does not echo /set command topics, so subscribing to a /set topic will always time out.",
			},
			{
				displayName: 'Payload',
				name: 'customPayload',
				type: 'string',
				default: '',
				displayOptions: {
					show: {
						operation: ['publishCustom'],
					},
				},
				description:
					'The payload to publish. JSON strings are sent as-is; scalar strings/numbers are sent bare.',
			},

			// --- Get current value timeout ---
			{
				displayName: 'Timeout (Ms)',
				name: 'timeoutMs',
				type: 'number',
				default: 5000,
				typeOptions: {
					minValue: 0,
					maxValue: 600000,
				},
				displayOptions: {
					show: {
						operation: ['getCurrentValue'],
					},
				},
				description:
					'How long to wait for the next matching broadcast before returning empty (0-600000 ms). Note: /ws does not replay current state — the value only arrives when Frigate next publishes the topic.',
			},

			// --- Await state confirmation (shared) ---
			{
				displayName: 'Await State Confirmation',
				name: 'awaitState',
				type: 'boolean',
				default: false,
				displayOptions: {
					show: {
						operation: AWAITABLE_OPS,
					},
				},
				description:
					'Whether to keep the socket open after publishing and wait for the matching /state read-back to confirm the new value',
			},
			{
				displayName: 'Confirmation Timeout (Ms)',
				name: 'awaitTimeoutMs',
				type: 'number',
				default: 5000,
				typeOptions: {
					minValue: 0,
					maxValue: 600000,
				},
				displayOptions: {
					show: {
						operation: AWAITABLE_OPS,
						awaitState: [true],
					},
				},
				description: 'How long to wait for the /state read-back before giving up (0-600000 ms)',
			},
		],
	};

	// Programmatic credential test: actually exercises the configured auth path
	// (a real /api/login for the password method, an authenticated /api/config
	// for the token method) instead of an auth-agnostic /api/version probe, so a
	// wrong password / bad token fails the test instead of showing a false green.
	methods = {
		credentialTest: {
			async frigateApiTest(
				this: ICredentialTestFunctions,
				credential: ICredentialsDecrypted,
			): Promise<INodeCredentialTestResult> {
				const c = (credential.data ?? {}) as unknown as IFrigateCredentials;
				const base = buildHttpBase(c);
				try {
					if (c.authEnabled) {
						if (c.authMethod === 'token') {
							if (!c.token) {
								return {
									status: 'Error',
									message: 'Auth is enabled (Bearer/JWT) but no token was provided.',
								};
							}
							await this.helpers.request({
								method: 'GET',
								uri: `${base}/api/config`,
								headers: { Authorization: `Bearer ${c.token}` },
								json: true,
							});
						} else {
							if (!c.username || !c.password) {
								return {
									status: 'Error',
									message: 'Auth is enabled (username/password) but a field is empty.',
								};
							}
							await this.helpers.request({
								method: 'POST',
								uri: `${base}/api/login`,
								body: { user: c.username, password: c.password },
								json: true,
							});
						}
					} else {
						await this.helpers.request({ method: 'GET', uri: `${base}/api/version` });
					}
					return { status: 'OK', message: 'Connection successful' };
				} catch (error) {
					return {
						status: 'Error',
						message: `Frigate connection failed: ${(error as Error).message}`,
					};
				}
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		const credentials = (await this.getCredentials('frigateApi')) as unknown as IFrigateCredentials;
		const wsUrl = buildWsUrl(credentials);

		// Resolve auth ONCE for the whole batch. A failure here is a credential
		// problem (not per-item), so capture it and short-circuit every item rather
		// than re-hitting /api/login for each one (which would hammer Frigate).
		let headers: IDataObject = {};
		let authError: Error | undefined;
		try {
			headers = await buildAuthHeaders(this, credentials);
		} catch (error) {
			authError = error as Error;
		}

		// One multiplexed /ws socket for the whole execution, closed once at the end
		// (avoids a new connection + teardown per item, and the publish/close race).
		const session = new FrigateWsSession(wsUrl, headers);

		try {
			for (let i = 0; i < items.length; i++) {
				try {
					if (authError) {
						throw authError;
					}
					const operation = this.getNodeParameter('operation', i) as string;
					const item: INodeExecutionData = { json: {}, pairedItem: { item: i } };

					if (operation === 'getCurrentValue') {
						const topic = this.getNodeParameter('customTopic', i) as string;
						if (!topic) {
							throw new NodeOperationError(this.getNode(), 'Topic is required.', { itemIndex: i });
						}
						const timeoutMs = clampTimeoutMs(this.getNodeParameter('timeoutMs', i, 5000) as number);
						const message = await session.subscribeOnce(topic, timeoutMs);
						item.json = {
							operation,
							topic,
							received: message !== undefined,
							payload: message ? (message.payload as IDataObject) : null,
							matchedTopic: message ? message.topic : null,
							raw: message ? message.raw : null,
						};
						if (message?.binary !== undefined) {
							item.binary = {
								data: await this.helpers.prepareBinaryData(
									Buffer.from(message.binary, 'base64'),
									'snapshot.jpg',
									'image/jpeg',
								),
							};
						}
					} else if (operation === 'publishCustom') {
						const topic = this.getNodeParameter('customTopic', i) as string;
						if (!topic) {
							throw new NodeOperationError(this.getNode(), 'Topic is required.', { itemIndex: i });
						}
						const rawPayload = this.getNodeParameter('customPayload', i, '') as string;
						const payload = coercePayload(rawPayload);
						await session.publish(topic, payload);
						item.json = { operation, topic, payload: payload as IDataObject, published: true };
					} else {
						item.json = await runPublishOperation.call(this, session, operation, i);
					}

					returnData.push(item);
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({
							json: { error: (error as Error).message },
							pairedItem: { item: i },
						});
						continue;
					}
					throw error;
				}
			}
		} finally {
			await session.close();
		}

		return [returnData];
	}
}

/**
 * Resolve the topic + payload for a publish operation, send it, optionally await
 * the /state read-back, and return the result JSON.
 */
async function runPublishOperation(
	this: IExecuteFunctions,
	session: FrigateWsSession,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const meta = OPERATION_META[operation];
	if (!meta) {
		throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`, { itemIndex: i });
	}

	const replacements: Record<string, string | undefined> = {};

	// Camera placeholder.
	if (meta.setTopic.includes('<camera>')) {
		const camera = this.getNodeParameter('camera', i) as string;
		if (!camera) {
			throw new NodeOperationError(this.getNode(), 'Camera is required for this operation.', {
				itemIndex: i,
			});
		}
		replacements.camera = camera;
	}

	// Mask / zone name placeholders.
	if (meta.setTopic.includes('<mask_name>')) {
		const maskName = this.getNodeParameter('maskName', i) as string;
		if (!maskName) {
			throw new NodeOperationError(this.getNode(), 'Mask Name is required for this operation.', {
				itemIndex: i,
			});
		}
		replacements.mask_name = maskName;
	}
	if (meta.setTopic.includes('<zone_name>')) {
		const zoneName = this.getNodeParameter('zoneName', i) as string;
		if (!zoneName) {
			throw new NodeOperationError(this.getNode(), 'Zone Name is required for this operation.', {
				itemIndex: i,
			});
		}
		replacements.zone_name = zoneName;
	}

	const topic = resolveTopicTemplate(meta.setTopic, replacements);
	const payload = resolvePayload.call(this, operation, i);

	// Restart and PTZ are always fire-and-forget (no read-back).
	const canAwait = meta.stateTopic !== null;
	const awaitState = canAwait ? (this.getNodeParameter('awaitState', i, false) as boolean) : false;

	if (awaitState && meta.stateTopic) {
		const awaitTimeoutMs = clampTimeoutMs(this.getNodeParameter('awaitTimeoutMs', i, 5000) as number);
		const stateTopic = resolveTopicTemplate(meta.stateTopic, replacements);
		const message = await session.publishAndAwait(topic, payload, stateTopic, awaitTimeoutMs);
		const received = message !== undefined;
		return {
			operation,
			topic,
			payload,
			published: true,
			// `received` = a /state frame arrived; `confirmed` = that frame's value
			// actually matches what we asked for. They differ when Frigate emits a
			// concurrent/old value or drops a no-op set.
			received,
			confirmed: received && valuesMatch(payload, message?.payload),
			stateTopic,
			stateValue: message ? (message.payload as IDataObject) : null,
		};
	}

	await session.publish(topic, payload);
	return { operation, topic, payload, published: true };
}

/**
 * Resolve the payload value for a publish operation based on its parameters.
 */
function resolvePayload(this: IExecuteFunctions, operation: string, i: number): string {
	if (ON_OFF_CAMERA_OPS.includes(operation) || operation === 'setGlobalNotifications') {
		return this.getNodeParameter('value', i) as string;
	}

	switch (operation) {
		case 'setMotionThreshold': {
			const v = this.getNodeParameter('motionThreshold', i) as number;
			if (!Number.isInteger(v) || v < 0 || v > 255) {
				throw new NodeOperationError(
					this.getNode(),
					'Motion threshold must be an integer between 0 and 255.',
					{ itemIndex: i },
				);
			}
			return String(v);
		}
		case 'setMotionContourArea': {
			const v = this.getNodeParameter('motionContourArea', i) as number;
			if (!Number.isInteger(v) || v < 0 || v > 10000) {
				throw new NodeOperationError(
					this.getNode(),
					'Motion contour area must be an integer between 0 and 10000.',
					{ itemIndex: i },
				);
			}
			return String(v);
		}
		case 'suspendNotifications': {
			const v = this.getNodeParameter('minutes', i) as number;
			if (!Number.isInteger(v) || v < 0 || v > 10080) {
				throw new NodeOperationError(
					this.getNode(),
					'Minutes must be an integer between 0 and 10080.',
					{ itemIndex: i },
				);
			}
			return String(v);
		}
		case 'setBirdseyeMode':
			return this.getNodeParameter('birdseyeMode', i) as string;
		case 'ptz': {
			const command = this.getNodeParameter('ptzCommand', i) as string;
			if (command === 'preset' || command === 'relative') {
				const custom = this.getNodeParameter('ptzCustomValue', i, '') as string;
				if (!custom) {
					throw new NodeOperationError(
						this.getNode(),
						'A preset/relative PTZ value is required for this command.',
						{ itemIndex: i },
					);
				}
				return custom;
			}
			return command;
		}
		case 'restart':
			return this.getNodeParameter('restartPayload', i, '') as string;
		default:
			// Mask/zone toggles also use the ON/OFF value field.
			return this.getNodeParameter('value', i) as string;
	}
}

/**
 * Coerce a free-text custom payload: JSON objects/arrays/numbers are sent
 * parsed; everything else is sent as a bare string.
 */
function coercePayload(rawPayload: string): unknown {
	if (rawPayload === '') {
		return '';
	}
	return normalizePayload(rawPayload);
}

/**
 * Clamp a user-supplied timeout (which may be negative, fractional, NaN, or huge
 * via an expression) into a sane [0, 600000] ms range so it cannot hold a socket
 * or worker open indefinitely.
 */
function clampTimeoutMs(value: number): number {
	if (!Number.isFinite(value)) {
		return 5000;
	}
	return Math.min(Math.max(value, 0), 600000);
}

/**
 * Compare the value we asked Frigate to set against the value echoed back on the
 * /state topic, tolerating string/number representation differences (e.g. 'ON'
 * vs 'on', '30' vs 30). Used so "confirmed" means the value actually took effect,
 * not merely that some /state frame arrived.
 */
function valuesMatch(expected: string, actual: unknown): boolean {
	if (actual === undefined || actual === null) {
		return false;
	}
	const e = String(expected).trim();
	const a = String(actual).trim();
	if (e.toLowerCase() === a.toLowerCase()) {
		return true;
	}
	const en = Number(e);
	const an = Number(a);
	return !Number.isNaN(en) && !Number.isNaN(an) && en === an;
}
