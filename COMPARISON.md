# Frigate Integration Comparison: `n8n-nodes-frigate` vs. Home Assistant Frigate Integration

This document compares two ways of integrating with [Frigate NVR](https://frigate.video):

- **(A) `n8n-nodes-frigate`** — the community node in this repository (`Frigate` action node + `Frigate Trigger` node, `frigateApi` credential). It speaks Frigate's real-time WebSocket API (`/ws`) directly.
- **(B) Home Assistant Frigate integration** — the official `blakeblackshear/frigate-hass-integration` HACS custom component (plus the popular SgtBatten Frigate Camera Notifications blueprint).

## Framing: two different goals

These projects solve fundamentally different problems, so the comparison is about *fit*, not about one being "better."

The **HA Frigate integration** exists to project Frigate's runtime state onto Home Assistant's **entity/state model**. It creates dozens of long-lived entities (cameras, binary sensors, sensors, switches, numbers, images) so that Frigate fits into a home-automation surface — Lovelace dashboards, the Logbook, History graphs, scenes, the Media Browser, and HA automations. State is held, displayed, graphed, and made addressable as `binary_sensor.front_door_person_occupancy` etc. Real-time data arrives over **MQTT** (`frigate/<cam|zone>/...`), and performance/media data is fetched over the **Frigate HTTP API** (`/api/stats`, `/api/events`, `vod/...`). It also adds an HA-specific **notification proxy** that re-exposes Frigate's media endpoints to mobile push notifications.

The **`n8n-nodes-frigate` node** exists to drive **event-driven workflow automation**. It does not hold state or render anything; it turns every Frigate broadcast into a discrete workflow execution and turns workflow steps into Frigate commands. Its transport is Frigate's **WebSocket API (`/ws`)** — the same broadcast feed the Frigate web UI uses — not MQTT and (for live data) not the HTTP API. The trigger node keeps one persistent socket open, filters the broadcast stream client-side with MQTT-style `+`/`#` wildcards, and emits one n8n item per matching message. The action node opens short-lived sockets to publish command envelopes, optionally awaiting the `/state` read-back. Because `/ws` carries *every* topic, the node also exposes generic "custom topic" subscribe/publish operations, making it forward-compatible with topics it doesn't explicitly enumerate.

In short: **HA = a persistent entity/state surface for a smart home; this node = a programmable trigger/action bridge for arbitrary workflows.** Where HA gives you `switch.front_door_detect` to flip on a dashboard, this node gives you a `Set Detect` action you can wire after any trigger in any flow; where HA gives you `binary_sensor.driveway_car_occupancy` to graph, this node gives you a trigger that fires your workflow the instant the count changes.

---

## Capability comparison

Legend: **Yes** = first-class support · **No** = not supported · **Partial** = supported with caveats · **via custom topic** = not a dedicated feature, but reachable through the generic Subscribe/Publish-to-Custom-Topic operations.

### 1. Real-time events / triggers

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Tracked-object lifecycle (`events`: new/update/end) | Yes (Tracked Object Event trigger) | Partial | HA does **not** fire a native `frigate_event`; consumers use a raw HA `mqtt` trigger on `frigate/events` or the SgtBatten blueprint. The n8n trigger double-parses the nested JSON payload and emits `{type, before, after}` directly. |
| Review-item lifecycle (`reviews`, 0.14+) | Yes (Review Item trigger) | Partial | HA surfaces review *state* via `FrigateReviewStatusSensor`; the lifecycle feed itself is consumed via an `mqtt` trigger / blueprint (the blueprint's default trigger). |
| Tracked-object enrichment (`tracked_object_update`: face/lpr/desc/classification) | Yes (Tracked Object Update trigger) | Partial | HA turns these into *sensors* (recognized face/plate/classification) with ~60s retention; n8n delivers each update as a workflow event. |
| Semantic-search trigger (`triggers`, 0.16+) | Yes (Semantic Search Trigger) | No | No dedicated HA entity for this feed. |
| Camera activity bootstrap (`camera_activity`) | Yes (Camera Activity trigger) | No | UI-bootstrap feed; HA reconstructs equivalent state from individual MQTT topics instead. |
| "Listen once for test event" in editor | Yes (manualTriggerFunction) | n/a | n8n-editor convenience; not applicable to HA's model. |
| One event = one execution | Yes | No (state-update model) | HA updates entity state in place; it does not produce a discrete event object per change by default. |

### 2. Camera control & toggles

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Whole-camera enable/disable (`enabled/set`) | Yes (Set Camera Enabled) | Yes (`camera.turn_on`/`turn_off`) | Both write `frigate/<cam>/enabled/set`. |
| Object detection (`detect/set`) | Yes (Set Detect) | Yes (`switch.<cam>_detect`) | |
| Motion detection (`motion/set`) | Yes (Set Motion Detection) | Yes (`switch.<cam>_motion`) | |
| Recordings (`recordings/set`) | Yes (Set Recordings) | Yes (`switch.<cam>_recordings`) | |
| Snapshots (`snapshots/set`) | Yes (Set Snapshots) | Yes (`switch.<cam>_snapshots`) | |
| Improve contrast (`improve_contrast/set`) | Yes (Set Improve Contrast) | Yes (`switch.<cam>_improve_contrast`) | |
| Audio detection (`audio/set`) | Yes (Set Audio Detection) | Yes (`switch.<cam>_audio`) | |
| Motion threshold (`motion_threshold/set`) | Yes (Set Motion Threshold) | Yes (`number.<cam>_threshold`, 0–255) | n8n sends a bare integer; HA exposes a bounded number entity. |
| Motion contour area (`motion_contour_area/set`) | Yes (Set Motion Contour Area) | Yes (`number.<cam>_contour_area`, 0–10000) | |
| Birdseye inclusion (`birdseye/set`) | Yes (Set Birdseye) | via custom topic | Frigate exposes `frigate/<cam>/birdseye/set`, but it does not surface as a dedicated HA switch in every version. |
| Birdseye mode (`birdseye_mode/set`: CONTINUOUS/MOTION/OBJECTS) | Yes (Set Birdseye Mode) | No | Not a dedicated HA entity. |
| Motion mask enable/disable (`motion_mask/<name>/set`) | Yes (Set Motion Mask) | No | n8n-only dedicated operation. |
| Object mask enable/disable (`object_mask/<name>/set`) | Yes (Set Object Mask) | No | n8n-only dedicated operation. |
| Zone enable/disable (`zone/<name>/set`) | Yes (Set Zone) | No | n8n-only dedicated operation. |
| Restart Frigate (`restart`) | Yes (Restart) | via API | HA has no dedicated restart service; n8n publishes the `restart` topic. |
| Live video stream entity | No | Yes (`camera.<cam>` / WebRTC / birdseye) | HA restreams RTSP/go2rtc as a camera entity. n8n is not a media-rendering surface. |
| Await `/state` confirmation after a write | Yes (optional toggle, with timeout) | Partial | n8n can block until the matching `/state` read-back arrives; HA updates the entity asynchronously when the state topic is published. |

### 3. PTZ

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| PTZ move/zoom/focus/stop/init | Yes (PTZ Command) | Yes (`frigate.ptz` service) | Both publish `frigate/<cam>/ptz`. n8n offers MOVE_*, ZOOM_*, FOCUS_*, STOP, INIT. |
| PTZ presets (`preset_<name>`) | Yes (preset custom value) | Yes (`ptz_argument`) | |
| PTZ relative move (`MOVE_RELATIVE_<pan>_<tilt>[_<zoom>]`) | Yes (relative custom value) | Partial | n8n exposes a free-text relative payload; HA passes through `ptz_argument`. |
| PTZ autotracker toggle (`ptz_autotracker/set`) | Yes (Set PTZ Autotracker) | Yes (`switch.<cam>_ptz_autotracker`) | |
| PTZ autotracker *state* read-back | Yes (trigger / Get Current Value) | Yes (switch state) | |
| PTZ autotracker *actively tracking* (`ptz_autotracker/active`) | Yes (trigger) | No | n8n exposes the live "is tracking right now" feed; not a dedicated HA entity. |
| PTZ command read-back / ack | No (fire-and-forget, no `/state`) | No | Frigate publishes no `/state` for `ptz`; both are fire-and-forget. |

### 4. Object & zone occupancy / counts

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Per-camera object count (`<cam>/<object>`) | Yes (Object Count - Camera) | Yes (`sensor.<cam>_<object>_count`) | n8n fires on change; HA holds the count as a sensor. |
| Per-camera active count (`<cam>/<object>/active`) | Yes (Active Object Count - Camera) | Yes (`sensor.<cam>_<object>_active_count`) | |
| Per-camera total count (`<cam>/all`) | Yes (All Object Count - Camera) | Partial | HA exposes per-object counts; "all" is reachable but not a single dedicated sensor in all versions. |
| Per-camera total active count (`<cam>/all/active`) | Yes (All Active Object Count - Camera) | Partial | As above. |
| Per-zone object count (`<zone>/<object>`) | Yes (Object Count - Zone) | Yes (zone `sensor` / `binary_sensor`) | |
| Per-zone active count (`<zone>/<object>/active`) | Yes (Active Object Count - Zone) | Yes | |
| Per-zone total / total active (`<zone>/all[/active]`) | Yes (All [Active] Object Count - Zone) | Partial | |
| Object occupancy as boolean (count > 0) | Partial (count value; derive in workflow) | Yes (`binary_sensor.<...>_occupancy`) | HA derives an occupancy boolean automatically; in n8n you compare the integer count yourself. |
| Subscribe to "any camera / any object" at once | Yes (blank field → `+` wildcard) | n/a | n8n's client-side `+`/`#` wildcard matching; HA pre-creates one entity per camera×object. |

### 5. Stats & availability

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Full server stats (`stats` = `/api/stats`) | Yes (Stats trigger, full object) | Yes (decomposed into many sensors) | n8n emits the whole stats object on each interval; HA splits it into FPS/CPU/GPU/temp/uptime/inference sensors. |
| Detection/process/skipped FPS | Partial (inside stats payload) | Yes (dedicated `sensor`s) | n8n exposes the data but not as separate metrics. |
| Detector inference speed (ms) | Partial (inside stats) | Yes (`DetectorSpeedSensor`) | |
| GPU load % | Partial (inside stats) | Yes (`GpuLoadSensor`) | |
| Coral/device temperature | Partial (inside stats) | Yes (`DeviceTempSensor`) | |
| Per-process CPU usage | Partial (inside stats) | Yes (`CameraProcessCpuSensor`) | |
| Per-camera FPS (capture/detect/process/skipped) | Partial (inside stats) | Yes (`CameraFpsSensor`) | |
| System uptime | Partial (inside stats) | Yes (`FrigateUptimeSensor`) | |
| Availability online/offline (`available`) | Yes (Availability trigger) | Yes (`FrigateStatusSensor`) | n8n receives `online`/`offline` as scalar events; HA reflects it as status. Note: `available` is MQTT-retained; over `/ws` it is broadcast, not retained. |
| Camera/role status (`<cam>/status/<role>`) | Yes (Camera/Role Status trigger) | No | online/offline/disabled per stream role; n8n-only dedicated trigger. |
| Review status (`<cam>/review_status`) | Yes (Review Status trigger) | Yes (`FrigateReviewStatusSensor`) | NONE/DETECTION/ALERT. |
| Audio level dBFS / RMS | Yes (Audio Level dBFS / RMS triggers) | Yes (`CameraSoundSensor` in dB) | |
| Custom classification model result (`<cam>/classification/<model>`, 0.16+) | Yes (Classification Model Result trigger) | Yes (`FrigateClassificationSensor`, 0.17+) | |

### 6. Snapshots & media

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Best-snapshot image push (`<cam>/<object>/snapshot`, binary JPEG) | Yes (Best Snapshot Image trigger; emitted as base64) | Yes (`image.<cam>_<object>` / older `camera` snapshot entity) | n8n delivers the raw JPEG bytes (base64) per push; HA renders it as an image entity. |
| Event clips / recordings browsing | No | Yes (Media Browser: events, snapshots, recordings, VOD HLS) | HA's `media_source` browses `vod/...`, `api/events`, recordings by month/day/hour. Out of scope for the `/ws` node. |
| Export a recording clip | No (not via `/ws`) | Yes (`frigate.export_recording`) | Uses Frigate HTTP API (`/api/export/...`), which this node does not call. Reachable from n8n's generic HTTP Request node, but not from this node. |
| Event preview GIF / thumbnail / clip URLs | No | Yes (notification proxy `/api/frigate/.../notifications/...`) | HA-specific unauthenticated proxy over Frigate's `/api/events/<id>/{thumbnail,snapshot,clip,preview}`. |
| Snapshot fetch by event id | No (not via `/ws`) | Yes (proxy + `media_source`) | HTTP-API territory, not `/ws`. |
| Create / end / favorite a manual event | No (not via `/ws`) | Yes (`create_event`/`end_event`/`favorite_event`) | Frigate HTTP API services; outside this node's `/ws` scope. |
| Review summarize (GenAI) | No | Yes (`frigate.review_summarize`, 0.17+) | HTTP API; not a `/ws` topic. |

### 7. Notifications

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Global notifications toggle (`notifications/set`) | Yes (Set Global Notifications) | via custom topic | Frigate exposes the global topic; HA does not always surface a dedicated global switch. |
| Per-camera notifications toggle (`<cam>/notifications/set`) | Yes (Set Per-Camera Notifications) | Partial | |
| Suspend per-camera notifications for N minutes (`notifications/suspend`) | Yes (Suspend Per-Camera Notifications) | No | n8n-only dedicated operation; read-back via `notifications/suspended`. |
| Global / per-camera notifications *state* read-back | Yes (triggers + Get Current Value) | Partial | |
| GenAI object descriptions toggle (`object_descriptions/set`, 0.16+) | Yes (Set Object Descriptions) | Yes (`switch.<cam>_object_descriptions`, 0.17+) | |
| GenAI review descriptions toggle (`review_descriptions/set`, 0.16+) | Yes (Set Review Descriptions) | Yes (`switch.<cam>_review_descriptions`, 0.17+) | |
| Review alerts toggle (`review_alerts/set`, 0.14+) | Yes (Set Review Alerts) | Yes (`switch.<cam>_review_alerts`) | |
| Review detections toggle (`review_detections/set`, 0.14+) | Yes (Set Review Detections) | Yes (`switch.<cam>_review_detections`) | |
| Audio transcription toggle (`audio_transcription/set`, 0.16+) | Yes (Set Audio Transcription) | No | n8n-only dedicated operation. |
| Audio transcription text feed (`<cam>/audio/transcription`) | Yes (Audio Transcription trigger) | No | |
| Mobile push notification delivery | No (delegate to other n8n nodes) | Yes (blueprint + HA mobile app) | HA's blueprint builds push notifications with media. In n8n you wire a Telegram/Pushover/email/etc. node after the Frigate trigger. |

### 8. Auth

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Unauthenticated trusted-internal (port 5000) | Yes (Auth Enabled = off) | Yes | |
| Authenticated port 8971 | Yes | Yes | |
| Username/password login → JWT | Yes (`POST /api/login`, caches JWT, re-login on 401) | Yes | n8n logs in inside the node because `/ws` is not a plain HTTP endpoint. |
| Pre-issued Bearer / JWT token | Yes (Bearer / JWT Token method) | Partial | HA typically uses its own configured auth; n8n accepts a raw JWT directly. |
| JWT as cookie *and* Authorization header | Yes (both sent on `/ws` upgrade + HTTP) | Yes | |
| Credential "Test" button | Yes (`GET /api/version`) | n/a (config flow validates at setup) | |
| Multiple Frigate instances | Yes (one credential per instance) | Yes (`topic_prefix`/`client_id` per instance) | |

### 9. Transport / protocol

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Primary real-time transport | Frigate WebSocket `/ws` | MQTT (`frigate/...`) | **Key difference.** n8n consumes the same broadcast feed as the Frigate web UI; HA requires an MQTT broker. |
| Requires an external MQTT broker | No | Yes | n8n needs only network access to Frigate's `/ws`. |
| HTTP API usage (`/api/stats`, `/api/events`, `vod/...`) | Only `/api/login` + `/api/version` | Yes (stats, events, recordings, export, faces, PTZ info, chat) | Media/history/management features ride on the HTTP API, which this node deliberately does not wrap. |
| `frigate/` topic prefix on the wire | Omitted (topics sent/received bare) | Present (MQTT `frigate/<...>`) | The node strips/ignores the prefix; matching is prefix-insensitive. |
| Wire envelope | `{topic, payload}` only, **no** `retain` field | MQTT message + retain flag | `retain` is MQTT-only; over `/ws` retained topics are simply re-broadcast. |
| Persistent connection with auto-reconnect | Yes (trigger: 1 socket, exponential backoff 5s→60s) | Yes (MQTT client) | Survives Frigate restarts and network drops. |
| Double-parse of nested JSON payloads | Yes (handled automatically) | n/a (HA parses per entity) | Structured topics carry a JSON string inside the envelope; the node `JSON.parse`es twice. |
| Heartbeat / handshake timeout handling | Yes (10s handshake timeout) | n/a | |

### 10. Extensibility / custom topics

| Capability | This n8n node | HA Frigate integration | Notes |
|---|---|---|---|
| Subscribe to an arbitrary `/ws` topic | Yes (Subscribe to Custom Topic) | Partial (raw HA `mqtt` trigger) | n8n matches client-side with `+`/`#`; in HA you'd add a manual `mqtt` trigger. |
| Publish to an arbitrary command topic | Yes (Publish to Custom Topic) | Partial (raw `mqtt.publish`) | n8n sends a bare `{topic, payload}` envelope. |
| Read the current/next value of any topic on demand | Yes (Get Current Value — subscribe once with timeout) | Partial (entity state read) | n8n opens `/ws`, waits for the next matching message, returns it, closes. |
| Forward-compatibility with new/unknown topics | Yes (custom topic ops cover anything not enumerated) | Partial (needs integration update for a new entity) | New Frigate topics work in n8n immediately via custom topic; HA generally needs a component release to expose a new entity. |
| MQTT-style wildcard matching (`+` single, `#` multi) | Yes (client-side) | Yes (broker-side, if using raw `mqtt`) | n8n filters the broadcast stream itself since `/ws` has no per-topic server subscribe. |

---

## When to use which

**Use the Home Assistant Frigate integration when:**

- You live in Home Assistant and want Frigate as **dashboards, entities, and history graphs** (Lovelace cards, the Frigate card, Logbook, History).
- You want **mobile push notifications with embedded snapshots/clips/GIFs** out of the box (SgtBatten blueprint + notification proxy).
- You need to **browse and cast clips/recordings** via the HA Media Browser, or export/favorite events.
- You want decomposed **performance sensors** (per-detector inference ms, GPU %, Coral temp, per-camera FPS) as individual entities you can graph and alert on.
- You already run an **MQTT broker** and a Home Assistant instance.

**Use `n8n-nodes-frigate` when:**

- You want **event-driven workflow automation**: "when Frigate sees a person on the driveway at night, do X, Y, Z" wired to *any* of n8n's 400+ integrations (Telegram, Slack, HTTP, databases, S3, GenAI, etc.).
- You want to **react to the raw lifecycle feeds** (`events`, `reviews`, `tracked_object_update`, `triggers`) as discrete executions with full `before`/`after` payloads — without writing MQTT plumbing.
- You **don't run an MQTT broker** (or don't want to) — the node talks directly to Frigate's `/ws`, the same feed the web UI uses.
- You need **fine-grained control operations** that HA doesn't expose as dedicated entities: zone/mask enable-disable, birdseye mode, notification suspend, audio transcription, autotracker "actively tracking" feed, per-role stream status.
- You want **forward-compatibility** with topics the node doesn't enumerate, via Subscribe/Publish-to-Custom-Topic.
- You want optional **synchronous confirmation** of a command (Await State Confirmation) inside the workflow.

**They are complementary, not mutually exclusive.** A common pattern: let HA own the dashboard/entity surface and mobile notifications, while n8n handles complex multi-system orchestration (e.g., cross-referencing a license plate against a database, posting to chat, triggering GenAI summaries, hitting external APIs).

---

## Notes & caveats

- **Transport, not feature parity, is the deepest difference.** HA's real-time data is MQTT (`frigate/...`); this node's is the WebSocket `/ws`. Both ultimately observe the same Frigate broadcasts, but the node needs **no MQTT broker**. Topics over `/ws` **omit** the `frigate/` prefix and carry **no `retain` field** (retain is MQTT-only) — the node handles this transparently.
- **Retained vs. broadcast.** Many `/state` and `available`/`notifications/state` topics are *retained* over MQTT, so an HA client gets the last value immediately on connect. Over `/ws` there is no retain; the node's **Get Current Value** operation works by waiting for the *next* broadcast of a topic within a timeout, which is reliable for read-backs that re-publish promptly but is not a guaranteed instant snapshot of a quiescent value.
- **HTTP-API features are intentionally out of scope for this node.** Clip/recording browsing, export, manual event create/end/favorite, review summarize, faces, and the notification media proxy all ride on Frigate's HTTP API. This node wraps only `/api/login` (for JWT) and `/api/version` (credential test). Those HTTP features are still reachable from n8n — just via the generic **HTTP Request** node, not via this Frigate node.
- **HA's notification proxy is HA-specific.** `/api/frigate/<client_id>/notifications/...` is a Home Assistant convenience that re-exposes Frigate's `/api/events/<id>/{thumbnail,snapshot,clip,preview}` (optionally unauthenticated). n8n would hit the Frigate backend endpoints directly.
- **HA pre-creates one entity per camera×object×feature; the node uses wildcards.** Leaving a placeholder field blank in the trigger becomes an MQTT-style `+` single-level wildcard, so one trigger can watch all cameras/objects/zones at once — no per-entity explosion, but also no pre-enumerated entity list.
- **"Partial" on stats rows** means the data *is* present (inside the full `stats` payload the node emits) but is not broken out into individual metrics the way HA's dedicated sensors are. You extract the field you need in the workflow.
- **Occupancy boolean** is derived for you in HA (`binary_sensor..._occupancy`); in n8n you compare the integer count yourself (e.g., `count > 0`).
- **Version dependencies apply to both.** Several topics/operations are gated on Frigate version: reviews and review toggles (0.14+), semantic-search triggers / audio transcription / classification / GenAI description toggles (0.16+), and some HA enrichment sensors/switches (0.17+). Availability depends on Frigate config (audio detection, recordings, ONVIF/PTZ, birdseye, `enabled` present in config, etc.).
- **Runtime-dependency caveat (this node).** `n8n-nodes-frigate` ships the `ws` package as a runtime dependency to maintain the persistent WebSocket. This is fully suitable for self-hosted/private n8n installs but **disqualifies the package from official n8n verification**; it is documented in the README. The HA integration has no bearing on this.
- **PTZ is fire-and-forget on both sides.** Frigate publishes no `/state` read-back for `ptz`, so neither integration can confirm a raw PTZ move (autotracker toggle, which does have a `/state`, can be confirmed).
