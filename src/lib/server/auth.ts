import { createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

import { isLocalSetupRequestLike, validateNewToken } from './auth-utils';

const AUTH_COOKIE = 'cwc_auth';
const DEV_FALLBACK_TOKEN = process.env.CODEX_WEB_CONSOLE_DEV_FALLBACK_TOKEN || 'codex-web-console';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const SESSION_VERSION = 'v2';
const dev = process.env.NODE_ENV !== 'production';

type SessionRecord = {
	tokenDigest: string;
	expiresAt: number;
};

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

function sessionSecret(): string {
	return digest(`codex-web-console:${readAccessToken() ?? DEV_FALLBACK_TOKEN}`);
}

function signSession(value: string): string {
	return createHmac('sha256', sessionSecret()).update(value).digest('base64url');
}

function createSessionCookie(token: string, expiresAt: number): string {
	const payload = `${SESSION_VERSION}.${expiresAt}.${digest(token)}`;
	return `${payload}.${signSession(payload)}`;
}

function parseSessionCookie(cookie: string): SessionRecord | null {
	const parts = cookie.split('.');
	if (parts.length !== 4) return null;
	const [version, expiresAtText, tokenDigest, signature] = parts;
	if (version !== SESSION_VERSION) return null;

	const expiresAt = Number(expiresAtText);
	if (!Number.isFinite(expiresAt)) return null;

	const payload = `${version}.${expiresAtText}.${tokenDigest}`;
	if (!safeEqual(signature, signSession(payload))) return null;

	return { tokenDigest, expiresAt };
}

function getConfigPath(): string {
	return join(homedir(), '.codex-web-console', 'config.json');
}

function safeEqual(left: string, right: string): boolean {
	const expected = Buffer.from(left);
	const actual = Buffer.from(right);
	return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readTokenFromFile(): string | null {
	try {
		const configPath = getConfigPath();
		if (!existsSync(configPath)) return null;
		const raw = readFileSync(configPath, 'utf-8');
		const data = JSON.parse(raw);
		const token = typeof data.token === 'string' ? data.token.trim() : '';
		return token || null;
	} catch {
		return null;
	}
}

function readAccessToken(): string | null {
	const envToken = process.env.CODEX_WEB_CONSOLE_TOKEN?.trim();
	if (envToken) return envToken;

	return readTokenFromFile();
}

export function getConfiguredToken(): {
	token: string | null;
	fallbackActive: boolean;
} {
	const envToken = readAccessToken();
	if (envToken) {
		return { token: envToken, fallbackActive: false };
	}

	if (dev) {
		return { token: DEV_FALLBACK_TOKEN, fallbackActive: true };
	}

	return { token: null, fallbackActive: false };
}

export function readAuthState(cookies: Cookies): {
	authenticated: boolean;
	tokenConfigured: boolean;
	fallbackActive: boolean;
} {
	const configured = getConfiguredToken();
	const cookie = cookies.get(AUTH_COOKIE);

	if (!configured.token || !cookie) {
		return {
			authenticated: false,
			tokenConfigured: configured.token !== null,
			fallbackActive: configured.fallbackActive
		};
	}

	const session = parseSessionCookie(cookie);
	const now = Date.now();
	if (!session || session.expiresAt <= now) {
		return {
			authenticated: false,
			tokenConfigured: true,
			fallbackActive: configured.fallbackActive
		};
	}

	return {
		authenticated: safeEqual(session.tokenDigest, digest(configured.token)),
		tokenConfigured: true,
		fallbackActive: configured.fallbackActive
	};
}

export function verifySubmittedToken(token: string): boolean {
	const configured = getConfiguredToken();
	if (!configured.token) {
		return false;
	}

	return safeEqual(digest(configured.token), digest(token.trim()));
}

export function writeAuthCookie(cookies: Cookies, secure: boolean): void {
	const configured = getConfiguredToken();
	if (!configured.token) {
		return;
	}

	const record = {
		tokenDigest: digest(configured.token),
		expiresAt: Date.now() + SESSION_TTL_MS
	};
	const persistentSession = createSessionCookie(configured.token, record.expiresAt);

	cookies.set(AUTH_COOKIE, persistentSession, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 30
	});
}

export function clearAuthCookie(cookies: Cookies): void {
	cookies.delete(AUTH_COOKIE, { path: '/' });
}

export function saveTokenToConfig(token: string): void {
	const configDir = join(homedir(), '.codex-web-console');
	if (!existsSync(configDir)) {
		mkdirSync(configDir, { recursive: true });
	}
	writeFileSync(join(configDir, 'config.json'), JSON.stringify({ token }, null, 2), 'utf-8');
}

export function readTokenFromConfig(): string | null {
	return readTokenFromFile();
}

export function isLocalSetupRequest(event: Pick<RequestEvent, 'url' | 'request' | 'getClientAddress'>): boolean {
	return isLocalSetupRequestLike(event);
}

export function resetAuthSessionsForTests(): void {
	// Kept for older tests/callers. Auth sessions are encoded in signed cookies.
}

export { validateNewToken };
