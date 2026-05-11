import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import { normalizeOaiModel, resolveCustomProviderModelsUrl } from '$lib/server/model-provider';
import type { ModelOption } from '$lib/types';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals }) => {
	requireAuth(locals);

	try {
		return json({ models: await codex.listModels() });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};

/** POST /api/models  { url: "http://host:port" }
 *  Fetches models from a custom provider's /models endpoint and normalises them. */
export const POST = async ({ locals, request }) => {
	requireAuth(locals);

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json({ error: 'Invalid JSON body' }, { status: 400 });
	}

	const url = typeof (body as Record<string, unknown>)?.url === 'string'
		? (body as Record<string, unknown>).url as string
		: null;
	if (!url) return json({ error: 'Missing "url" field' }, { status: 400 });

	let resolved: { modelsUrl: string; provider: string };
	try {
		resolved = resolveCustomProviderModelsUrl(url);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 400 });
	}

	try {
		const resp = await fetch(resolved.modelsUrl, { signal: AbortSignal.timeout(8000) });
		if (!resp.ok) {
			return json({ error: `Upstream returned ${resp.status}` }, { status: 502 });
		}
		const data = await resp.json() as Record<string, unknown>;
		const rawList: unknown[] = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
		const models = rawList
			.map((entry) => normalizeOaiModel(entry as Record<string, unknown>, resolved.provider))
			.filter((m): m is ModelOption => m !== null);
		return json({ models });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 502 });
	}
};
