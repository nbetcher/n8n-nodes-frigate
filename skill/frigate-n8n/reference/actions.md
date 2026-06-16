# Frigate (action) — full operation catalog

Node `type`: `frigate`. Pick the action with the **`operation`** parameter; each maps to a fixed topic template (the `frigate/` prefix is always omitted on `/ws`). The node opens a short-lived WebSocket, publishes once, optionally awaits the `/state` read-back, then closes.

**Common parameters (shown conditionally by operation):**
- `camera` (string, required for per-camera ops) — a real configured camera name.
- `value` (options `ON`/`OFF`) — for toggle ops.
- `numericValue` (number) — for threshold / contour area.
- `minutes` (number) — for suspend notifications.
- `birdseyeMode` (options `CONTINUOUS`/`MOTION`/`OBJECTS`).
- `ptzCommand` (options, see PTZ below) + `ptzCustomValue` (string, only for `preset`/`relative`).
- `maskName` / `zoneName` (string) — for mask / zone ops.
- `restartPayload` (string, optional) — for restart.
- `customTopic` + `customPayload` — for `publishCustom`; `customTopic` + `timeoutMs` for `getCurrentValue`.
- `awaitState` (boolean) + `awaitTimeoutMs` (number) — shown on every op that has a `/state` read-back. When on, the node waits for the read-back and returns `confirmed`/`stateValue`.

**Result JSON:** `{ operation, topic, payload, published:true }`, plus `confirmed`, `stateTopic`, `stateValue` when `awaitState` is on; `getCurrentValue` returns `{ operation, topic, received, payload, matchedTopic, raw }`.

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
| `setMotionThreshold` | `<camera>/motion_threshold/set` | camera, numericValue | Pixel-change sensitivity. Read-back `<camera>/motion_threshold/state`. |
| `setMotionContourArea` | `<camera>/motion_contour_area/set` | camera, numericValue | Minimum contour size counted as motion. |
| `setBirdseyeMode` | `<camera>/birdseye_mode/set` | camera, birdseyeMode | CONTINUOUS / MOTION (last 30s) / OBJECTS (last 30s). ~30s to apply. |
| `suspendNotifications` | `<camera>/notifications/suspend` | camera, minutes | Read-back `<camera>/notifications/suspended` (timestamp). |

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
| `getCurrentValue` | `customTopic` (free text) | customTopic, timeoutMs (default 5000) | Subscribe once: waits for the next message matching the topic, returns its payload, closes. Best for reading retained `/state` read-backs. May time out if nothing republishes. |

## PTZ commands (`ptzCommand` options for the `ptz` operation)

Fixed: `MOVE_UP`, `MOVE_DOWN`, `MOVE_LEFT`, `MOVE_RIGHT`, `ZOOM_IN`, `ZOOM_OUT`, `STOP`, `FOCUS_IN`, `FOCUS_OUT`, `INIT`.

Two options require the free-text `ptzCustomValue`:
- **Preset (Use Custom Value)** (`preset`): send `preset_<name>`, e.g. `preset_door`, `preset_1`.
- **Relative Move (Use Custom Value)** (`relative`): send `MOVE_RELATIVE_<pan>_<tilt>` or `MOVE_RELATIVE_<pan>_<tilt>_<zoom>` with underscore-separated floats, e.g. `MOVE_RELATIVE_0.1_-0.2`.
