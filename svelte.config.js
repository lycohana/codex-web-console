import adapter from 'svelte-adapter-bun';

function trustedOrigins() {
	const configured = process.env.CODEX_WEB_CONSOLE_TRUSTED_ORIGINS ?? process.env.ORIGIN;
	if (!configured) return ['*'];

	const origins = new Set(['https://codex.lycohana.cn']);
	for (const origin of configured.split(',')) {
		const trimmed = origin.trim();
		if (trimmed) origins.add(trimmed);
	}
	return [...origins];
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) => (filename.split(/[/\\]/).includes('node_modules') ? undefined : true)
	},
	kit: {
		adapter: adapter(),
		csrf: {
			trustedOrigins: trustedOrigins()
		}
	}
};

export default config;
