import { error, json } from '@sveltejs/kit';

import { codex } from '$lib/server/codex';
import { parseThreadRequestBody, RequestValidationError } from '$lib/server/thread-request';
import type { ThreadSummary } from '$lib/types';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

function buildThreadListSignature(threads: ThreadSummary[]): string {
	return threads
		.map((thread) =>
			[
				thread.id,
				thread.updatedAt ?? '',
				thread.status,
				thread.title,
				thread.preview,
				thread.cwd,
				thread.provider ?? ''
			].join('\u001f')
		)
		.join('\u001e');
}

export const GET = async ({ locals, url }) => {
	requireAuth(locals);

	try {
		const threads = await codex.listThreads();
		const signature = buildThreadListSignature(threads);
		if (url.searchParams.get('view') === 'probe') {
			return json({
				signature,
				count: threads.length,
				latestUpdatedAt: threads[0]?.updatedAt ?? null
			});
		}
		return json({ threads, signature });
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};

export const POST = async ({ locals, request }) => {
	requireAuth(locals);

	let body: Parameters<typeof parseThreadRequestBody>[0];

	try {
		body = (await request.json()) as Parameters<typeof parseThreadRequestBody>[0];
	} catch {
		return json({ error: 'Request body must be valid JSON.' }, { status: 400 });
	}

	try {
		const parsed = parseThreadRequestBody(body);
		return json({
			thread: await codex.createThread(
				parsed.cwd,
				parsed.prompt,
				parsed.permissionMode,
				parsed.modelSelection,
				parsed.images
			)
		});
	} catch (err) {
		if (err instanceof RequestValidationError) {
			return json({ error: err.message }, { status: err.status });
		}
		const message = err instanceof Error ? err.message : String(err);
		return json({ error: message }, { status: 500 });
	}
};
