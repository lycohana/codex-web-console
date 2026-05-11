import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import { parseThreadRequestBody, RequestValidationError } from '$lib/server/thread-request';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const POST = async ({ locals, params, request }) => {
	requireAuth(locals);

	let body: Parameters<typeof parseThreadRequestBody>[0];

	try {
		body = (await request.json()) as Parameters<typeof parseThreadRequestBody>[0];
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const parsed = parseThreadRequestBody(body);
		await codex.sendMessage(
			params.threadId,
			parsed.cwd,
			parsed.prompt,
			parsed.permissionMode,
			parsed.modelSelection,
			parsed.images
		);
		return json({ ok: true });
	} catch (err) {
		if (err instanceof RequestValidationError) {
			return json({ error: err.message }, { status: err.status });
		}
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
