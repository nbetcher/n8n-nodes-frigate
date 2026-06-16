import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class FrigateApi implements ICredentialType {
	name = 'frigateApi';

	displayName = 'Frigate API';

	documentationUrl = 'https://docs.frigate.video/integrations/mqtt/';

	properties: INodeProperties[] = [
		{
			displayName: 'Protocol',
			name: 'protocol',
			type: 'options',
			options: [
				{
					name: 'HTTP / WS',
					value: 'http',
				},
				{
					name: 'HTTPS / WSS (SSL)',
					value: 'https',
				},
			],
			default: 'http',
			description:
				"Transport scheme. 'http' uses ws:// for the WebSocket and http:// for the HTTP base; 'https' uses wss:// and https://. Use HTTPS/WSS for the authenticated port 8971 when exposed externally.",
		},
		{
			displayName: 'Host',
			name: 'host',
			type: 'string',
			default: 'localhost',
			placeholder: 'frigate.local or 192.168.1.10',
			required: true,
			description: 'Hostname or IP of the Frigate server (no scheme, no port)',
		},
		{
			displayName: 'Port',
			name: 'port',
			type: 'number',
			default: 5000,
			description:
				'Frigate port. 5000 = internal unauthenticated UI/API. 8971 = authenticated UI/API (recommended when exposed externally).',
		},
		{
			displayName: 'Path Prefix',
			name: 'pathPrefix',
			type: 'string',
			default: '',
			placeholder: '/frigate',
			description:
				'Optional base path prefix if Frigate is served behind a reverse proxy under a sub-path. Prepended before /ws and /api. Leave blank for a root deployment.',
		},
		{
			displayName: 'Frigate Auth Enabled',
			name: 'authEnabled',
			type: 'boolean',
			default: false,
			description:
				'Whether to send credentials. Enable when connecting to an authenticated Frigate (port 8971 / auth.enabled: True). When off, no credentials are sent (port 5000 trusted-internal access).',
		},
		{
			displayName: 'Authentication Method',
			name: 'authMethod',
			type: 'options',
			options: [
				{
					name: 'Username & Password (Login for JWT)',
					value: 'password',
				},
				{
					name: 'Bearer / JWT Token',
					value: 'token',
				},
			],
			default: 'password',
			displayOptions: {
				show: {
					authEnabled: [true],
				},
			},
			description:
				"How to authenticate. 'Username & Password' performs a login against /api/login to obtain a JWT. 'Bearer / JWT Token' uses a pre-issued JWT directly.",
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: 'admin',
			displayOptions: {
				show: {
					authEnabled: [true],
					authMethod: ['password'],
				},
			},
			description:
				'Frigate username (the default admin user is auto-generated on first startup and printed to the logs)',
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			displayOptions: {
				show: {
					authEnabled: [true],
					authMethod: ['password'],
				},
			},
			description:
				'Frigate password. Used to obtain a JWT via /api/login; the JWT is then sent as a cookie/Authorization header on /ws and /api.',
		},
		{
			displayName: 'Bearer / JWT Token',
			name: 'token',
			type: 'string',
			typeOptions: {
				password: true,
			},
			default: '',
			displayOptions: {
				show: {
					authEnabled: [true],
					authMethod: ['token'],
				},
			},
			description:
				"A pre-issued JWT. Sent as 'Authorization: Bearer <jwt>' on /ws and HTTP requests (also settable as the frigate_token cookie).",
		},
	];

	// Applies a bearer token to HTTP requests when one is supplied. The /ws
	// upgrade and the username/password login flow are handled inside the nodes
	// (see GenericFunctions.ts), because /ws is not a plain HTTP endpoint.
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{ $credentials.authEnabled && $credentials.authMethod === "token" && $credentials.token ? "Bearer " + $credentials.token : undefined }}',
			},
		},
	};

	// Lets the user click "Test" in the credential editor. Hits the public
	// /api/version endpoint, which is available with or without auth.
	test: ICredentialTestRequest = {
		request: {
			baseURL:
				'={{ ($credentials.protocol === "https" ? "https" : "http") + "://" + $credentials.host + ":" + $credentials.port + ($credentials.pathPrefix || "") }}',
			url: '/api/version',
			method: 'GET',
		},
	};
}
