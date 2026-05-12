import { describe, expect, test } from 'bun:test';

import { readAuthState, resetAuthSessionsForTests, writeAuthCookie } from './auth';
import { isLocalSetupRequestLike, validateNewToken } from './auth-utils';

function setupEvent(hostname: string, headers: Record<string, string> = {}, client = '203.0.113.10') {
	return {
		url: new URL(`http://${hostname}/`),
		request: new Request(`http://${hostname}/`, { headers }),
		getClientAddress: () => client
	};
}

describe('token validation', () => {
	test('rejects empty, short, oversized, and padded tokens', () => {
		expect(validateNewToken('')).toBe('Token is required.');
		expect(validateNewToken('short')).toContain('at least');
		expect(validateNewToken(` ${'a'.repeat(8)}`)).toContain('whitespace');
		expect(validateNewToken('a'.repeat(4097))).toContain('at most');
	});

	test('accepts a reasonably strong token length', () => {
		expect(validateNewToken('correct-horse-battery-staple')).toBeNull();
	});
});

describe('setup request locality', () => {
	test('allows localhost hosts and loopback clients', () => {
		expect(isLocalSetupRequestLike(setupEvent('localhost'))).toBe(true);
		expect(isLocalSetupRequestLike(setupEvent('example.test', {}, '127.0.0.1'))).toBe(true);
		expect(isLocalSetupRequestLike(setupEvent('[::1]'))).toBe(true);
	});

	test('rejects non-local setup attempts', () => {
		expect(isLocalSetupRequestLike(setupEvent('example.test', { host: 'example.test' }, '203.0.113.10'))).toBe(false);
	});
});

describe('auth cookie persistence', () => {
	test('keeps web login after in-memory sessions are cleared', () => {
		const store = new Map<string, string>();
		const cookies = {
			get: (name: string) => store.get(name),
			set: (name: string, value: string) => { store.set(name, value); },
			delete: (name: string) => { store.delete(name); }
		};

		writeAuthCookie(cookies as never, false);
		expect(readAuthState(cookies as never).authenticated).toBe(true);

		resetAuthSessionsForTests();

		expect(readAuthState(cookies as never).authenticated).toBe(true);
	});
});
