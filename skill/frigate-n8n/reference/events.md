# Frigate Trigger — full event catalog

Node `type`: `frigateTrigger`. Pick the topic with the **`event`** parameter; its value **is** the topic template (the `frigate/` prefix is always omitted on `/ws`). Fill placeholder fields to narrow the subscription; any placeholder left blank becomes an MQTT `+` single-level wildcard (match-all for that level). The `custom` event takes a free-text `customTopic` supporting `+` (single level) and `#` (multi level).

**Emitted item shape:** `{ topic, payload, raw }`.
- `topic` = the actual matched topic.
- `payload` = parsed value. Structured (JSON) topics are double-parsed into a real object — do **not** parse again. Scalar topics give a string/number.
- `raw` = the raw envelope string.

> **Note:** Frigate publishes snapshot bytes **only over MQTT** — its `/ws` communicator JSON-serializes every envelope and silently drops binary payloads, so the snapshot is unreachable over `/ws` on every Frigate version. Use MQTT or the HTTP API (`/api/events/<id>/snapshot.jpg`, `/api/<camera>/<label>/snapshot.jpg`) to retrieve snapshot images. There is no snapshot trigger event.

Placeholder fields available on the node: `camera`, `object`, `zone`, `audioType`, `role`, `modelName`, and `customTopic` (custom only).

## Global feeds

| `event` value | Topic (no prefix) | Payload | Retained | Notes |
|---|---|---|---|---|
| `events` | `events` | JSON object `{ type:'new'\|'update'\|'end', before:{...}, after:{...} }` | No | Tracked-object lifecycle. `before`/`after` carry: id, camera, label, sub_label, top_score, false_positive, start_time, end_time, score, box[4], area, ratio, region[4], current_zones[], entered_zones[], snapshot{frame_time,box,area,region,score,attributes}, thumbnail, has_snapshot, has_clip, active, stationary, motionless_count, position_changes, attributes{}, current_attributes[], current_estimated_speed (0.14+), average_estimated_speed (0.14+), velocity_angle (0.14+), recognized_license_plate (0.15+), recognized_license_plate_score (0.15+). |
| `reviews` | `reviews` | JSON `{ type:'new'\|'update'\|'end', before:{...}, after:{...} }` | No | 0.14+. Each review: id, camera, start_time, end_time, severity('detection'\|'alert'), thumb_path, data{detections[], objects[], sub_labels[], zones[], audio[]}. Severity escalates detection -> alert. |
| `tracked_object_update` | `tracked_object_update` | JSON, discriminated by `type` | No | One of: `{type:'description', id, description}`; `{type:'face', id, name, score, camera, timestamp}`; `{type:'lpr', id, name, plate, score, camera, timestamp}` (0.15+); `{type:'classification', id, camera, timestamp, model, sub_label, score}` or `{...attribute, score}` (0.16+). |
| `triggers` | `triggers` | JSON `{ name, camera, event_id, type, score }` | No | 0.16+. A semantic-search trigger fired. |
| `stats` | `stats` | JSON full stats object (cameras, detectors, gpu, service, processes, ...) | No | Same schema as `GET /api/stats`. Interval = `mqtt.stats_interval`. |
| `camera_activity` | `camera_activity` | JSON keyed per camera (feature/detection status) | No | Emitted on connect bootstrap and on activity changes. |
| `available` | `available` | Scalar `'online'` \| `'offline'` | Yes | LWT publishes `'offline'` on shutdown/disconnect. |
| `notifications/state` | `notifications/state` | Scalar `'ON'` \| `'OFF'` | Yes | Global notifications toggle read-back. |

## Per-camera object counts

| `event` value | Topic | Payload | Placeholders |
|---|---|---|---|
| `<camera>/<object>` | e.g. `front_door/person` | integer | camera, object |
| `<camera>/<object>/active` | e.g. `front_door/person/active` | integer (active/non-stationary) | camera, object |
| `<camera>/all` | `front_door/all` | integer (total) | camera |
| `<camera>/all/active` | `front_door/all/active` | integer (total active) | camera |

## Per-zone object counts (zones addressed by zone name, not camera-prefixed)

| `event` value | Topic | Payload | Placeholders |
|---|---|---|---|
| `<zone>/<object>` | e.g. `driveway/car` | integer | zone, object |
| `<zone>/<object>/active` | `driveway/car/active` | integer | zone, object |
| `<zone>/all` | `driveway/all` | integer | zone |
| `<zone>/all/active` | `driveway/all/active` | integer | zone |

## Audio

| `event` value | Topic | Payload | Placeholders |
|---|---|---|---|
| `<camera>/audio/<audio_type>` | e.g. `front_door/audio/speech` | `'ON'`/`'OFF'` | camera, audioType |
| `<camera>/audio/all` | `front_door/audio/all` | `'ON'`/`'OFF'` | camera |
| `<camera>/audio/dBFS` | `front_door/audio/dBFS` | numeric dBFS | camera |
| `<camera>/audio/rms` | `front_door/audio/rms` | numeric RMS | camera |
| `<camera>/audio/transcription` | `front_door/audio/transcription` | string text (0.16+) | camera |

## Per-camera feature state read-backs (mostly retained)

| `event` value | Topic | Payload | Retained |
|---|---|---|---|
| `<camera>/enabled/state` | `<camera>/enabled/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/detect/state` | `<camera>/detect/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/recordings/state` | `<camera>/recordings/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/snapshots/state` | `<camera>/snapshots/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/audio/state` | `<camera>/audio/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/motion` | `<camera>/motion` | `'ON'`/`'OFF'` | **No** (only non-retained state topic; OFF after off-delay, default 30s) |
| `<camera>/motion/state` | `<camera>/motion/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/improve_contrast/state` | `<camera>/improve_contrast/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/motion_threshold/state` | `<camera>/motion_threshold/state` | integer | Yes |
| `<camera>/motion_contour_area/state` | `<camera>/motion_contour_area/state` | integer | Yes |
| `<camera>/birdseye/state` | `<camera>/birdseye/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/birdseye_mode/state` | `<camera>/birdseye_mode/state` | `'CONTINUOUS'`/`'MOTION'`/`'OBJECTS'` | Yes |
| `<camera>/ptz_autotracker/state` | `<camera>/ptz_autotracker/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/ptz_autotracker/active` | `<camera>/ptz_autotracker/active` | `'ON'`/`'OFF'` (tracking right now) | No |
| `<camera>/review_alerts/state` | `<camera>/review_alerts/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/review_detections/state` | `<camera>/review_detections/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/object_descriptions/state` | `<camera>/object_descriptions/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/review_descriptions/state` | `<camera>/review_descriptions/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/notifications/state` | `<camera>/notifications/state` | `'ON'`/`'OFF'` | Yes |
| `<camera>/notifications/suspended` | `<camera>/notifications/suspended` | UNIX timestamp until suspended, or `0` | No |

## Other per-camera

| `event` value | Topic | Payload | Placeholders |
|---|---|---|---|
| `<camera>/status/<role>` | e.g. `front_door/status/detect` | `'online'`/`'offline'`/`'disabled'` | camera, role |
| `<camera>/review_status` | `<camera>/review_status` | `'NONE'`/`'DETECTION'`/`'ALERT'` | camera |
| `<camera>/classification/<model_name>` | e.g. `front_door/classification/my_model` | predicted class name (string), 0.16+ | camera, modelName |

## Catch-all

| `event` value | Topic | Payload | Notes |
|---|---|---|---|
| `custom` | `customTopic` (free text) | passthrough (JSON parsed when possible; scalars as-is) | Supports `+` (single level) and `#` (multi level). Use to capture any topic not listed, or everything (`#`). |
