import type { INodePropertyOptions } from 'n8n-workflow';

/**
 * The catalog of subscribable events the trigger node can listen for. The
 * `value` of each entry is the topic template used over /ws (without the
 * `frigate/` prefix). Placeholder segments are substituted from the free-text
 * fields on the trigger node. Display names are kept human-friendly and the
 * exact topic is shown in each description.
 */
export const eventOptions: INodePropertyOptions[] = [
	// --- Global feeds ---
	{
		name: 'Tracked Object Event',
		value: 'events',
		description:
			"Topic 'events'. Tracked-object lifecycle change-feed; fires on 'new', 'update', and 'end'.",
	},
	{
		name: 'Review Item',
		value: 'reviews',
		description:
			"Topic 'reviews' (0.14+). Fires when a review item is created/updated/ended; severity escalates detection to alert.",
	},
	{
		name: 'Tracked Object Update',
		value: 'tracked_object_update',
		description:
			"Topic 'tracked_object_update'. GenAI/recognition results (description, face, lpr, classification).",
	},
	{
		name: 'Semantic Search Trigger',
		value: 'triggers',
		description: "Topic 'triggers' (0.16+). A semantic-search trigger fires.",
	},
	{
		name: 'Stats',
		value: 'stats',
		description:
			"Topic 'stats'. Server statistics, identical to GET /api/stats, on a configurable interval.",
	},
	{
		name: 'Camera Activity',
		value: 'camera_activity',
		description:
			"Topic 'camera_activity'. Per-camera feature and detection status, emitted on connect and on activity changes.",
	},
	{
		name: 'Availability',
		value: 'available',
		description: "Topic 'available'. Frigate online/offline availability.",
	},
	{
		name: 'Global Notifications State',
		value: 'notifications/state',
		description: "Topic 'notifications/state'. Global notifications toggle read-back (ON/OFF).",
	},

	// --- Per-camera object counts ---
	{
		name: 'Object Count - Camera',
		value: '<camera>/<object>',
		description:
			"Topic 'camera/object'. Count of a given object type on a camera changes.",
	},
	{
		name: 'Active Object Count - Camera',
		value: '<camera>/<object>/active',
		description:
			"Topic 'camera/object/active'. Count of active (non-stationary) objects of a type on a camera changes.",
	},
	{
		name: 'All Object Count - Camera',
		value: '<camera>/all',
		description: "Topic 'camera/all'. Total object count on a camera changes.",
	},
	{
		name: 'All Active Object Count - Camera',
		value: '<camera>/all/active',
		description: "Topic 'camera/all/active'. Total active object count on a camera changes.",
	},

	// --- Per-zone object counts ---
	{
		name: 'Object Count - Zone',
		value: '<zone>/<object>',
		description: "Topic 'zone/object'. Count of a given object type in a zone changes.",
	},
	{
		name: 'Active Object Count - Zone',
		value: '<zone>/<object>/active',
		description:
			"Topic 'zone/object/active'. Count of active objects of a type in a zone changes.",
	},
	{
		name: 'All Object Count - Zone',
		value: '<zone>/all',
		description: "Topic 'zone/all'. Total object count in a zone changes.",
	},
	{
		name: 'All Active Object Count - Zone',
		value: '<zone>/all/active',
		description: "Topic 'zone/all/active'. Total active object count in a zone changes.",
	},

	// NOTE: the per-object snapshot topic (frigate/<camera>/<object>/snapshot) is
	// intentionally NOT offered here. Frigate publishes its JPEG bytes only over
	// MQTT — its /ws communicator JSON-serializes every envelope and silently drops
	// non-text (binary) payloads, so the snapshot is unreachable over /ws on every
	// Frigate version. Use MQTT, or the HTTP API (/api/events/<id>/snapshot.jpg),
	// to retrieve snapshot images.

	// --- Audio ---
	{
		name: 'Audio Type Detected',
		value: '<camera>/audio/<audio_type>',
		description:
			"Topic 'camera/audio/audio_type'. A specific audio type detected or cleared (ON/OFF).",
	},
	{
		name: 'Any Audio Detected',
		value: '<camera>/audio/all',
		description: "Topic 'camera/audio/all'. Any monitored audio type detected or cleared (ON/OFF).",
	},
	{
		name: 'Audio Level dBFS',
		value: '<camera>/audio/dBFS',
		description: "Topic 'camera/audio/dBFS'. Audio level metric published.",
	},
	{
		name: 'Audio Level RMS',
		value: '<camera>/audio/rms',
		description: "Topic 'camera/audio/rms'. Audio RMS metric published.",
	},
	{
		name: 'Audio Transcription',
		value: '<camera>/audio/transcription',
		description: "Topic 'camera/audio/transcription' (0.16+). Live audio transcription text.",
	},

	// --- Per-camera feature state read-backs ---
	{
		name: 'Camera Enabled State',
		value: '<camera>/enabled/state',
		description: "Topic 'camera/enabled/state'. Whole-camera processing toggled read-back (ON/OFF).",
	},
	{
		name: 'Detect State',
		value: '<camera>/detect/state',
		description: "Topic 'camera/detect/state'. Object detection toggled read-back (ON/OFF).",
	},
	{
		name: 'Recordings State',
		value: '<camera>/recordings/state',
		description: "Topic 'camera/recordings/state'. Recordings toggled read-back (ON/OFF).",
	},
	{
		name: 'Snapshots State',
		value: '<camera>/snapshots/state',
		description: "Topic 'camera/snapshots/state'. Snapshots toggled read-back (ON/OFF).",
	},
	{
		name: 'Audio Detection State',
		value: '<camera>/audio/state',
		description: "Topic 'camera/audio/state'. Audio detection toggled read-back (ON/OFF).",
	},
	{
		name: 'Motion Detected',
		value: '<camera>/motion',
		description:
			"Topic 'camera/motion'. Motion detected or cleared (ON/OFF); OFF after the motion off-delay.",
	},
	{
		name: 'Motion Detection State',
		value: '<camera>/motion/state',
		description: "Topic 'camera/motion/state'. Motion detection enabled/disabled read-back (ON/OFF).",
	},
	{
		name: 'Improve Contrast State',
		value: '<camera>/improve_contrast/state',
		description:
			"Topic 'camera/improve_contrast/state'. Contrast improvement toggled read-back (ON/OFF).",
	},
	{
		name: 'Motion Threshold State',
		value: '<camera>/motion_threshold/state',
		description: "Topic 'camera/motion_threshold/state'. Motion threshold changed read-back (integer).",
	},
	{
		name: 'Motion Contour Area State',
		value: '<camera>/motion_contour_area/state',
		description:
			"Topic 'camera/motion_contour_area/state'. Motion contour area changed read-back (integer).",
	},
	{
		name: 'Birdseye State',
		value: '<camera>/birdseye/state',
		description:
			"Topic 'camera/birdseye/state'. Camera's birdseye inclusion toggled read-back (ON/OFF).",
	},
	{
		name: 'Birdseye Mode State',
		value: '<camera>/birdseye_mode/state',
		description:
			"Topic 'camera/birdseye_mode/state'. Birdseye mode changed read-back (CONTINUOUS/MOTION/OBJECTS).",
	},
	{
		name: 'PTZ Autotracker State',
		value: '<camera>/ptz_autotracker/state',
		description:
			"Topic 'camera/ptz_autotracker/state'. PTZ autotracker enabled/disabled read-back (ON/OFF).",
	},
	{
		name: 'PTZ Autotracker Active',
		value: '<camera>/ptz_autotracker/active',
		description:
			"Topic 'camera/ptz_autotracker/active'. Autotracker is actively tracking right now (ON/OFF).",
	},
	{
		name: 'Review Alerts State',
		value: '<camera>/review_alerts/state',
		description: "Topic 'camera/review_alerts/state'. Alert-level review toggled read-back (ON/OFF).",
	},
	{
		name: 'Review Detections State',
		value: '<camera>/review_detections/state',
		description:
			"Topic 'camera/review_detections/state'. Detection-level review toggled read-back (ON/OFF).",
	},
	{
		name: 'Object Descriptions State',
		value: '<camera>/object_descriptions/state',
		description:
			"Topic 'camera/object_descriptions/state'. GenAI object descriptions toggled read-back (ON/OFF).",
	},
	{
		name: 'Review Descriptions State',
		value: '<camera>/review_descriptions/state',
		description:
			"Topic 'camera/review_descriptions/state'. GenAI review descriptions toggled read-back (ON/OFF).",
	},
	{
		name: 'Per-Camera Notifications State',
		value: '<camera>/notifications/state',
		description:
			"Topic 'camera/notifications/state'. Per-camera notifications toggled read-back (ON/OFF).",
	},
	{
		name: 'Per-Camera Notifications Suspended',
		value: '<camera>/notifications/suspended',
		description:
			"Topic 'camera/notifications/suspended'. Suspension updated (UNIX timestamp or 0).",
	},

	// --- Other per-camera ---
	{
		name: 'Camera/Role Status',
		value: '<camera>/status/<role>',
		description:
			"Topic 'camera/status/role'. Stream/role state change (online/offline/disabled).",
	},
	{
		name: 'Review Status',
		value: '<camera>/review_status',
		description:
			"Topic 'camera/review_status'. Current review status of the camera (NONE/DETECTION/ALERT).",
	},
	{
		name: 'Classification Model Result',
		value: '<camera>/classification/<model_name>',
		description:
			"Topic 'camera/classification/model_name' (0.16+). Custom state-classification model result changed.",
	},

	// --- Catch-all ---
	{
		name: 'Subscribe to Custom Topic',
		value: 'custom',
		description: 'Subscribe to any /ws topic by an exact string or wildcard pattern (\'+\' and \'#\' supported)',
	},
];

/**
 * ON / OFF options reused by every toggle action.
 */
export const onOffOptions: INodePropertyOptions[] = [
	{ name: 'ON', value: 'ON' },
	{ name: 'OFF', value: 'OFF' },
];

/**
 * PTZ command options for the PTZ action.
 */
export const ptzCommandOptions: INodePropertyOptions[] = [
	{ name: 'Move Up', value: 'MOVE_UP' },
	{ name: 'Move Down', value: 'MOVE_DOWN' },
	{ name: 'Move Left', value: 'MOVE_LEFT' },
	{ name: 'Move Right', value: 'MOVE_RIGHT' },
	{ name: 'Zoom In', value: 'ZOOM_IN' },
	{ name: 'Zoom Out', value: 'ZOOM_OUT' },
	{ name: 'Stop', value: 'STOP' },
	{ name: 'Focus In', value: 'FOCUS_IN' },
	{ name: 'Focus Out', value: 'FOCUS_OUT' },
	{ name: 'Init', value: 'INIT' },
	{ name: 'Preset (Use Custom Value)', value: 'preset' },
	{ name: 'Relative Move (Use Custom Value)', value: 'relative' },
];

/**
 * Birdseye mode options.
 */
export const birdseyeModeOptions: INodePropertyOptions[] = [
	{ name: 'Continuous', value: 'CONTINUOUS' },
	{ name: 'Motion', value: 'MOTION' },
	{ name: 'Objects', value: 'OBJECTS' },
];
