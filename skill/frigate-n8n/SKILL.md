---
name: frigate-n8n
description: Build Frigate NVR automations in n8n using the n8n-nodes-frigate community node (Frigate Trigger + Frigate action nodes over the /ws API) via MCP workflow-building tools. Use whenever asked to wire Frigate camera events, object/motion/zone detection, PTZ, recordings, snapshots, or notifications into an n8n workflow.
---

# Building Frigate Automations in n8n (n8n-nodes-frigate)

## When to use this skill

Use this skill when you are asked to build or edit an **n8n workflow** that talks to **Frigate** (the open-source NVR) using the **`n8n-nodes-frigate`** community node, especially when you are operating n8n through an MCP server (the `mcp__n8n-mcp__*` tools that search nodes, get type definitions, build/update/validate workflows). Typical requests: "turn on the porch light when Frigate sees a person at the front door", "disable recordings on a schedule", "point a PTZ camera at a preset when motion enters the driveway zone", "mute notifications while I'm home", "log every review alert to a sheet".

This package is a **community node** that ships `ws` as a runtime dependency (it holds a persistent WebSocket open). That disqualifies it from official n8n verification, so the instance must allow community/unverified nodes. If the MCP `search_nodes` call cannot find `frigateTrigger` / `frigate`, the package is not installed on that instance — say so rather than guessing.

## The two nodes + one credential

| Piece | Node name (n8n `type`) | Role |
|---|---|---|
| **Frigate Trigger** | `frigateTrigger` (group `trigger`) | Starts a workflow when Frigate publishes a matching topic on `/ws`. One persistent WebSocket, auto-reconnect with backoff. |
| **Frigate** | `frigate` (group `output`/action) | Performs an action: publish a `/set` topic, send a PTZ command, restart, publish a custom topic, or read the current value of a topic. Short-lived socket per execution. |
| **frigateApi** credential | `frigateApi` | Connection + auth for both nodes. |

Both nodes speak Frigate's WebSocket bus at `/ws`. The wire envelope is always exactly `{ "topic": "...", "payload": ... }` with **no `frigate/` prefix** and **no `retain` field** (retain is MQTT-only). Topics you supply must omit `frigate/` — write `events`, `front_door/detect/set`, `restart`.

### The frigateApi credential fields

- **Protocol**: `HTTP / WS` (`http`) -> `ws://`+`http://`, or `HTTPS / WSS (SSL)` (`https`) -> `wss://`+`https://`. Use HTTPS/WSS for the authenticated port when exposed externally.
- **Host**: hostname/IP, no scheme, no port (e.g. `frigate.local`, `192.168.1.10`).
- **Port**: `5000` = internal **unauthenticated** UI/API (default). `8971` = **authenticated** UI/API.
- **Path Prefix**: optional reverse-proxy sub-path (e.g. `/frigate`), prepended before `/ws` and `/api`. Blank for root.
- **Frigate Auth Enabled**: off = send no credentials (trusted-internal port 5000). On = authenticate (port 8971 / `auth.enabled: True`).
- **Authentication Method** (when auth enabled): `Username & Password (Login for JWT)` (`password`) — logs in to `/api/login` to mint a JWT; or `Bearer / JWT Token` (`token`) — uses a pre-issued JWT directly.
- **Username** / **Password** (password method) or **Bearer / JWT Token** (token method).

The JWT is sent as both `Authorization: Bearer <jwt>` and a `frigate_token` cookie on the `/ws` upgrade and HTTP calls. The credential's **Test** button hits `GET /api/version`.

## Wiring this up via MCP workflow-building tools

Follow the MCP server's required order. Concretely for Frigate:

1. `get_sdk_reference` (mandatory) and `get_suggested_nodes` for your technique categories.
2. `search_nodes` with queries like `["frigate trigger", "frigate"]` and any glue nodes (`["if", "switch", "set", "code", "http request"]`). Confirm the node IDs `frigateTrigger` and `frigate` come back.
3. `get_node_types` for **both** `frigateTrigger` and `frigate` to get exact parameter names (`event`, `operation`, `camera`, `value`, etc.) before writing code. Do not guess parameter names.
4. Build the workflow code. For the credential, after creating the workflow call `setNodeCredential` (via `update_workflow`) to attach a `frigateApi` credential to **each** Frigate node. The credential itself is created once in the n8n UI (or via `list_credentials` to find an existing `frigateApi` id) — MCP attaches an existing credential by id/name; it does not type in passwords.
5. `validate_workflow`, fix, re-validate, then `create_workflow_from_code` / `update_workflow`.

**Selecting the node**: set the node `type` to `frigateTrigger` or `frigate`. On the trigger, pick the topic via the `event` parameter (one of the catalog values below). On the action node, pick the `operation` parameter.

**Adding the credential via MCP**: use the `setNodeCredential` operation in `update_workflow`, referencing credential type `frigateApi`. If no `frigateApi` credential exists yet, instruct the user to create one in n8n (Credentials -> Frigate API) — host/port/auth — because secrets can't be set through workflow-building tools.

## QUICK-REFERENCE catalog

The trigger's `event` value **is** the topic template; blank placeholder fields become `+` wildcards (match-all for that level). The action's `operation` maps to a fixed `/set` topic. Full one-row-per-item tables are in `reference/events.md` and `reference/actions.md`.

### Trigger events (param `event`) — selected high-value rows

| event value | Topic | Payload shape | Placeholder fields |
|---|---|---|---|
| `events` | `events` | JSON `{type:new\|update\|end, before, after}` | — |
| `reviews` | `reviews` | JSON `{type, before, after}` (severity detection->alert) | — |
| `tracked_object_update` | `tracked_object_update` | JSON, discriminated by `type` (description/face/lpr/classification) | — |
| `triggers` | `triggers` | JSON `{name, camera, event_id, type, score}` | — |
| `stats` | `stats` | JSON full stats object | — |
| `available` | `available` | `'online'`/`'offline'` (retained) | — |
| `<camera>/<object>` | e.g. `front_door/person` | integer count | camera, object |
| `<camera>/<object>/active` | `.../active` | integer active count | camera, object |
| `<zone>/<object>` | e.g. `driveway/car` | integer count | zone, object |
| `<camera>/motion` | `front_door/motion` | `'ON'`/`'OFF'` (only non-retained state topic) | camera |
| `<camera>/<object>/snapshot` | best frame | **binary JPEG** -> base64 in `binary` field | camera, object |
| `<camera>/audio/<audio_type>` | e.g. `front_door/audio/speech` | `'ON'`/`'OFF'` | camera, audioType |
| `<camera>/detect/state` | detect read-back | `'ON'`/`'OFF'` (retained) | camera |
| `<camera>/review_status` | review status | `'NONE'`/`'DETECTION'`/`'ALERT'` | camera |
| `custom` | any topic/pattern | passthrough | `customTopic` (supports `+` / `#`) |

(46 events total — see `reference/events.md`.)

### Action operations (param `operation`) — selected high-value rows

| operation value | Topic | Key params | Read-back? |
|---|---|---|---|
| `setDetect` | `<camera>/detect/set` | camera, value(ON/OFF) | yes |
| `setRecordings` | `<camera>/recordings/set` | camera, value | yes |
| `setSnapshots` | `<camera>/snapshots/set` | camera, value | yes |
| `setMotion` | `<camera>/motion/set` | camera, value | yes |
| `setEnabled` | `<camera>/enabled/set` | camera, value | yes |
| `setMotionThreshold` | `<camera>/motion_threshold/set` | camera, numericValue | yes |
| `ptz` | `<camera>/ptz` | camera, ptzCommand (+ptzCustomValue) | **no** (fire-and-forget) |
| `setPtzAutotracker` | `<camera>/ptz_autotracker/set` | camera, value | yes |
| `setGlobalNotifications` | `notifications/set` | value | yes |
| `setCameraNotifications` | `<camera>/notifications/set` | camera, value | yes |
| `suspendNotifications` | `<camera>/notifications/suspend` | camera, minutes | yes |
| `setZone` | `<camera>/zone/<zone_name>/set` | camera, zoneName, value | yes |
| `setMotionMask` | `<camera>/motion_mask/<mask_name>/set` | camera, maskName, value | yes |
| `setBirdseyeMode` | `<camera>/birdseye_mode/set` | camera, birdseyeMode(CONTINUOUS/MOTION/OBJECTS) | yes |
| `restart` | `restart` | restartPayload(optional) | **no** |
| `publishCustom` | any | customTopic, customPayload | — |
| `getCurrentValue` | any (subscribe once) | customTopic, timeoutMs | reads one msg |

Toggle ops expose an optional **Await State Confirmation** (`awaitState` + `awaitTimeoutMs`) that keeps the socket open until the `/state` read-back confirms the change. `ptz` and `restart` have no read-back. (27 operations total — see `reference/actions.md`.)

## Canonical workflow recipes (trigger -> branch -> act)

Full descriptions an AI can translate into MCP calls are in `reference/recipes.md`. The core shape:

**Person at the front door -> turn on recordings:**

1. `frigateTrigger`, `event` = `events`, leave camera/object blank (or use `custom` with `front_door/person` for a lighter count-based filter).
2. `If` node: the trigger emits `payload` as a parsed object for `events`. Branch on `{{$json.payload.type}} === "new"` AND `{{$json.payload.after.label}} === "person"` AND `{{$json.payload.after.camera}} === "front_door"`.
3. `frigate`, `operation` = `setRecordings`, `camera` = `front_door`, `value` = `ON`.

Because the `events` feed fires on `new`, `update`, and `end`, **always filter on `payload.type`** so you don't act three times per object. For "only when it first appears", gate on `type === "new"`.

**Lighter alternative** — use the count topic instead of the full `events` feed: trigger `event` = `<camera>/<object>` with camera `front_door`, object `person`; `payload` is an integer; branch on `{{$json.payload}} > 0`. This fires only on count changes (cheaper, no JSON parsing).

## Common pitfalls

- **Filter the `events`/`reviews` feed.** They fire on `new`/`update`/`end`. Without a `type === "new"` filter you act repeatedly. Reviews also escalate `detection -> alert`; gate on `payload.after.severity` if you only want alerts.
- **Double-parse is already done.** The trigger parses the outer envelope and the nested JSON string, so `$json.payload` for structured topics is a real object — do not `JSON.parse` it again. Scalar topics give a string/number; the snapshot topic gives base64 in `$json.binary` (not `payload`).
- **No `frigate/` prefix, ever.** Over `/ws` topics omit it. Write `front_door/detect/set`, not `frigate/front_door/detect/set`.
- **`ws` vs `wss` follows Protocol.** `http` -> `ws://`, `https` -> `wss://`. Port `5000` is unauthenticated (Auth Enabled off); port `8971` is authenticated (Auth Enabled on). Mixing wss with port 5000, or sending no auth to 8971, fails the handshake.
- **JWT/auth.** Password method logs in to `/api/login` each connect and on 401; a stale pre-issued bearer token will eventually 401 — prefer the password method for long-lived triggers. If the credential Test (`GET /api/version`) passes but `/ws` fails, the WebSocket upgrade is being blocked by a proxy — check the Path Prefix and that the proxy forwards `Upgrade` headers.
- **Camera / zone / object are placeholders.** Substitute real configured names. On the trigger, leaving a placeholder blank makes it a `+` wildcard (all cameras/objects/zones); on the action node `camera` is **required** and must be a real camera.
- **Retained vs non-retained.** `/state` read-backs and `available` are retained (MQTT) — but over `/ws` you only see them when they're (re)published, so `getCurrentValue` may time out if nothing has changed since connect. `<camera>/motion` is the one non-retained state topic. PTZ and restart publish nothing back.
- **Keep the trigger alive.** The trigger holds one persistent socket and reconnects with backoff (5s -> 60s cap) across Frigate restarts/network drops. Don't add a second always-on trigger to the same instance unnecessarily. The in-editor "listen for test event" opens a short-lived socket with a 30s timeout and needs a matching event to actually fire during that window.
- **Zones are addressed by zone name, not camera-prefixed**, in the count topics (`<zone>/<object>`). But the **Set Zone action** toggles a zone *on a camera* (`<camera>/zone/<zone_name>/set`).
- **Birdseye is per-camera** — there is no global birdseye topic. Disabling motion fails while detect is enabled. Enabling detect also enables motion.

## Glossary

- **events** (`frigate/events`): the tracked-object lifecycle feed. One object's life: `new` (confirmed, no longer false positive) -> `update` (better snapshot, zone/attribute change) -> `end`. The richest payload (label, zones, scores, snapshot box, speed, plate, etc.).
- **reviews** (`frigate/reviews`, 0.14+): higher-level "review items" that group detections into `detection` or `alert` severity for the UI's review timeline. Coarser than events.
- **tracked_object_update** (`frigate/tracked_object_update`): GenAI/recognition results attached to an existing tracked object — `description`, `face`, `lpr` (license plate), or `classification` — discriminated by `type`.
- **triggers** (`frigate/triggers`, 0.16+): a semantic-search trigger matched a tracked object.
- **zone**: a user-drawn polygon on a camera. Objects report `current_zones`/`entered_zones`; per-zone count topics exist; zones can be toggled on/off per camera.
- **object / label**: the detected class (`person`, `car`, `dog`, ...). Count topics are per object label, per camera or per zone, with `/active` variants for non-stationary objects.
- **active vs stationary**: an "active" object is moving; counts have `/active` variants. Motion has an off-delay (default 30s) before `OFF`.
- **/set vs /state**: you publish to `<feature>/set`; Frigate echoes the applied value on `<feature>/state` (the read-back). The action node can optionally await that read-back.
