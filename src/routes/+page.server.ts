import { homedir } from 'node:os';

import { fail, redirect } from '@sveltejs/kit';

import { clearAuthCookie, saveTokenToConfig, verifySubmittedToken, writeAuthCookie } from '$lib/server/auth';
import { codex } from '$lib/server/codex';

/**
 * Maximum milliseconds the server will wait for codex to respond to a
 * single JSON-RPC request.  Set conservatively so the page doesn't
 * hang during cold start.
 */
const LOAD_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('timeout')), ms);
		promise.then(
			(value) => { clearTimeout(timer); resolve(value); },
			(reason) => { clearTimeout(timer); reject(reason); }
		);
	});
}

export const load = async ({ locals, url }) => {
	if (!locals.authenticated) {
		return {
			authenticated: false,
			tokenConfigured: locals.tokenConfigured,
			setupMode: !locals.tokenConfigured,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: null
		};
	}

	try {
		const requestedThreadId = url.searchParams.get('thread')?.trim() || null;
		let threads: Awaited<ReturnType<typeof codex.listThreads>> = [];
		let selectedThread = null;
		let codexError: string | null = null;

		try {
			threads = await withTimeout(codex.listThreads(), LOAD_TIMEOUT_MS);
		} catch (error) {
			// Timed out or genuinely failed ??return empty threads and let the
			// client-side polling load them once the codex process is ready.
			codexError =
				error instanceof Error && error.message === 'timeout'
					? null
					: error instanceof Error
						? error.message
						: String(error);
		}

		if (requestedThreadId) {
			try {
				selectedThread = await withTimeout(
					codex.readThread(requestedThreadId, { tailTurns: 5 }),
					LOAD_TIMEOUT_MS
				);
			} catch (error) {
				codexError =
					error instanceof Error && error.message === 'timeout'
						? codexError
						: error instanceof Error
							? error.message
							: String(error);
			}
		}

		return {
			authenticated: true,
			tokenConfigured: true,
			setupMode: false,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads,
			selectedThread,
			homePath: homedir(),
			codexError
		};
	} catch (error) {
		return {
			authenticated: true,
			tokenConfigured: true,
			setupMode: false,
			fallbackTokenActive: locals.fallbackTokenActive,
			threads: [],
			selectedThread: null,
			homePath: homedir(),
			codexError: error instanceof Error ? error.message : String(error)
		};
	}
};

export const actions = {
	setup: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();

		if (!token) {
			return fail(400, { setupError: 'Token is required.' });
		}

		if (token.length < 4) {
			return fail(400, { setupError: 'Token must be at least 4 characters.' });
		}

		saveTokenToConfig(token);

		// Verify immediately and log in
		if (verifySubmittedToken(token)) {
			writeAuthCookie(cookies, url.protocol === 'https:');
		}

		throw redirect(303, '/');
	},
	login: async ({ request, cookies, url }) => {
		const form = await request.formData();
		const token = String(form.get('token') ?? '').trim();

		if (!token) {
			return fail(400, { loginError: 'Token is required.' });
		}

		if (!verifySubmittedToken(token)) {
			return fail(400, { loginError: 'Token is invalid.' });
		}

		writeAuthCookie(cookies, url.protocol === 'https:');
		throw redirect(303, '/');
	},
	logout: async ({ cookies }) => {
		clearAuthCookie(cookies);
		throw redirect(303, '/');
	}
};
