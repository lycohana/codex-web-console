import { describe, expect, test } from 'bun:test';

const originalTrustedOrigins = process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS;
const originalOrigin = process.env.ORIGIN;

async function loadConfig() {
	const module = await import(`../../../svelte.config.js?test=${Date.now()}-${Math.random()}`);
	return module.default as {
		kit?: {
			csrf?: {
				trustedOrigins?: string[];
			};
		};
	};
}

describe('SvelteKit csrf trusted origins', () => {
	test('allows IP based access by default', async () => {
		delete process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS;
		delete process.env.ORIGIN;

		try {
			const config = await loadConfig();
			expect(config.kit?.csrf?.trustedOrigins?.join(',')).toBe('*');
		} finally {
			process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS = originalTrustedOrigins;
			process.env.ORIGIN = originalOrigin;
		}
	});

	test('allows explicit trusted origins override', async () => {
		process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS = 'http://203.0.113.10:1080, https://codex.example.test';
		delete process.env.ORIGIN;

		try {
			const config = await loadConfig();
			expect(config.kit?.csrf?.trustedOrigins).toContain('https://codex.lycohana.cn');
			expect(config.kit?.csrf?.trustedOrigins).toContain('http://203.0.113.10:1080');
			expect(config.kit?.csrf?.trustedOrigins).toContain('https://codex.example.test');
		} finally {
			process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS = originalTrustedOrigins;
			process.env.ORIGIN = originalOrigin;
		}
	});
});
