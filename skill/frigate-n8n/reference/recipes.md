# Frigate + n8n workflow recipes

Each recipe is a full node-by-node description an AI can translate directly into MCP `create_workflow_from_code` / `update_workflow` calls. All Frigate nodes use the same `frigateApi` credential — attach it with `setNodeCredential` (credential type `frigateApi`) on every Frigate node. Replace `front_door`, `driveway`, `person`, `preset_door` with the user's real names.

Reminders that apply to every recipe:
- Topics omit the `frigate/` prefix.
- The `events` and `reviews` feeds fire on `new`/`update`/`end` — always filter on `payload.type`.
- `$json.payload` for JSON topics is already a parsed object; scalar topics give a string/number. Snapshots are **not** delivered over `/ws` (Frigate publishes them only over MQTT) — fetch images via the HTTP API (`/api/events/<id>/snapshot.jpg`).

---

## Recipe 1 — Person at the front door turns on recordings (and notifies)

**Goal:** when a *new* person is tracked on `front_door`, enable recordings and send a chat message.

1. **Frigate Trigger** (`frigateTrigger`)
   - `event` = `events` (leave camera/object blank — we filter in the next node).
2. **If** node — branch true only on a brand-new person on the right camera:
   - Condition 1: `{{$json.payload.type}}` equals `new`
   - Condition 2: `{{$json.payload.after.label}}` equals `person`
   - Condition 3: `{{$json.payload.after.camera}}` equals `front_door`
   - Combine with AND.
3. **Frigate** (`frigate`) on the true branch:
   - `operation` = `setRecordings`, `camera` = `front_door`, `value` = `ON`.
   - Optionally `awaitState` = true to confirm via the `<camera>/recordings/state` read-back.
4. **(optional) Notification node** (Slack/Telegram/Email): message e.g. `Person at front door (score {{$json.payload.after.top_score}})`.

**Lighter variant (no JSON):** replace the trigger + If with a single `frigateTrigger` where `event` = `<camera>/<object>`, `camera` = `front_door`, `object` = `person`; then an `If` on `{{$json.payload}} > 0`. The count topic fires only on changes and needs no parsing.

---

## Recipe 2 — Car enters the driveway zone -> point PTZ camera at a preset

**Goal:** when a car appears in the `driveway` zone, move the ONVIF PTZ camera `yard_cam` to `preset_driveway`.

1. **Frigate Trigger** (`frigateTrigger`)
   - `event` = `<zone>/<object>`, `zone` = `driveway`, `object` = `car`. Payload is an integer count.
2. **If** node: `{{$json.payload}}` greater than `0` (a car is currently in the zone).
3. **Frigate** (`frigate`) on true:
   - `operation` = `ptz`, `camera` = `yard_cam`, `ptzCommand` = `Preset (Use Custom Value)` (`preset`), `ptzCustomValue` = `preset_driveway`.
   - Note: PTZ is fire-and-forget — there is no `/state` read-back, so leave `awaitState` off.
4. **(optional) Frigate** second action: `operation` = `setRecordings`, `camera` = `yard_cam`, `value` = `ON`.

Requires `onvif` configured for `yard_cam` in Frigate.

---

## Recipe 3 — Quiet hours: mute notifications at night, restore in the morning

**Goal:** at 22:00 disable global notifications; at 07:00 re-enable them. (Two schedules in one workflow, or two workflows.)

1. **Schedule Trigger** A — cron at 22:00 daily.
   - **Frigate** (`frigate`): `operation` = `setGlobalNotifications`, `value` = `OFF`. Optionally `awaitState` = true (read-back `notifications/state`).
2. **Schedule Trigger** B — cron at 07:00 daily.
   - **Frigate** (`frigate`): `operation` = `setGlobalNotifications`, `value` = `ON`.

**Per-camera, time-boxed variant:** use `operation` = `suspendNotifications`, `camera` = `front_door`, `minutes` = `480` to suspend a single camera for 8 hours from a single trigger (read-back `<camera>/notifications/suspended` returns the UNIX timestamp until which it's suspended).

---

## Recipe 4 — Review alert -> capture the best snapshot and log it

**Goal:** on every review item that escalates to `alert`, read the camera's current detect state and append a row to a sheet/DB; optionally forward the best snapshot image.

1. **Frigate Trigger** (`frigateTrigger`)
   - `event` = `reviews`. Payload is `{ type, before, after }`.
2. **If** node — only act on alerts:
   - Condition 1: `{{$json.payload.after.severity}}` equals `alert`
   - Condition 2: `{{$json.payload.type}}` equals `new` (or `end`, depending on whether you want the start or completion of the review).
3. **Set / Edit Fields** node — flatten the fields you want to store:
   - `camera` = `{{$json.payload.after.camera}}`
   - `objects` = `{{$json.payload.after.data.objects}}`
   - `zones` = `{{$json.payload.after.data.zones}}`
   - `start` = `{{$json.payload.after.start_time}}`
4. **(optional) Frigate** (`frigate`): `operation` = `getCurrentValue` (Wait for Next Topic Value), `customTopic` = `{{$json.camera}}/detect/state`, `timeoutMs` = `3000` to record whether detection changes during the window. Note: `/ws` does not replay current/retained state, so this returns only the *next* publish of the topic and times out if it stays unchanged.
5. **Google Sheets / Postgres / HTTP Request** node — append the row.

**Snapshot variant:** snapshots are **not** available over `/ws` (Frigate publishes snapshot bytes only over MQTT — the `/ws` communicator drops binary payloads). Fetch the image over the HTTP API instead: add an **HTTP Request** node hitting `http://<host>:5000/api/events/{{$json.payload.after.id}}/snapshot.jpg` (or `/api/<camera>/<label>/snapshot.jpg` for the latest best snapshot) and use its binary output before emailing or uploading it.

---

## Notes for translating to MCP calls

- Always `get_node_types` for `frigateTrigger` and `frigate` first to confirm parameter names (`event`, `operation`, `camera`, `value`, `motionThreshold`, `motionContourArea`, `minutes`, `birdseyeMode`, `ptzCommand`, `ptzCustomValue`, `maskName`, `zoneName`, `customTopic`, `customPayload`, `timeoutMs`, `awaitState`, `awaitTimeoutMs`).
- The trigger node has no input; it is the workflow start node. The action node has one main input and one main output.
- For the `events`/`reviews`/`tracked_object_update` feeds, expression paths start at `$json.payload.` (the payload is the parsed object). For count/state topics, the value is `$json.payload` directly.
- Attach the `frigateApi` credential to every Frigate node via `setNodeCredential`; create the credential in the n8n UI if `list_credentials` shows none of type `frigateApi`.
