# Frigate (action) — full operation catalog

Node `type`: `frigate`. Pick the action with the **`operation`** parameter; each maps to a fixed topic template (the `frigate/` prefix is always omitted on `/ws`). The node opens **one multiplexed `/ws` socket per execution**, reuses it across every input item (publishing once per item, optionally awaiting the `/state` read-back), and closes it once at the end.

**Common parameters (shown conditionally by operation):**
- `camera` (string, required for per-camera ops) — a real configured camera name.
- `value` (options `ON`/`OFF`) — for toggle ops.
- `motionThreshold` (number, integer 0–255) — for `setMotionThreshold`.
- `motionContourArea` (number, integer 0–10000) — for `setMotionContourArea`.
- `minutes` (number, integer 0–10080) — for suspend notifications.
- `birdseyeMode` (options `CONTINUOUS`/`MOTION`/`OBJECTS`).
- `ptzCommand` (options, see PTZ below) + `ptzCustomValue` (string, only for `preset`/`relative`).
- `maskName` / `zoneName` (string) — for mask / zone ops.
- `restartPayload` (string, optional) — for restart.
- `customTopic` + `customPayload` — for `publishCustom`; `customTopic` + `timeoutMs` (0–600000 ms) for `getCurrentValue`.
- `awaitState` (boolean) + `awaitTimeoutMs` (number, 0–600000 ms) — shown on every op that has a `/state` read-back. When on, the node waits for the read-back and returns `received`/`confirmed`/`stateValue`.

**Result JSON:** `{ operation, topic, payload, published:true }`, plus `received`, `confirmed`, `stateTopic`, `stateValue` when `awaitState` is on. `received` is `true` when a `/state` frame arrived; `confirmed` is `true` only when that frame's value actually **matches** the requested value (compared with string/number tolerance). `getCurrentValue` returns `{ operation, topic, received, payload, matchedTopic, raw }`.

## Camera ON/OFF toggles (each has a `/state` read-back)

| `operation` value | Topic | Params | Notes |
|---|---|---|---|
| `setDetect` | `<camera>/detect/set` | camera, value | Enabling detect also enables motion. Read-back `<camera>/detect/state`. |
| `setRecordings` | `<camera>/recordings/set` | camera, value | Requires recordings enabled in config. |
| `setSnapshots` | `<camera>/snapshots/set` | camera, value | |
| `setAudio` | `<camera>/audio/set` | camera, value | Requires audio enabled in config. |
| `setMotion` | `<camera>/motion/set` | camera, value | Cannot disable while detect is enabled. |
| `setImproveContrast` | `<camera>/improve_contrast/set` | camera, value | Contrast improvement for motion. |
| `setEnabled` | `<camera>/enabled/set` | camera, value | Whole-camera processing. Requires `enabled` present in config. |
| `setBirdseye` | `<camera>/birdseye/set` | camera, value | Per-camera birdseye inclusion (no global topic). |
| `setPtzAutotracker` | `<camera>/ptz_autotracker/set` | camera, value | Requires ptz_autotracker enabled. |
| `setCameraNotifications` | `<camera>/notifications/set` | camera, value | Requires notifications enabled. |
| `setAudioTranscription` | `<camera>/audio_transcription/set` | camera, value | 0.16+. **No** `/state` read-back. |
| `setReviewAlerts` | `<camera>/review_alerts/set` | camera, value | 0.16+. Generation of `alert` review items. |
| `setReviewDetections` | `<camera>/review_detections/set` | camera, value | 0.16+. Generation of `detection` review items. |
| `setObjectDescriptions` | `<camera>/object_descriptions/set` | camera, value | 0.16+. GenAI object descriptions. |
| `setReviewDescriptions` | `<camera>/review_descriptions/set` | camera, value | 0.16+. GenAI review summaries. |

## Numeric / mode / minutes

| `operation` value | Topic | Params | Notes |
|---|---|---|---|
| `setMotionThreshold` | `<camera>/motion_threshold/set` | camera, motionThreshold (int 0–255) | Pixel-change sensitivity (default 30). Read-back `<camera>/motion_threshold/state`. |
| `setMotionContourArea` | `<camera>/motion_contour_area/set` | camera, motionContourArea (int 0–10000) | Minimum contour size counted as motion (default 10). |
| `setBirdseyeMode` | `<camera>/birdseye_mode/set` | camera, birdseyeMode | CONTINUOUS / MOTION (last 30s) / OBJECTS (last 30s). ~30s to apply. |
| `suspendNotifications` | `<camera>/notifications/suspend` | camera, minutes (int 0–10080) | Read-back `<camera>/notifications/suspended` (timestamp). |

## Named mask / zone toggles (ON/OFF)

| `operation` value | Topic | Params | Notes |
|---|---|---|---|
| `setMotionMask` | `<camera>/motion_mask/<mask_name>/set` | camera, maskName, value | Read-back `<camera>/motion_mask/<mask_name>/state`. |
| `setObjectMask` | `<camera>/object_mask/<mask_name>/set` | camera, maskName, value | |
| `setZone` | `<camera>/zone/<zone_name>/set` | camera, zoneName, value | Enable/disable a named zone *on a camera*. |

## Global / no read-back / generic

| `operation` value | Topic | Params | Notes |
|---|---|---|---|
| `setGlobalNotifications` | `notifications/set` | value | All cameras. Read-back `notifications/state`. |
| `ptz` | `<camera>/ptz` | camera, ptzCommand (+ptzCustomValue) | **Fire-and-forget, no read-back.** Requires `onvif` configured. See PTZ commands below. |
| `restart` | `restart` | restartPayload (optional) | **No read-back.** Frigate exits so Docker restarts the container. |
| `publishCustom` | `customTopic` (free text) | customTopic, customPayload | Sends arbitrary `{topic, payload}`. JSON-looking payloads parsed/sent structured; scalars sent bare. Use for any topic not enumerated. |
| `getCurrentValue` (UI name **Wait for Next Topic Value**) | `customTopic` (free text) | customTopic, timeoutMs (default 5000, range 0–600000) | Opens `/ws` and returns the **next** broadcast of the topic, then closes. Frigate `/ws` does **not** replay current/retained state, so a `/state` value only arrives when it next changes — a quiet topic times out even though the state exists. |

## PTZ commands (`ptzCommand` options for the `ptz` operation)

Fixed: `MOVE_UP`, `MOVE_DOWN`, `MOVE_LEFT`, `MOVE_RIGHT`, `ZOOM_IN`, `ZOOM_OUT`, `STOP`, `FOCUS_IN`, `FOCUS_OUT`, `INIT`.

Two options require the free-text `ptzCustomValue`:
- **Preset (Use Custom Value)** (`preset`): send `preset_<name>`, e.g. `preset_door`, `preset_1`.
- **Relative Move (Use Custom Value)** (`relative`): send `MOVE_RELATIVE_<pan>_<tilt>` or `MOVE_RELATIVE_<pan>_<tilt>_<zoom>` with underscore-separated floats, e.g. `MOVE_RELATIVE_0.1_-0.2`.
