# n8n-nodes-frigate

> An [n8n](https://n8n.io) community node that controls and monitors a [Frigate](https://frigate.video) NVR over its real-time WebSocket (`/ws`) API — no external MQTT broker required.

Frigate bridges its MQTT command and feed topics onto a public WebSocket endpoint at `/ws`. This package speaks that protocol natively: the **Frigate Trigger** node holds a persistent socket open and starts workflows on incoming events, while the **Frigate** action node publishes commands (toggle detection, control PTZ, restart, and more). Every topic uses the bare name — the `frigate/` prefix is omitted on the wire.

---

## Table of Contents

- [Features](#features)
- [How It Works](#how-it-works)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
  - [Via the n8n UI](#via-the-n8n-ui)
  - [Via npm (self-hosted)](#via-npm-self-hosted)
- [Credential Setup](#credential-setup)
- [Frigate Trigger Node](#frigate-trigger-node)
  - [Trigger Event Catalog](#trigger-event-catalog)
- [Frigate Action Node](#frigate-action-node)
  - [Action Operation Catalog](#action-operation-catalog)
- [Example Workflows](#example-workflows)
  - [1. Person detected → push notification](#1-person-detected--push-notification)
  - [2. Toggle recording on a schedule](#2-toggle-recording-on-a-schedule)
  - [3. PTZ control on a tracked object](#3-ptz-control-on-a-tracked-object)
- [Payload Handling](#payload-handling)
- [Troubleshooting](#troubleshooting)
- [Compatibility](#compatibility)
- [A Note on n8n Verification](#a-note-on-n8n-verification)
- [Related Documentation](#related-documentation)
- [Contributing](#contributing)
- [License](#license)

---

## Features

- **Persistent trigger** — one always-on WebSocket per trigger node, with automatic exponential-backoff reconnect (5 s → 60 s cap) so workflows survive Frigate restarts and network drops.
- **46 catalogued trigger events** — every documented `/ws` topic, from tracked-object lifecycle and review items to per-camera/per-zone object counts, audio metrics, GenAI results, and every retained `/state` read-back. Plus a catch-all **Subscribe to Custom Topic** option.
- **27 action operations** — toggle detect / recordings / snapshots / audio / motion, set thresholds, control birdseye, send PTZ commands, manage notifications, toggle masks/zones, restart Frigate, publish to any custom topic, and read the current value of any topic on demand.
- **Client-side wildcard subscriptions** — leave a placeholder field blank to subscribe to all cameras / zones / objects at once (MQTT-style `+`), or supply raw `+` / `#` patterns.
- **Optional state confirmation** — every setter with a `/state` read-back can optionally keep the socket open and wait for the confirming message after publishing.
- **Flexible auth** — connect unauthenticated to the internal port, or authenticate against an exposed instance with username/password (auto-login for a JWT) or a pre-issued bearer token.
- **No MQTT broker** — talks to Frigate's own `/ws` directly.

## How It Works

The `/ws` wire format is a JSON envelope with exactly two fields:

```json
{ "topic": "front_door/person", "payload": "1" }
```

There is **no** `retain` field on the wire — retention is an MQTT-only concept. Topics omit the `frigate/` prefix. For structured topics (events, reviews, stats, ...) the `payload` is itself a **JSON-encoded string** nested inside the envelope, so the node parses it a second time. Scalar payloads (`ON`/`OFF`, integers, dBFS values) pass through unchanged. The best-snapshot topic delivers raw JPEG bytes, which the node emits as a base64 string.

Because `/ws` broadcasts **all** topics with no server-side per-topic subscribe, the trigger node filters the incoming stream **client-side** by matching each message's `topic` against your resolved subscription pattern (supporting `+` single-level and `#` multi-level wildcards).

## Prerequisites

| Requirement | Detail |
| --- | --- |
| **Frigate** | 0.14, 0.15, or 0.16. Some events/actions are version-gated (marked `0.14+`, `0.15+`, `0.16+` below and in the field hints). |
| **WebSocket reachability** | n8n must be able to reach Frigate's `/ws` endpoint — `ws://host:5000/ws` (internal) or `wss://host:8971/ws` (authenticated). If Frigate sits behind a reverse proxy, the proxy must allow WebSocket upgrades and you may need a path prefix. |
| **Authentication (optional)** | Port `5000` is trusted-internal and needs no credentials. Port `8971` (or any externally exposed instance with `auth.enabled: True`) requires a username/password or a pre-issued JWT. |
| **n8n** | A self-hosted n8n instance (this package ships a runtime dependency — see [verification note](#a-note-on-n8n-verification)). Node.js `>=18.10`. |

## Installation

### Via the n8n UI

1. In n8n, go to **Settings → Community Nodes**.
2. Click **Install**.
3. Enter the package name `n8n-nodes-frigate` and confirm.
4. After install, the **Frigate** and **Frigate Trigger** nodes appear in the node panel.

See the official [community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details.

### Via npm (self-hosted)

For a self-hosted Docker or bare-metal install, add the package to your n8n custom-nodes directory:

```bash
# Default custom extensions directory
cd ~/.n8n/nodes
npm install n8n-nodes-frigate
```

Then restart n8n. If you set a custom `N8N_CUSTOM_EXTENSIONS` path, install there instead. For Docker, mount a volume at `/home/node/.n8n` and run the `npm install` inside that volume.

## Credential Setup

Create a single **Frigate API** credential (internal name `frigateApi`). Fields:

| Field | Name | Type | Default | Description |
| --- | --- | --- | --- | --- |
| **Protocol** | `protocol` | options (`HTTP / WS`, `HTTPS / WSS (SSL)`) | `http` | Transport scheme. `http` → `ws://` for the socket and `http://` for the HTTP base; `https` → `wss://` and `https://`. Use HTTPS/WSS for the authenticated port `8971` when exposed externally. |
| **Host** | `host` | string (required) | `localhost` | Hostname or IP of the Frigate server — **no scheme, no port** (e.g. `frigate.local` or `192.168.1.10`). |
| **Port** | `port` | number | `5000` | `5000` = internal unauthenticated UI/API. `8971` = authenticated UI/API (recommended when exposed externally). |
| **Path Prefix** | `pathPrefix` | string | _(empty)_ | Optional base path when Frigate is served under a sub-path behind a reverse proxy (e.g. `/frigate`). Prepended before `/ws` and `/api`. Leave blank for a root deployment. |
| **Frigate Auth Enabled** | `authEnabled` | boolean | `false` | Turn on when connecting to an authenticated Frigate (port `8971` / `auth.enabled: True`). When off, no credentials are sent. |
| **Authentication Method** | `authMethod` | options (`Username & Password`, `Bearer / JWT Token`) | `password` | _Shown when auth is enabled._ `Username & Password` logs in against `/api/login` to obtain a JWT. `Bearer / JWT Token` uses a pre-issued JWT directly. |
| **Username** | `username` | string | `admin` | _Shown for password auth._ Frigate username (the default `admin` user is auto-generated on first startup and printed to the logs). |
| **Password** | `password` | string (masked) | _(empty)_ | _Shown for password auth._ Used to obtain a JWT via `/api/login`; the JWT is then sent as a cookie / `Authorization` header. |
| **Bearer / JWT Token** | `token` | string (masked) | _(empty)_ | _Shown for token auth._ A pre-issued JWT, sent as `Authorization: Bearer <jwt>` (and as the `frigate_token` cookie). |

**How auth is applied.** When auth is disabled, the node opens `/ws` and calls `/api` with no credentials. With password auth, the node first `POST`s `{ user, password }` to `${base}/api/login`, extracts the JWT (from the response body or the `frigate_token` Set-Cookie), and sends it as both an `Authorization: Bearer` header and a `frigate_token` cookie on the `/ws` upgrade. With token auth it uses your JWT directly. The credential's **Test** button performs `GET /api/version`, which works with or without auth.

## Frigate Trigger Node

The trigger node opens **one persistent WebSocket** to `/ws` and starts the workflow whenever a published topic matches your selection. It reconnects automatically with exponential backoff after a drop or a Frigate restart. The in-editor **Listen for test event** button opens a short-lived socket, waits up to 30 s for the first matching message, emits it, and closes.

**Choosing what to listen for.** Pick an **Event** from the catalog, then fill in any placeholder fields that appear (Camera, Object, Zone, Audio Type, Role, Model Name). **Any placeholder you leave blank becomes a `+` single-level wildcard**, so leaving Camera empty on _Detect State_ listens to every camera. Choose **Subscribe to Custom Topic** to supply an exact topic or a raw `+`/`#` pattern.

**Emitted item shape.** Each matching message produces an item with:

```json
{
  "topic": "front_door/person",
  "payload": 1,
  "raw": "{\"topic\":\"front_door/person\",\"payload\":\"1\"}",
  "binary": "<base64 — only present for snapshot frames>"
}
```

### Trigger Event Catalog

Topics below are shown **without** the `frigate/` prefix. Placeholders (`<camera>`, `<object>`, ...) are filled from the node's fields; blanks become `+` wildcards.

| Event (option name) | Topic | Description | Payload |
| --- | --- | --- | --- |
| Tracked Object Event | `events` | Tracked-object lifecycle change-feed. Fires on `new`, `update`, and `end`. Not retained. | JSON → `{ type: 'new'\|'update'\|'end', before: {…}, after: {…} }`. Each object has `id, camera, label, sub_label, top_score, false_positive, start_time, end_time, score, box[4], area, region[4], current_zones[], entered_zones[], thumbnail, has_snapshot, has_clip, active, stationary, attributes{…}`, plus `current_estimated_speed`/`average_estimated_speed`/`velocity_angle` (0.14+) and `recognized_license_plate`(_score) (0.15+). |
| Review Item | `reviews` | Review change-feed (0.14+). Fires on review create/update/end; severity escalates `detection` → `alert`. Not retained. | JSON → `{ type, before, after }`. Each review: `id, camera, start_time, end_time, severity('detection'\|'alert'), thumb_path, data{ detections[], objects[], sub_labels[], zones[], audio[] }`. |
| Tracked Object Update | `tracked_object_update` | GenAI/recognition results attached to a tracked object, discriminated by `type`. Not retained. | JSON, one of: `description {id, description}`; `face {id, name, score, camera, timestamp}`; `lpr {id, name, plate, score, …}` (0.15+); `classification` sub-label/attribute `{id, camera, model, sub_label\|attribute, score}` (0.16+). |
| Semantic Search Trigger | `triggers` | A semantic-search trigger fires (0.16+). Not retained. | JSON → `{ name, camera, event_id, type, score }`. |
| Stats | `stats` | Server statistics, identical to `GET /api/stats`, on a configurable interval. Not retained. | JSON → full stats object (`cameras, detectors, gpu, service, processes, …`). |
| Camera Activity | `camera_activity` | Per-camera feature + detection status, emitted on connect and on activity changes. Not retained. | JSON → object keyed per camera with feature/detection status. |
| Availability | `available` | Frigate online/offline availability. Retained (MQTT). | Scalar string: `online` or `offline`. |
| Global Notifications State | `notifications/state` | Global notifications toggle read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Object Count - Camera | `<camera>/<object>` | Count of a given object type on a camera changes. | Scalar integer. |
| Active Object Count - Camera | `<camera>/<object>/active` | Active (non-stationary) count of an object type on a camera changes. | Scalar integer. |
| All Object Count - Camera | `<camera>/all` | Total object count on a camera changes. | Scalar integer. |
| All Active Object Count - Camera | `<camera>/all/active` | Total active object count on a camera changes. | Scalar integer. |
| Object Count - Zone | `<zone>/<object>` | Count of an object type in a zone changes (zones are named, not camera-prefixed). | Scalar integer. |
| Active Object Count - Zone | `<zone>/<object>/active` | Active count of an object type in a zone changes. | Scalar integer. |
| All Object Count - Zone | `<zone>/all` | Total object count in a zone changes. | Scalar integer. |
| All Active Object Count - Zone | `<zone>/all/active` | Total active object count in a zone changes. | Scalar integer. |
| Best Snapshot Image | `<camera>/<object>/snapshot` | Frigate captures the best/highest-confidence frame for an object type. | Binary JPEG bytes — emitted as a base64 string in the `binary` field (not JSON). |
| Audio Type Detected | `<camera>/audio/<audio_type>` | A specific audio type (speech, bark, scream, …) detected or cleared. | Scalar string: `ON` or `OFF`. |
| Any Audio Detected | `<camera>/audio/all` | Any monitored audio type detected or cleared. | Scalar string: `ON` or `OFF`. |
| Audio Level dBFS | `<camera>/audio/dBFS` | Audio level metric published. | Scalar numeric (dBFS). |
| Audio Level RMS | `<camera>/audio/rms` | Audio RMS metric published. | Scalar numeric (RMS). |
| Audio Transcription | `<camera>/audio/transcription` | Live audio transcription text (0.16+). | Scalar string: transcription text. |
| Camera Enabled State | `<camera>/enabled/state` | Whole-camera processing toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Detect State | `<camera>/detect/state` | Object detection toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Recordings State | `<camera>/recordings/state` | Recordings toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Snapshots State | `<camera>/snapshots/state` | Snapshots toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Audio Detection State | `<camera>/audio/state` | Audio detection toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Motion Detected | `<camera>/motion` | Motion detected or cleared. `OFF` after the motion off-delay (default 30 s). The only non-retained state topic. | Scalar string: `ON` or `OFF`. |
| Motion Detection State | `<camera>/motion/state` | Motion detection enabled/disabled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Improve Contrast State | `<camera>/improve_contrast/state` | Contrast improvement toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Motion Threshold State | `<camera>/motion_threshold/state` | Motion threshold changed read-back. Retained. | Scalar integer. |
| Motion Contour Area State | `<camera>/motion_contour_area/state` | Motion contour area changed read-back. Retained. | Scalar integer. |
| Birdseye State | `<camera>/birdseye/state` | Camera's birdseye inclusion toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Birdseye Mode State | `<camera>/birdseye_mode/state` | Birdseye mode changed read-back (~30 s to apply). Retained. | Scalar string: `CONTINUOUS` \| `MOTION` \| `OBJECTS`. |
| PTZ Autotracker State | `<camera>/ptz_autotracker/state` | PTZ autotracker enabled/disabled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| PTZ Autotracker Active | `<camera>/ptz_autotracker/active` | Autotracker is actively tracking right now. | Scalar string: `ON` or `OFF`. |
| Review Alerts State | `<camera>/review_alerts/state` | Alert-level review toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Review Detections State | `<camera>/review_detections/state` | Detection-level review toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Object Descriptions State | `<camera>/object_descriptions/state` | GenAI object descriptions toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Review Descriptions State | `<camera>/review_descriptions/state` | GenAI review descriptions toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Per-Camera Notifications State | `<camera>/notifications/state` | Per-camera notifications toggled read-back. Retained. | Scalar string: `ON` or `OFF`. |
| Per-Camera Notifications Suspended | `<camera>/notifications/suspended` | Per-camera notification suspension updated. | Scalar: UNIX timestamp until which suspended, or `0`. |
| Camera/Role Status | `<camera>/status/<role>` | Stream/role state change (e.g. `detect`, `record` roles). | Scalar string: `online` \| `offline` \| `disabled`. |
| Review Status | `<camera>/review_status` | Current review status of the camera. | Scalar string: `NONE` \| `DETECTION` \| `ALERT`. |
| Classification Model Result | `<camera>/classification/<model_name>` | Custom state-classification model result changed (0.16+). | Scalar string: predicted class name. |
| Subscribe to Custom Topic | _any_ | Catch-all. Subscribe to any `/ws` topic by exact string or `+`/`#` wildcard pattern (filtered client-side). | Passthrough: JSON parsed when possible, scalars passed through, binary as base64. |

## Frigate Action Node

The **Frigate** action node publishes commands over a short-lived `/ws` connection. Pick an **Operation**, fill its parameters, and the node sends `JSON.stringify({ topic, payload })` once, then closes the socket.

By default actions are **fire-and-forget** — `/ws` has no application-level ack. Every operation that has a `/state` read-back (i.e. everything except **PTZ Command**, **Set Audio Transcription**, and **Restart**) exposes an optional **Await State Confirmation** toggle. When on, the node keeps the socket open after publishing and waits (up to **Confirmation Timeout**, default 5000 ms) for the matching `/state` message, returning it as `stateValue` with `confirmed: true`.

### Action Operation Catalog

Topics shown **without** the `frigate/` prefix. `value` is the `ON`/`OFF` options field; placeholders are filled from the node's fields.

| Operation | Topic | Parameters | Description |
| --- | --- | --- | --- |
| Set Detect | `<camera>/detect/set` | `camera`, `value` (ON/OFF) | Turn object detection on/off. Enabling detect also enables motion. Read-back `…/detect/state`. |
| Set Recordings | `<camera>/recordings/set` | `camera`, `value` | Turn recordings on/off. Requires recordings enabled in config. Read-back `…/recordings/state`. |
| Set Snapshots | `<camera>/snapshots/set` | `camera`, `value` | Turn snapshot capture on/off. Read-back `…/snapshots/state`. |
| Set Audio Detection | `<camera>/audio/set` | `camera`, `value` | Turn audio detection on/off. Requires audio enabled in config. Read-back `…/audio/state`. |
| Set Motion Detection | `<camera>/motion/set` | `camera`, `value` | Turn motion detection on/off. Cannot disable while detect is enabled. Read-back `…/motion/state`. |
| Set Improve Contrast | `<camera>/improve_contrast/set` | `camera`, `value` | Turn contrast improvement for motion on/off. Read-back `…/improve_contrast/state`. |
| Set Camera Enabled | `<camera>/enabled/set` | `camera`, `value` | Turn whole-camera processing on/off. Requires `enabled` present in config. Read-back `…/enabled/state`. |
| Set Motion Threshold | `<camera>/motion_threshold/set` | `camera`, `numericValue` (int) | Set how much a pixel must change to count as motion. Read-back `…/motion_threshold/state`. |
| Set Motion Contour Area | `<camera>/motion_contour_area/set` | `camera`, `numericValue` (int) | Set the minimum contour size counted as motion. Read-back `…/motion_contour_area/state`. |
| Set Birdseye (Camera) | `<camera>/birdseye/set` | `camera`, `value` | Include/exclude this camera in birdseye (per-camera; no global topic). Read-back `…/birdseye/state`. |
| Set Birdseye Mode | `<camera>/birdseye_mode/set` | `camera`, `birdseyeMode` (CONTINUOUS/MOTION/OBJECTS) | Set when the camera appears in birdseye. Read-back `…/birdseye_mode/state`. |
| PTZ Command | `<camera>/ptz` | `camera`, `ptzCommand` (+ `ptzCustomValue` for preset/relative) | Send a PTZ command to an ONVIF camera. **Fire-and-forget, no read-back.** Requires `onvif` configured. |
| Set PTZ Autotracker | `<camera>/ptz_autotracker/set` | `camera`, `value` | Turn PTZ autotracking on/off. Requires `ptz_autotracker` in config. Read-back `…/ptz_autotracker/state`. |
| Set Global Notifications | `notifications/set` | `value` | Enable/disable notifications for **all** cameras. Read-back `notifications/state`. |
| Set Per-Camera Notifications | `<camera>/notifications/set` | `camera`, `value` | Turn per-camera notifications on/off. Read-back `…/notifications/state`. |
| Suspend Per-Camera Notifications | `<camera>/notifications/suspend` | `camera`, `minutes` (int) | Suspend a camera's notifications for N minutes. Read-back `…/notifications/suspended`. |
| Set Audio Transcription | `<camera>/audio_transcription/set` | `camera`, `value` | Turn live audio transcription on/off (0.16+). Requires audio + transcription in config. **No read-back.** |
| Set Review Alerts | `<camera>/review_alerts/set` | `camera`, `value` | Turn generation of `alert` review items on/off (0.16+). Read-back `…/review_alerts/state`. |
| Set Review Detections | `<camera>/review_detections/set` | `camera`, `value` | Turn generation of `detection` review items on/off (0.16+). Read-back `…/review_detections/state`. |
| Set Object Descriptions | `<camera>/object_descriptions/set` | `camera`, `value` | Turn GenAI object descriptions on/off (0.16+). Read-back `…/object_descriptions/state`. |
| Set Review Descriptions | `<camera>/review_descriptions/set` | `camera`, `value` | Turn GenAI review summaries on/off (0.16+). Read-back `…/review_descriptions/state`. |
| Set Motion Mask | `<camera>/motion_mask/<mask_name>/set` | `camera`, `maskName`, `value` | Enable/disable a named motion mask. Read-back `…/motion_mask/<mask_name>/state`. |
| Set Object Mask | `<camera>/object_mask/<mask_name>/set` | `camera`, `maskName`, `value` | Enable/disable a named object mask. Read-back `…/object_mask/<mask_name>/state`. |
| Set Zone | `<camera>/zone/<zone_name>/set` | `camera`, `zoneName`, `value` | Enable/disable a named zone. Read-back `…/zone/<zone_name>/state`. |
| Restart | `restart` | `restartPayload` (optional) | Cause Frigate to exit so Docker restarts the container. **No read-back.** |
| Publish to Custom Topic | _any_ | `customTopic`, `customPayload` | Publish an arbitrary `{ topic, payload }` envelope. Topic is sent bare. JSON strings parsed; scalars sent as-is. |
| Get Current Value | _any_ | `customTopic`, `timeoutMs` (default 5000) | Open `/ws`, return the next message matching the topic, then close. Ideal for reading retained `/state` read-backs on demand. |

**PTZ commands.** The `ptzCommand` field offers `MOVE_UP/DOWN/LEFT/RIGHT`, `ZOOM_IN/OUT`, `STOP`, `FOCUS_IN/OUT`, `INIT`, plus **Preset** and **Relative Move** options. For the latter two, fill the **Preset / Relative Value** override with the exact payload, e.g. `preset_door`, `preset_1`, or `MOVE_RELATIVE_0.1_-0.2` (underscore-separated floats; optional trailing zoom: `MOVE_RELATIVE_<pan>_<tilt>_<zoom>`).

## Example Workflows

### 1. Person detected → push notification

Notify yourself the moment a person is confirmed on the front door camera.

1. **Frigate Trigger** node:
   - **Event:** `Tracked Object Event` (`events`).
   - Leave the placeholders empty (this is a global feed).
2. **IF** node — keep only newly-confirmed people:
   - Condition 1: `{{$json.payload.type}}` **equals** `new`.
   - Condition 2: `{{$json.payload.after.label}}` **equals** `person`.
   - Condition 3 (optional): `{{$json.payload.after.camera}}` **equals** `front_door`.
3. **Notify** node (Telegram / Slack / Pushover / Email) on the IF `true` branch:
   - Message: `Person detected on {{$json.payload.after.camera}} (score {{$json.payload.after.top_score}}).`
   - Optionally embed the snapshot: build the URL `http://<host>:5000/api/events/{{$json.payload.after.id}}/snapshot.jpg` and attach it.

> Tip: to get the actual JPEG over `/ws` instead of HTTP, add a second **Frigate Trigger** on `Best Snapshot Image` (`<camera>/<object>/snapshot`) with Camera `front_door`, Object `person` — its `binary` field is the base64 image.

### 2. Toggle recording on a schedule

Record only during the day; pause overnight to save disk.

1. **Schedule Trigger** node — fire at **07:00** (start recording).
2. **Frigate** action node:
   - **Operation:** `Set Recordings`.
   - **Camera:** `driveway` (add one node per camera, or loop with a Code/Split node over a camera list).
   - **Value:** `ON`.
   - **Await State Confirmation:** `true` (optional) to confirm via `driveway/recordings/state`.
3. Duplicate the pair with a second **Schedule Trigger** at **22:00** and a **Frigate** node setting **Value:** `OFF`.

The same pattern toggles `Set Detect`, `Set Snapshots`, or `Set Per-Camera Notifications` on any schedule (e.g. arm/disarm with your alarm system).

### 3. PTZ control on a tracked object

Swing an ONVIF PTZ camera to a preset whenever a car enters the driveway, then return home after a delay.

1. **Frigate Trigger** node:
   - **Event:** `Tracked Object Event` (`events`).
2. **IF** node:
   - `{{$json.payload.type}}` **equals** `new` **AND** `{{$json.payload.after.label}}` **equals** `car` **AND** `{{$json.payload.after.camera}}` **equals** `ptz_cam`.
3. **Frigate** action node (`true` branch) — point at the driveway preset:
   - **Operation:** `PTZ Command`.
   - **Camera:** `ptz_cam`.
   - **Command:** `Preset (Use Custom Value)`.
   - **Preset / Relative Value:** `preset_driveway`.
4. **Wait** node — e.g. 30 seconds.
5. **Frigate** action node — return home:
   - **Operation:** `PTZ Command`, **Camera:** `ptz_cam`, **Command:** `Init` (or another `preset_home`).

> PTZ is fire-and-forget — there is no `/state` confirmation. Requires `onvif` configured for the camera in Frigate.

## Payload Handling

- **Inbound (trigger):** structured topics arrive as a JSON-encoded string nested in the envelope and are parsed a second time, so `payload` is a ready-to-use object. Scalar topics (`ON`/`OFF`, integers, dBFS) pass through. The snapshot topic's raw JPEG is emitted as base64 in `binary`. The original envelope string is always available in `raw`.
- **Outbound (action):** `ON`/`OFF`, numbers, minutes, and PTZ commands are sent as bare strings. For **Publish to Custom Topic**, a value that looks like JSON (`{…}` or `[…]`) is parsed and embedded as structured data; everything else is sent as a string.

## Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| **Trigger never fires** | Confirm the topic actually publishes — add a temporary **Subscribe to Custom Topic** trigger with pattern `#` to see everything, or use the action node's **Get Current Value** on a `/state` topic. Remember: `count`/`state` topics only fire on **change**. |
| **`Listen for test event` times out (30 s)** | No matching message was published within the window. Trigger the event in real life (walk past the camera) or widen your pattern (blank placeholders → `+`). |
| **Connection refused / handshake timeout** | Wrong **Host**/**Port**, or the reverse proxy isn't forwarding the WebSocket upgrade. Verify `ws://<host>:<port>/ws` is reachable from the n8n host. Set **Path Prefix** if Frigate is under a sub-path. |
| **401 / login fails** | With **Frigate Auth Enabled**, check username/password (the default `admin` password is printed to Frigate's logs on first start) or that your bearer JWT is valid and unexpired. Port `8971` requires auth; port `5000` does not. |
| **Credential `Test` passes but the socket won't open** | `Test` only hits `GET /api/version` over HTTP. The `/ws` upgrade can still fail behind a proxy that strips `Upgrade`/`Connection` headers — fix the proxy WebSocket config. |
| **Action publishes but nothing changes** | The feature may be disabled in Frigate's config (e.g. recordings/audio/onvif must be enabled). Some setters are no-ops without the corresponding config block. Turn on **Await State Confirmation** to see whether the `/state` read-back changes. |
| **`A preset/relative PTZ value is required`** | You chose **Preset** or **Relative Move** but left **Preset / Relative Value** blank. Fill it (e.g. `preset_door`). |
| **Wrong port** | `5000` = internal unauthenticated. `8971` = authenticated. Using `8971` without enabling auth, or `5000` with auth on, will fail. |

## Compatibility

Targets Frigate **0.14 / 0.15 / 0.16**. Version-gated events and actions are marked `0.14+`, `0.15+`, or `0.16+` above and in the in-editor field hints. Requires Node.js `>=18.10` and a self-hosted n8n instance.

## A Note on n8n Verification

This package ships [`ws`](https://www.npmjs.com/package/ws) as a **runtime dependency** to hold a persistent WebSocket open — that is what makes the trigger node work. n8n's official verification program does **not** allow verified community packages to ship runtime dependencies, so **this package is not eligible for official verification**. It is fully suitable for self-hosted / private installs. If verification ever becomes a requirement, the socket logic would need to move behind a host-provided helper or a webhook/poll design.

## Related Documentation

- **[COMPARISON.md](COMPARISON.md)** — how this WebSocket-native approach compares to the alternatives (generic MQTT nodes, the Frigate HTTP API, Home Assistant bridging).
- **n8n Workflow Dev skill** — the `n8n-workflow-dev` skill builds, debugs, and deploys n8n workflows (including Code nodes) programmatically against a self-hosted instance; pair it with these nodes to scaffold Frigate automations.
- [n8n community-nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [Frigate MQTT integration docs](https://docs.frigate.video/integrations/mqtt/)
- [Frigate HTTP API docs](https://docs.frigate.video/integrations/api/frigate-http-api/)
- [Frigate authentication docs](https://docs.frigate.video/configuration/authentication/)

## Contributing

Issues and pull requests are welcome at the [project repository](https://github.com/nbetcher/n8n-nodes-frigate).

```bash
git clone https://github.com/nbetcher/n8n-nodes-frigate.git
cd n8n-nodes-frigate
npm install
npm run build      # tsc + gulp build:icons
npm run lint       # eslint (use `npm run lintfix` to auto-fix)
npm run dev        # tsc --watch
```

Please run `npm run lint` and `npm run build` before opening a PR. The node descriptions are kept lean by sharing option lists in `nodes/Frigate/FrigateDescription.ts`; URL construction, auth/login, and the socket primitives live in `nodes/Frigate/GenericFunctions.ts` and are shared by both nodes.

## License

[MIT](LICENSE.md) © Nick Betcher
