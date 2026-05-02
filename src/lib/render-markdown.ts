import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';

marked.setOptions({
	gfm: true,
	breaks: true
});

const allowedTags = [
	'p',
	'br',
	'strong',
	'em',
	'del',
	'code',
	'pre',
	'blockquote',
	'ul',
	'ol',
	'li',
	'a',
	'img',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'hr',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td'
];

const allowedAttributes = {
	a: ['href', 'target', 'rel'],
	img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
	table: ['border'],
	th: ['align', 'scope'],
	td: ['align']
};

const cache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 200;

/** Characters that indicate a URL is external / special, not a local file */
const NON_LOCAL_PREFIX = /^(https?:\/\/|data:|mailto:|tel:|\/api\/|#)/i;

/** Strip file:// or file:/// protocol prefix (AI sometimes uses these for local paths) */
function stripFileProtocol(url: string): string {
	return url.replace(/^file:\/\/\//i, '').replace(/^file:\/\//i, '').replace(/^file:/i, '');
}

/** Detect if a markdown URL looks like a local file path (has a file extension, no protocol) */
function isLocalFileUrl(url: string): boolean {
	if (!url) return false;
	const clean = stripFileProtocol(url);
	if (NON_LOCAL_PREFIX.test(clean)) return false;
	// Must contain a dot with a 1-10 char extension
	return /\.[a-zA-Z0-9]{1,10}$/.test(clean);
}

function normalizeLocalPath(url: string): string {
	let p = stripFileProtocol(url);
	// Strip leading "/" before Windows drive letter: /C:/... → C:/...
	p = p.replace(/^\/([a-zA-Z]:)/, '$1');
	return p;
}

function fileApiUrl(filePath: string, cwd: string): string {
	const normalized = normalizeLocalPath(filePath);
	const name = normalized.split(/[\\/]/).pop() ?? 'file';
	const params = new URLSearchParams({ path: normalized, cwd });
	return `/api/file/${encodeURIComponent(name)}?${params}`;
}

/**
 * Rewrite local file paths in markdown to /api/file?... URLs so the browser can fetch them.
 * Handles: ![alt](path.ext), [text](path.ext), standalone filenames.
 */
function rewriteLocalPaths(text: string, cwd: string): string {
	if (!cwd || !text) return text;

	// 1. Markdown image links: ![alt](local-file.ext)
	let result = text.replace(
		/!\[([^\]]*)\]\(([^)]+)\)/g,
		(_match, alt: string, url: string) => {
			const trimmed = url.trim();
			if (!isLocalFileUrl(trimmed)) return _match;
			return `![${alt}](${fileApiUrl(trimmed, cwd)})`;
		}
	);

	// 2. Markdown text links: [text](local-file.ext)
	result = result.replace(
		/\[([^\]]+)\]\(([^)]+)\)/g,
		(_match, label: string, url: string) => {
			const trimmed = url.trim();
			if (!isLocalFileUrl(trimmed)) return _match;
			return `[${label}](${fileApiUrl(trimmed, cwd)})`;
		}
	);

	// 3. Raw HTML: <a href="local-file.ext"> or <img src="local-file.ext">
	result = result.replace(
		/<(a|img)\s+([^>]*?)(href|src)=["']([^"']+)["']/gi,
		(_match, tag: string, attrs: string, attr: string, url: string) => {
			if (!isLocalFileUrl(url)) return _match;
			return `<${tag} ${attrs}${attr}="${fileApiUrl(url, cwd)}"`;
		}
	);

	return result;
}

export function renderMarkdown(input: string | null | undefined, cwd?: string): string {
	if (!input?.trim()) {
		return '';
	}

	const cacheKey = cwd ? `${cwd}\x00${input}` : input;
	const cached = cache.get(cacheKey);
	if (cached !== undefined) {
		cache.delete(cacheKey);
		cache.set(cacheKey, cached);
		return cached;
	}

	const preprocessed = cwd ? rewriteLocalPaths(input, cwd) : input;
	const parsed = marked.parse(preprocessed);
	const html = typeof parsed === 'string' ? parsed : '';

	const sanitized = sanitizeHtml(html, {
		allowedTags,
		allowedAttributes,
		allowedSchemes: ['http', 'https', 'mailto', 'tel', 'data'],
		allowedSchemesByTag: {
			img: ['http', 'https'],
			a: ['http', 'https', 'mailto', 'tel']
		},
		allowProtocolRelative: false,
		transformTags: {
			a: sanitizeHtml.simpleTransform('a', {
				target: '_blank',
				rel: 'noopener noreferrer'
			})
		}
	});

	cache.set(cacheKey, sanitized);
	if (cache.size > MAX_CACHE_ENTRIES) {
		const oldest = cache.keys().next().value;
		if (oldest !== undefined) cache.delete(oldest);
	}

	return sanitized;
}
