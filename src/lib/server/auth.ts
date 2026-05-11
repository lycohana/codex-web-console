import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Cookies, RequestEvent } from '@sveltejs/kit';

import { isLocalSetupRequestLike, validateNewToken } from '$lib/server/auth-utils';

const AUTH_COOKIE = 'cwc_auth';
const DEV_FALLBACK_TOKEN = process.env.CODEX_WEB_CONSOLE_DEV_FALLBACK_TOKEN || 'codex-web-console';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;

type SessionRecord = {
	tokenDigest: string;
	expiresAt: number;
};

const sessions = new Map<string, SessionRecord>();

function digest(value: string): string {
	return createHash('sha256').update(value).digest('hex');
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
	const envToken = env.CODEX_WEB_CONSOLE_TOKEN?.trim();
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

	const session = sessions.get(cookie);
	const now = Date.now();
	if (!session || session.expiresAt <= now) {
		if (session) sessions.delete(cookie);
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

	const sessionId = randomBytes(32).toString('base64url');
	sessions.set(sessionId, {
		tokenDigest: digest(configured.token),
		expiresAt: Date.now() + SESSION_TTL_MS
	});

	cookies.set(AUTH_COOKIE, sessionId, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 30
	});
}

export function clearAuthCookie(cookies: Cookies): void {
	const sessionId = cookies.get(AUTH_COOKIE);
	if (sessionId) sessions.delete(sessionId);
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
	sessions.clear();
}

export { validateNewToken };
