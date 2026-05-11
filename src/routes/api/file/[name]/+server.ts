import { error } from '@sveltejs/kit';

import { FileAccessError, serveWorkspaceFile } from '$lib/server/file-access';
import { codex } from '$lib/server/codex';

function requireAuth(locals: App.Locals) {
	if (!locals.authenticated) {
		throw error(401, 'Unauthorized');
	}
}

export const GET = async ({ locals, url }) => {
	requireAuth(locals);

	try {
		const file = await serveWorkspaceFile(
			{
				filePath: url.searchParams.get('path'),
				cwd: url.searchParams.get('cwd')
			},
			codex.getFileAccessRegistry()
		);
		return new Response(file.body, { headers: file.headers });
	} catch (err) {
		if (err instanceof FileAccessError) {
			return new Response(err.message, { status: err.status });
		}
		return new Response('File not found', { status: 404 });
	}
};
