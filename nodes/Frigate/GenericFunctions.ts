import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ITriggerFunctions,
} from 'n8n-workflow';

import WebSocket from 'ws';

/**
 * The shape of the credentials declared by FrigateApi.credentials.ts.
 */
export interface IFrigateCredentials {
	protocol: 'http' | 'https';
	host: string;
	port: number;
	pathPrefix?: string;
	authEnabled?: boolean;
	authMethod?: 'password' | 'token';
	username?: string;
	password?: string;
	token?: string;
}

/**
 * A normalized, parsed Frigate /ws message ready to be emitted as an n8n item.
 */
export interface IFrigateMessage {
	topic: string;
	payload: unknown;
	raw: string;
	binary?: string;
}

/**
 * The raw envelope as it is sent over the /ws wire. There is intentionally NO
 * `retain` field – that is an MQTT-only concept and never appears on the wire.
 */
export interface IFrigateEnvelope {
	topic: string;
	payload: unknown;
}

/**
 * Thrown for non-recoverable authentication/credential problems (a blank token,
 * blank username/password, or a 400/401/403 from /api/login). Callers use this
 * to fail fast instead of retrying a login that can never succeed (which would
 * otherwise hammer Frigate's /api/login endpoint).
 */
export class FrigateAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FrigateAuthError';
	}
}

/**
 * Build the ws:// or wss:// /ws URL from credentials.
 */
export function buildWsUrl(credentials: IFrigateCredentials): string {
	const scheme = credentials.protocol === 'https' ? 'wss' : 'ws';
	const prefix = normalizePrefix(credentials.pathPrefix);
	return `${scheme}://${credentials.host}:${credentials.port}${prefix}/ws`;
}

/**
 * Build the http:// or https:// base URL from credentials.
 */
export function buildHttpBase(credentials: IFrigateCredentials): string {
	const scheme = credentials.protocol === 'https' ? 'https' : 'http';
	const prefix = normalizePrefix(credentials.pathPrefix);
	return `${scheme}://${credentials.host}:${credentials.port}${prefix}`;
}

export function normalizePrefix(pathPrefix?: string): string {
	if (!pathPrefix) {
		return '';
	}
	let prefix = pathPrefix.trim();
	if (prefix === '' || prefix === '/') {
		return '';
	}
	if (!prefix.startsWith('/')) {
		prefix = `/${prefix}`;
	}
	// Strip a trailing slash so we don't end up with a double slash.
	if (prefix.endsWith('/')) {
		prefix = prefix.slice(0, -1);
	}
	return prefix;
}

/**
 * Perform a login against /api/login to obtain a JWT. Returns the bare token
 * string (without the "Bearer " prefix). The token is returned either in the
 * Set-Cookie header (frigate_token=...) or in the response body. Throws a
 * FrigateAuthError on a credential rejection so callers do not retry forever.
 */
export async function frigateLogin(
	context: IExecuteFunctions | ITriggerFunctions,
	credentials: IFrigateCredentials,
): Promise<string> {
	const httpBase = buildHttpBase(credentials);
	const options: IHttpRequestOptions = {
		method: 'POST' as IHttpRequestMethods,
		url: `${httpBase}/api/login`,
		body: {
			user: credentials.username,
			password: credentials.password,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};

	const response = (await context.helpers.httpRequest(options)) as {
		statusCode?: number;
		headers?: IDataObject;
		body?: unknown;
	};

	if (response.statusCode && response.statusCode >= 400) {
		// 400/401/403 mean the credentials are wrong – retrying cannot fix them.
		if ([400, 401, 403].includes(response.statusCode)) {
			throw new FrigateAuthError(
				`Frigate login was rejected (HTTP ${response.statusCode}). Check the configured username/password.`,
			);
		}
		// Other statuses (e.g. 5xx) may be transient.
		throw new Error(`Frigate login failed with status ${response.statusCode}.`);
	}

	// Prefer a token returned in the body.
	const body = response.body as IDataObject | string | undefined;
	if (body && typeof body === 'object') {
		const bodyToken =
			(body.access_token as string) ?? (body.token as string) ?? (body.jwt as string);
		if (bodyToken) {
			return bodyToken;
		}
	}
	if (typeof body === 'string' && body.length > 0 && body.split('.').length === 3) {
		return body;
	}

	// Fall back to the Set-Cookie header.
	const headers = response.headers ?? {};
	const rawCookie = headers['set-cookie'] ?? headers['Set-Cookie'];
	const cookieToken = extractFrigateToken(rawCookie);
	if (cookieToken) {
		return cookieToken;
	}

	throw new FrigateAuthError(
		'Frigate login succeeded but no JWT could be extracted from the response.',
	);
}

function extractFrigateToken(rawCookie: unknown): string | undefined {
	if (!rawCookie) {
		return undefined;
	}
	const cookies = Array.isArray(rawCookie) ? rawCookie : [String(rawCookie)];
	for (const cookie of cookies) {
		const match = /frigate_token=([^;]+)/.exec(String(cookie));
		if (match) {
			return match[1];
		}
	}
	return undefined;
}

/**
 * Resolve the auth headers (and cookie) to apply on the /ws upgrade request and
 * on HTTP calls. Returns an empty object when auth is disabled, and throws a
 * FrigateAuthError when auth is enabled but the required fields are missing or
 * the login is rejected (so an explicitly-enabled auth never silently no-ops).
 */
export async function buildAuthHeaders(
	context: IExecuteFunctions | ITriggerFunctions,
	credentials: IFrigateCredentials,
): Promise<IDataObject> {
	if (!credentials.authEnabled) {
		return {};
	}

	let token: string | undefined;
	if (credentials.authMethod === 'token') {
		token = credentials.token;
		if (!token) {
			throw new FrigateAuthError(
				'Frigate auth is enabled with the Bearer/JWT method, but no token was provided in the credential.',
			);
		}
	} else {
		if (!credentials.username || !credentials.password) {
			throw new FrigateAuthError(
				'Frigate auth is enabled with the username/password method, but the username or password is empty.',
			);
		}
		token = await frigateLogin(context, credentials);
	}

	if (!token) {
		throw new FrigateAuthError('Frigate auth is enabled but no JWT could be obtained.');
	}

	return {
		Authorization: `Bearer ${token}`,
		Cookie: `frigate_token=${token}`,
	};
}

/**
 * Build the /ws message envelope. The wire format has exactly two fields:
 * { topic, payload }. There is deliberately no `retain` field (MQTT only).
 */
export function buildEnvelope(topic: string, payload: unknown): IFrigateEnvelope {
	return { topic, payload };
}

/**
 * Resolve a topic template by substituting placeholder segments. Empty/undefined
 * replacement values cause the corresponding placeholder to be left untouched so
 * the caller can detect missing required fields.
 */
export function resolveTopicTemplate(
	template: string,
	replacements: Record<string, string | undefined>,
): string {
	let resolved = template;
	for (const [key, value] of Object.entries(replacements)) {
		if (value === undefined || value === '') {
			continue;
		}
		resolved = resolved.split(`<${key}>`).join(value);
	}
	return resolved;
}

/**
 * Match an inbound topic against a subscription pattern, supporting MQTT-style
 * '+' (single level) and '#' (multi level) wildcards. An exact string also
 * matches. The leading 'frigate/' prefix is ignored on either side because /ws
 * topics omit it.
 */
export function topicMatches(pattern: string, topic: string): boolean {
	const cleanPattern = stripPrefix(pattern);
	const cleanTopic = stripPrefix(topic);

	if (cleanPattern === cleanTopic) {
		return true;
	}
	if (cleanPattern === '#') {
		return true;
	}
	// An empty pattern matches nothing. Callers validate and reject blank topics
	// up front; this guard prevents a stray '' from becoming a match-everything.
	if (cleanPattern === '') {
		return false;
	}

	const patternParts = cleanPattern.split('/');
	const topicParts = cleanTopic.split('/');

	for (let i = 0; i < patternParts.length; i++) {
		const p = patternParts[i];
		if (p === '#') {
			// '#' is a multi-level wildcard only as the final segment (MQTT rule).
			// A non-terminal '#' is malformed and matches nothing.
			return i === patternParts.length - 1;
		}
		if (i >= topicParts.length) {
			return false;
		}
		if (p === '+') {
			continue;
		}
		if (p !== topicParts[i]) {
			return false;
		}
	}

	return patternParts.length === topicParts.length;
}

function stripPrefix(topic: string): string {
	return topic.startsWith('frigate/') ? topic.slice('frigate/'.length) : topic;
}

/**
 * Parse a raw inbound /ws frame into a normalized message. Structured payloads
 * are JSON-encoded strings nested in the envelope, so they are parsed a second
 * time. Scalar strings/numbers pass through. Binary frames (which Frigate's /ws
 * does not actually emit – the snapshot bytes only go to MQTT – but which a
 * proxy could theoretically deliver) are surfaced as base64 in `binary`.
 */
export function parseInboundMessage(
	data: WebSocket.RawData,
	isBinary: boolean,
): IFrigateMessage | undefined {
	if (isBinary && Buffer.isBuffer(data)) {
		return {
			topic: '',
			payload: null,
			raw: '',
			binary: data.toString('base64'),
		};
	}

	const raw = data.toString();
	let envelope: IFrigateEnvelope;
	try {
		envelope = JSON.parse(raw) as IFrigateEnvelope;
	} catch {
		// Not JSON at all – surface the raw string.
		return { topic: '', payload: raw, raw };
	}

	const topic = typeof envelope.topic === 'string' ? envelope.topic : '';
	const rawPayload = envelope.payload;

	return {
		topic,
		payload: normalizePayload(rawPayload),
		raw,
	};
}

/**
 * Normalize a payload value. A string payload is JSON-parsed so that primitive
 * payloads keep their native type: '123' -> 123, 'true' -> true, '10.5' -> 10.5,
 * and '{...}'/'[...]' -> object/array. Non-JSON text (e.g. 'ON', 'online') fails
 * the parse and is returned unchanged as a string. Non-strings pass through.
 */
export function normalizePayload(rawPayload: unknown): unknown {
	if (typeof rawPayload !== 'string') {
		return rawPayload;
	}
	const trimmed = rawPayload.trim();
	if (trimmed === '') {
		return rawPayload;
	}
	try {
		return JSON.parse(trimmed);
	} catch {
		return rawPayload;
	}
}

/**
 * Open a ws connection with the supplied auth headers and resolve once it is
 * open. Rejects on error before the open event.
 */
export function openSocket(wsUrl: string, headers: IDataObject): Promise<WebSocket> {
	return new Promise<WebSocket>((resolve, reject) => {
		const ws = new WebSocket(wsUrl, {
			headers: headers as Record<string, string>,
			handshakeTimeout: 10000,
		});

		const onError = (err: Error) => {
			ws.removeListener('open', onOpen);
			reject(err);
		};
		const onOpen = () => {
			ws.removeListener('error', onError);
			// Keep a permanent no-op 'error' listener attached for the life of the
			// socket. Under ws v8 an 'error' event with zero listeners is re-thrown
			// as an uncaught exception (crashing the worker process); this can happen
			// on an abnormal teardown AFTER callers have removed their own handler and
			// called close(). This guard ensures there is always at least one listener.
			ws.on('error', () => {});
			resolve(ws);
		};

		ws.once('open', onOpen);
		ws.once('error', onError);
	});
}

/**
 * Attach a one-shot listener to an already-open socket that resolves the first
 * inbound message whose topic matches `awaitTopic` (or undefined on timeout).
 * Optionally runs `onReady` (e.g. to publish a frame) after the listeners are
 * attached so a fast read-back is not missed. Always detaches its own listeners
 * on settle, leaving the socket's permanent no-op error guard in place.
 */
function waitForMatch(
	ws: WebSocket,
	awaitTopic: string,
	timeoutMs: number,
	onReady?: () => void,
): Promise<IFrigateMessage | undefined> {
	return new Promise<IFrigateMessage | undefined>((resolve, reject) => {
		let settled = false;
		const finish = (action: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			ws.removeListener('message', onMessage);
			ws.removeListener('error', onError);
			action();
		};

		const timer = setTimeout(() => finish(() => resolve(undefined)), timeoutMs);

		const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
			const parsed = parseInboundMessage(data, isBinary);
			if (parsed && topicMatches(awaitTopic, parsed.topic)) {
				finish(() => resolve(parsed));
			}
		};
		const onError = (err: Error) => finish(() => reject(err));

		ws.on('message', onMessage);
		ws.once('error', onError);

		if (onReady) {
			onReady();
		}
	});
}

/**
 * A single multiplexed /ws connection reused across every item of one node
 * execution. Opening one socket for the whole batch (instead of one per item)
 * avoids connection thrashing / ephemeral-port exhaustion, and closing it once
 * at the end (rather than after each publish) removes the publish-then-close
 * truncation race. The socket is lazily (re)opened, so a mid-batch drop is
 * recovered transparently on the next operation.
 */
export class FrigateWsSession {
	private ws?: WebSocket;

	constructor(
		private readonly wsUrl: string,
		private readonly headers: IDataObject,
	) {}

	private async getSocket(): Promise<WebSocket> {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			return this.ws;
		}
		this.ws = await openSocket(this.wsUrl, this.headers);
		return this.ws;
	}

	/** Publish one envelope and resolve once the frame is flushed to the socket. */
	async publish(topic: string, payload: unknown): Promise<void> {
		const ws = await this.getSocket();
		const message = JSON.stringify(buildEnvelope(topic, payload));
		await new Promise<void>((resolve, reject) => {
			const onError = (err: Error) => {
				ws.removeListener('error', onError);
				reject(err);
			};
			ws.once('error', onError);
			ws.send(message, (err) => {
				ws.removeListener('error', onError);
				if (err) {
					reject(err);
				} else {
					resolve();
				}
			});
		});
	}

	/** Publish an envelope, then wait for the first matching read-back (or timeout). */
	async publishAndAwait(
		topic: string,
		payload: unknown,
		awaitTopic: string,
		timeoutMs: number,
	): Promise<IFrigateMessage | undefined> {
		const ws = await this.getSocket();
		const message = JSON.stringify(buildEnvelope(topic, payload));
		return waitForMatch(ws, awaitTopic, timeoutMs, () => {
			ws.send(message, (err) => {
				if (err) {
					// Surface the send failure through the same 'error' path waitForMatch
					// is listening on, so the operation rejects instead of hanging.
					ws.emit('error', err);
				}
			});
		});
	}

	/** Wait for the next broadcast of a topic (does not publish). */
	async subscribeOnce(
		awaitTopic: string,
		timeoutMs: number,
	): Promise<IFrigateMessage | undefined> {
		const ws = await this.getSocket();
		return waitForMatch(ws, awaitTopic, timeoutMs);
	}

	/** Close the multiplexed socket, flushing any buffered frame first. */
	async close(): Promise<void> {
		const ws = this.ws;
		this.ws = undefined;
		if (!ws) {
			return;
		}
		// Give a buffered final frame a moment to flush so the close handshake does
		// not truncate it on a slow link.
		if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > 0) {
			await new Promise((r) => setTimeout(r, 50));
		}
		ws.removeAllListeners();
		// removeAllListeners() drops the no-op guard; re-add one so a post-close
		// 'error' is not re-thrown as an uncaught exception.
		ws.on('error', () => {});
		ws.close();
	}
}
