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

function normalizePrefix(pathPrefix?: string): string {
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
 * Set-Cookie header (frigate_token=...) or in the response body.
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
		throw new Error(
			`Frigate login failed with status ${response.statusCode}. Check the configured username/password.`,
		);
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

	throw new Error('Frigate login succeeded but no JWT could be extracted from the response.');
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
 * on HTTP calls. Returns an empty object when auth is disabled.
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
	} else {
		token = await frigateLogin(context, credentials);
	}

	if (!token) {
		return {};
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
	if (cleanPattern === '#' || cleanPattern === '') {
		return true;
	}

	const patternParts = cleanPattern.split('/');
	const topicParts = cleanTopic.split('/');

	for (let i = 0; i < patternParts.length; i++) {
		const p = patternParts[i];
		if (p === '#') {
			// Multi-level wildcard matches the remainder (including zero levels).
			return true;
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
 * time. Scalar strings/numbers pass through. Binary payloads (e.g. the snapshot
 * topic) are emitted as a base64 string in `binary`.
 */
export function parseInboundMessage(data: WebSocket.RawData, isBinary: boolean): IFrigateMessage | undefined {
	if (isBinary && Buffer.isBuffer(data)) {
		// A purely-binary frame with no JSON envelope (rare). Emit as base64.
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
 * Normalize a payload value. JSON-encoded strings are parsed; everything else
 * passes through unchanged.
 */
export function normalizePayload(rawPayload: unknown): unknown {
	if (typeof rawPayload === 'string') {
		const trimmed = rawPayload.trim();
		if (
			(trimmed.startsWith('{') && trimmed.endsWith('}')) ||
			(trimmed.startsWith('[') && trimmed.endsWith(']'))
		) {
			try {
				return JSON.parse(trimmed);
			} catch {
				return rawPayload;
			}
		}
	}
	return rawPayload;
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
			resolve(ws);
		};

		ws.once('open', onOpen);
		ws.once('error', onError);
	});
}

/**
 * Publish a single envelope over a (short-lived) ws connection, then close it.
 * Fire-and-forget: resolves as soon as the frame has been flushed to the socket.
 */
export async function publishEnvelope(
	wsUrl: string,
	headers: IDataObject,
	topic: string,
	payload: unknown,
): Promise<void> {
	const ws = await openSocket(wsUrl, headers);
	const message = JSON.stringify(buildEnvelope(topic, payload));
	try {
		await new Promise<void>((resolve, reject) => {
			// A post-open 'error' event with no listener crashes the process, so
			// always handle it here.
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
	} finally {
		ws.close();
	}
}

/**
 * Open a ws connection, publish an envelope, then wait for the first inbound
 * message whose topic matches `awaitTopic` (up to timeoutMs). Returns the parsed
 * message or undefined on timeout. Used for "Await State Confirmation".
 */
export async function publishAndAwaitState(
	wsUrl: string,
	headers: IDataObject,
	topic: string,
	payload: unknown,
	awaitTopic: string,
	timeoutMs: number,
): Promise<IFrigateMessage | undefined> {
	const ws = await openSocket(wsUrl, headers);

	const result = await new Promise<IFrigateMessage | undefined>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve(undefined);
		}, timeoutMs);

		const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
			const parsed = parseInboundMessage(data, isBinary);
			if (parsed && topicMatches(awaitTopic, parsed.topic)) {
				cleanup();
				resolve(parsed);
			}
		};

		// A post-open 'error' event with no listener crashes the process.
		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const cleanup = () => {
			clearTimeout(timer);
			ws.removeListener('message', onMessage);
			ws.removeListener('error', onError);
		};

		ws.on('message', onMessage);
		ws.once('error', onError);

		// Publish after listeners are attached so we don't miss a fast read-back.
		ws.send(JSON.stringify(buildEnvelope(topic, payload)), (err) => {
			if (err) {
				onError(err);
			}
		});
	}).finally(() => {
		ws.close();
	});

	return result;
}

/**
 * Open a ws connection and resolve the first inbound message matching the given
 * topic (up to timeoutMs), then close. Used for "Get current value". Does not
 * publish anything – it only listens for the next broadcast of that topic.
 */
export async function subscribeOnce(
	wsUrl: string,
	headers: IDataObject,
	awaitTopic: string,
	timeoutMs: number,
): Promise<IFrigateMessage | undefined> {
	const ws = await openSocket(wsUrl, headers);

	const result = await new Promise<IFrigateMessage | undefined>((resolve, reject) => {
		const timer = setTimeout(() => {
			cleanup();
			resolve(undefined);
		}, timeoutMs);

		const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
			const parsed = parseInboundMessage(data, isBinary);
			if (parsed && topicMatches(awaitTopic, parsed.topic)) {
				cleanup();
				resolve(parsed);
			}
		};

		// A post-open 'error' event with no listener crashes the process.
		const onError = (err: Error) => {
			cleanup();
			reject(err);
		};

		const cleanup = () => {
			clearTimeout(timer);
			ws.removeListener('message', onMessage);
			ws.removeListener('error', onError);
		};

		ws.on('message', onMessage);
		ws.once('error', onError);
	}).finally(() => {
		ws.close();
	});
	return result;
}
