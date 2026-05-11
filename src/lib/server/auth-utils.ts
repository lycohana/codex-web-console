const MIN_TOKEN_LENGTH = 8;
const MAX_TOKEN_LENGTH = 4096;

export function validateNewToken(token: string): string | null {
	if (!token) return 'Token is required.';
	if (token.length < MIN_TOKEN_LENGTH) return `Token must be at least ${MIN_TOKEN_LENGTH} characters.`;
	if (token.length > MAX_TOKEN_LENGTH) return `Token must be at most ${MAX_TOKEN_LENGTH} characters.`;
	if (/^\s|\s$/.test(token)) return 'Token must not start or end with whitespace.';
	return null;
}

function forwardedHostIsLocal(value: string | null): boolean {
	if (!value) return false;
	const host = value.split(',')[0]?.trim().replace(/:\d+$/, '').toLowerCase();
	return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

export function isLocalSetupRequestLike(event: {
	url: URL;
	request: Request;
	getClientAddress: () => string;
}): boolean {
	if (forwardedHostIsLocal(event.url.hostname)) return true;
	if (forwardedHostIsLocal(event.request.headers.get('host'))) return true;
	if (forwardedHostIsLocal(event.request.headers.get('x-forwarded-host'))) return true;

	try {
		return forwardedHostIsLocal(event.getClientAddress());
	} catch {
		return false;
	}
}
