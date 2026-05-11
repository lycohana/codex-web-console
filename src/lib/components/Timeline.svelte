<script lang="ts">
	import { renderMarkdown } from '$lib/render-markdown';
	import type { ApprovalRequest, TimelineEntry, TimelineTurn } from '$lib/types';

	let {
		turns,
		liveEntries,
		preservedEntries = [],
		approvals,
		omittedTurnCount = 0,
		cwd = '',
		onLoadFullHistory,
		onResolveApproval
	}: {
		turns: TimelineTurn[];
		liveEntries: TimelineEntry[];
		preservedEntries?: TimelineEntry[];
		approvals: ApprovalRequest[];
		omittedTurnCount?: number;
		cwd?: string;
		onLoadFullHistory?: () => void;
		onResolveApproval?: (
			requestId: string,
			decision: 'accept' | 'acceptForSession' | 'decline'
		) => void;
	} = $props();

	const BATCH = 5;
	let visibleCount = $state(BATCH);
	let lightboxSrc: string | null = $state(null);

	const IMAGE_EXTS = /\.(png|jpe?g|gif|webp|svg|bmp|avif|ico)$/i;

	function fileApiUrl(filePath: string): string {
		if (!cwd) return filePath;
		const name = filePath.split(/[\\/]/).pop() ?? 'file';
		const params = new URLSearchParams({ path: filePath, cwd });
		return `/api/file/${encodeURIComponent(name)}?${params}`;
	}

	function resolveImageUrl(src: string): string {
		if (!src || !cwd) return src;
		src = src.trim();
		if (!src || src === 'file' || /^\d+$/.test(src)) return src;
		if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/api/')) return src;
		// Strip file:// or file: protocol prefix that AI might use
		const cleanSrc = src.replace(/^file:\/\/\//i, '/').replace(/^file:/i, '');
		if (IMAGE_EXTS.test(cleanSrc)) {
			return fileApiUrl(cleanSrc);
		}
		return src;
	}

	/**
	 * Convert standalone image filenames in plain text to markdown image syntax.
	 * Only runs when no markdown links/images already exist in the text.
	 * (Regular ![alt](url) and [text](url) are handled by renderMarkdown's rewriteLocalPaths.)
	 */
	function autoLinkStandaloneImages(text: string): string {
		if (!cwd || !text) return text;
		if (!IMAGE_EXTS.test(text)) return text;
		// Skip if markdown link/image syntax already present
		if (text.includes('![') || text.includes('<img') || text.includes('](')) return text;

		return text.replace(
			/(^|[\s(（「【])([^\s)）」】]*?\.(?:png|jpe?g|gif|webp|svg|bmp|avif|ico))(?=[\s)）」】.,;:!?]|$)/gim,
			(_match: string, p1: string, filename: string) => {
				const resolved = fileApiUrl(filename);
				return `${p1}![${filename}](${resolved})`;
			}
		);
	}

	const visibleTurns = $derived(turns.slice(Math.max(0, turns.length - visibleCount)));
	const remaining = $derived(Math.max(0, turns.length - visibleCount));
	const hidden = $derived(Math.max(0, remaining));
	const liveIsRunning = $derived(liveEntries.some(isActiveCommand));
	let now = $state(Date.now());

	type ChangeStats = {
		path: string;
		kind: string;
		additions: number;
		deletions: number;
		diff: string;
	};

	type ChangeSummary = {
		files: ChangeStats[];
		additions: number;
		deletions: number;
	};

	function loadMore() {
		visibleCount = Math.min(turns.length, visibleCount + BATCH);
	}

	function isFoldableWork(entry: TimelineEntry) {
		if (entry.kind === 'assistant' && entry.phase === 'commentary') return true;
		return (
			entry.kind === 'reasoning' ||
			entry.kind === 'command' ||
			entry.kind === 'tool_call' ||
			entry.kind === 'file_change' ||
			entry.kind === 'web_search' ||
			entry.kind === 'plan'
		);
	}

	function isInlineFoldableWork(entry: TimelineEntry) {
		if (entry.kind === 'assistant' && entry.phase === 'commentary') return true;
		return (
			entry.kind === 'reasoning' ||
			entry.kind === 'command' ||
			entry.kind === 'tool_call' ||
			entry.kind === 'file_change' ||
			entry.kind === 'web_search' ||
			entry.kind === 'plan'
		);
	}

	function isFinalAnswer(entry: TimelineEntry) {
		return entry.kind === 'assistant' && entry.phase === 'final_answer';
	}

	function isActiveCommand(entry: TimelineEntry) {
		if (entry.kind !== 'command') return false;
		if (entry.completedAt) return false;
		const status = entry.status?.toLowerCase() ?? '';
		if (
			status.includes('completed') ||
			status.includes('finished') ||
			status.includes('failed') ||
			status.includes('cancel') ||
			status.includes('interrupt') ||
			status.includes('error')
		) return false;
		if (
			status.includes('running') ||
			status.includes('started') ||
			status.includes('active') ||
			status.includes('pending') ||
			status.includes('progress') ||
			status.includes('executing')
		) return true;
		return entry.exitCode === null && Boolean(entry.command || entry.output);
	}

	const hasActiveTimers = $derived.by(() => {
		if (approvals.length > 0) return true;
		if (liveEntries.some(isActiveCommand)) return true;
		return visibleTurns.some((turn) => (
			turn.completedAt === null ||
			turn.entries.some(isActiveCommand)
		));
	});

	$effect(() => {
		if (!hasActiveTimers) return;
		now = Date.now();
		const timer = window.setInterval(() => {
			now = Date.now();
		}, 1000);
		return () => window.clearInterval(timer);
	});

	function formatDuration(durationMs: number | null | undefined) {
		if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) return '';

		const totalSeconds = Math.max(1, Math.round(durationMs / 1000));
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;

		if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
		if (minutes > 0) return `${minutes}m ${seconds}s`;
		return `${seconds}s`;
	}

	function elapsedMs(entry: TimelineEntry) {
		if (entry.durationMs !== null && entry.durationMs !== undefined) return entry.durationMs;
		if (!entry.startedAt) return null;
		const end = entry.completedAt ?? (isActiveCommand(entry) ? now : null);
		return end ? Math.max(0, end - entry.startedAt) : null;
	}

	function commandStatusLabel(entry: TimelineEntry) {
		const parts: string[] = [];
		const duration = formatDuration(elapsedMs(entry));

		if (isActiveCommand(entry)) {
			parts.push('running');
		} else if (entry.status) {
			parts.push(entry.status);
		}

		if (entry.exitCode !== null && entry.exitCode !== undefined) {
			parts.push(`exit ${entry.exitCode}`);
		}

		if (duration) parts.push(duration);
		return parts.join(' · ');
	}

	function summarizeWork(entries: TimelineEntry[]) {
		const commandCount = entries.filter((entry) => entry.kind === 'command').length;
		const toolCallCount = entries.filter((entry) => entry.kind === 'tool_call').length;
		const fileChangeCount = entries.filter((entry) => entry.kind === 'file_change').length;
		const webSearchCount = entries.filter((entry) => entry.kind === 'web_search').length;
		const parts: string[] = [];

		if (commandCount > 0) parts.push(`Ran ${commandCount} command${commandCount > 1 ? 's' : ''}`);
		if (toolCallCount > 0) parts.push(`调用 ${toolCallCount} 个工具`);
		if (fileChangeCount > 0) parts.push(`已编辑 ${fileChangeCount} 个文件`);
		if (webSearchCount > 0) parts.push(`搜索 ${webSearchCount} 次`);

		return parts.join(' · ');
	}

	function summarizeInlineWork(entries: TimelineEntry[]) {
		const activeCommand = entries.find(isActiveCommand);
		if (activeCommand) return '正在运行命令';

		const summary = summarizeWork(entries);
		if (summary) return summary;

		if (entries.some((entry) => entry.kind === 'reasoning')) return '思考过程';
		if (entries.some((entry) => entry.kind === 'plan')) return '更新计划';
		return '处理细节';
	}

	function inlineDuration(entries: TimelineEntry[]) {
		const timedEntry = entries.find(isActiveCommand) ?? entries.find((entry) => Boolean(entry.startedAt));
		return timedEntry ? formatDuration(elapsedMs(timedEntry)) : '';
	}

	function buildInlineBatches(entries: TimelineEntry[]) {
		const batches: Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }> = [];
		let current: { index: number; entries: TimelineEntry[] } | null = null;

		for (const [index, entry] of entries.entries()) {
			if (isInlineFoldableWork(entry)) {
				current ??= { index, entries: [] };
				current.entries.push(entry);
				continue;
			}

			if (current) {
				batches.push({
					...current,
					summary: summarizeInlineWork(current.entries),
					duration: inlineDuration(current.entries)
				});
				current = null;
			}
		}

		if (current) {
			batches.push({
				...current,
				summary: summarizeInlineWork(current.entries),
				duration: inlineDuration(current.entries)
			});
		}

		return batches;
	}

	function batchAt(
		batches: Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }>,
		index: number
	) {
		return batches.find((batch) => batch.index === index) ?? null;
	}

	function isLastBatch(
		batch: { index: number },
		batches: Array<{ index: number }>
	) {
		return batch.index === batches.at(-1)?.index;
	}

	function shouldOpenLatestUnfinishedWork(
		turn: TimelineTurn,
		turnIndex: number,
		batch: { index: number },
		batches: Array<{ index: number }>
	) {
		const isLatestVisibleTurn = turnIndex === visibleTurns.length - 1;
		if (!isLatestVisibleTurn || liveEntries.length > 0 || preservedEntries.length > 0) return false;
		if (turn.entries.some(isFinalAnswer)) return false;
		return isLastBatch(batch, batches);
	}

	function diffStats(diff: string) {
		let additions = 0;
		let deletions = 0;

		for (const line of diff.split(/\r?\n/)) {
			if (line.startsWith('+++') || line.startsWith('---')) continue;
			if (line.startsWith('+')) additions += 1;
			if (line.startsWith('-')) deletions += 1;
		}

		return { additions, deletions };
	}

	function fileName(filePath: string) {
		return filePath.split(/[\\/]/).filter(Boolean).at(-1) ?? filePath;
	}

	function buildChangeSummary(entries: TimelineEntry[]): ChangeSummary | null {
		const files = new Map<string, ChangeStats>();

		for (const entry of entries) {
			if (entry.kind !== 'file_change' || !entry.changes) continue;

			for (const change of entry.changes) {
				if (!change.path) continue;

				const stats = diffStats(change.diff);
				const current = files.get(change.path);
				if (current) {
					current.kind = change.kind || current.kind;
					current.additions += stats.additions;
					current.deletions += stats.deletions;
					current.diff = [current.diff, change.diff].filter(Boolean).join('\n\n');
					continue;
				}

				files.set(change.path, {
					path: change.path,
					kind: change.kind,
					additions: stats.additions,
					deletions: stats.deletions,
					diff: change.diff
				});
			}
		}

		const fileList = [...files.values()];
		if (fileList.length === 0) return null;

		return {
			files: fileList,
			additions: fileList.reduce((total, file) => total + file.additions, 0),
			deletions: fileList.reduce((total, file) => total + file.deletions, 0)
		};
	}

	// Codex-style folding: keep user/final messages visible, fold reasoning and tools into a turn-level row.
	function analyseTurn(entries: TimelineEntry[]) {
		const hasFinalAnswer = entries.some(isFinalAnswer);

		if (!hasFinalAnswer) {
			const batches = buildInlineBatches(entries);

			return {
				mode: 'inline' as const,
				collapsed: batches.length > 0,
				firstWorkIndex: -1,
				workEntries: [] as TimelineEntry[],
				workSummary: '',
				batches
			};
		}

		const workEntries = entries.filter(isFoldableWork);
		const firstWorkIndex = entries.findIndex(isFoldableWork);

		return {
			mode: 'turn' as const,
			collapsed: workEntries.length > 0,
			firstWorkIndex,
			workEntries,
			workSummary: summarizeWork(workEntries),
			batches: [] as Array<{ index: number; entries: TimelineEntry[]; summary: string; duration: string }>
		};
	}

	function shouldShowThinking(turn: TimelineTurn) {
		if (!isActiveTurn(turn)) return false;
		if (turn.completedAt !== null) return false;
		if (turn.entries.some((entry) => entry.kind !== 'user')) return false;
		return !liveEntries.some((entry) => entry.turnId === turn.id);
	}

	function isFailedTurn(turn: TimelineTurn) {
		const status = turn.status.toLowerCase();
		return status.includes('failed') || status.includes('error');
	}

	function isActiveTurn(turn: TimelineTurn) {
		const status = turn.status.toLowerCase();
		if (isFailedTurn(turn) || status.includes('cancel') || status.includes('interrupt')) return false;
		if (turn.completedAt !== null) return false;
		return (
			status.includes('active') ||
			status.includes('running') ||
			status.includes('executing') ||
			status.includes('pending') ||
			status.includes('started') ||
			status.includes('progress') ||
			status.includes('starting')
		);
	}
</script>

{#snippet renderThinkingIndicator()}
	<article class="entry entry-thinking" aria-live="polite">
		<span class="entry-label">Codex</span>
		<div class="thinking-pill">
			<span class="thinking-dot" aria-hidden="true"></span>
			<span>思考中</span>
		</div>
	</article>
{/snippet}

{#snippet renderTurnFailure(turn: TimelineTurn)}
	<article class="entry entry-failure" aria-live="polite">
		<span class="entry-label">System</span>
		<div class="turn-failure-card">
			<strong>这次请求失败了</strong>
			<p>{turn.errorMessage ?? 'Codex 没有返回具体错误信息。可以直接重试，或检查本地 Codex 服务 / 网络状态。'}</p>
		</div>
	</article>
{/snippet}

{#snippet renderEntry(entry: TimelineEntry)}
	{@const kind = entry.kind}
	<article class="entry" class:entry-user={kind === 'user'}>
		<span class="entry-label">{entry.label}</span>

		{#if kind === 'command'}
			<details class="command-block" open={isActiveCommand(entry)}>
				<summary>
					<span>{entry.command || 'Command'}</span>
					{#if commandStatusLabel(entry)}
						<small class="command-meta">{commandStatusLabel(entry)}</small>
					{/if}
				</summary>
				{#if entry.cwd}
					<pre class="command-code">{entry.cwd}{entry.command ? `\n$ ${entry.command}` : ''}</pre>
				{:else if entry.command}
					<pre class="command-code">$ {entry.command}</pre>
				{/if}
				{#if entry.output}
					<pre class="command-code command-output">{entry.output}</pre>
				{/if}
			</details>
		{:else if kind === 'reasoning'}
			<details class="command-block" open>
				<summary><span>{entry.label}</span></summary>
				{#if entry.text}
					<div class="markdown">{@html renderMarkdown(autoLinkStandaloneImages(entry.text), cwd)}</div>
				{/if}
			</details>
		{:else if kind === 'web_search'}
			<details class="command-block">
				<summary><span>{entry.query || 'Web search'}</span></summary>
				<div class="entry-text">
					{#if entry.actionType}
						<p style="font-size:12px;color:var(--ink-soft)">Action: {entry.actionType}</p>
					{/if}
					{#if entry.url}
						<p style="font-size:12px;color:var(--ink-soft)">{entry.url}</p>
					{/if}
					{#if entry.queries && entry.queries.length > 0}
						<ul style="font-size:12px;color:var(--ink-soft)">
							{#each entry.queries as q}
								<li>{q}</li>
							{/each}
						</ul>
					{/if}
				</div>
			</details>
		{:else if kind === 'tool_call'}
			<details class="command-block">
				<summary>
					<span>{entry.serverName ? `${entry.serverName}.${entry.toolName ?? 'tool'}` : (entry.toolName ?? 'Tool call')}</span>
					{#if commandStatusLabel(entry)}
						<small class="command-meta">{commandStatusLabel(entry)}</small>
					{/if}
				</summary>
				{#if entry.toolInput}
					<pre class="command-code">{entry.toolInput}</pre>
				{/if}
				{#if entry.toolOutput}
					<pre class="command-code command-output">{entry.toolOutput}</pre>
				{/if}
				{#if entry.images && entry.images.length > 0}
					<div class="timeline-image-strip">
						{#each entry.images as rawSrc, i}
							{@const src = resolveImageUrl(rawSrc)}
							<button type="button" class="image-thumb-btn" onclick={() => lightboxSrc = src}>
								<img {src} alt="工具输出图片 {i + 1}" />
							</button>
						{/each}
					</div>
				{/if}
			</details>
		{:else}
			{#if entry.text}
				<div class="markdown">{@html renderMarkdown(autoLinkStandaloneImages(entry.text), cwd)}</div>
			{/if}
			{#if entry.images && entry.images.length > 0}
				<div class="timeline-image-strip">
					{#each entry.images as rawSrc, i}
						{@const src = resolveImageUrl(rawSrc)}
						<button type="button" class="image-thumb-btn" onclick={() => lightboxSrc = src}>
							<img {src} alt="附件 {i + 1}" />
						</button>
					{/each}
				</div>
			{/if}
		{/if}

		{#if entry.changes}
			<ul style="font-size:12px;color:var(--ink-soft);margin:0;padding-left:16px">
				{#each entry.changes as change}
					<li>{change.kind} {change.path}</li>
				{/each}
			</ul>
		{/if}
	</article>
{/snippet}

{#snippet renderWorkCollapse(workEntries: TimelineEntry[], statusLabel: string, durationLabel = '', workSummary = '', defaultOpen = false)}
	<details class="work-collapse" open={defaultOpen || workEntries.some(isActiveCommand)}>
		<summary class="work-summary">
			<span class="work-summary-main">
				<span>{statusLabel}</span>
				{#if durationLabel}
					<span>{durationLabel}</span>
				{/if}
				<span class="work-chevron" aria-hidden="true">›</span>
			</span>
			<span class="work-summary-rule"></span>
		</summary>

		<div class="work-detail">
			{#if workSummary}
				<p class="work-summary-text">{workSummary}</p>
			{/if}
			{#each workEntries as entry (entry.id)}
				{@render renderEntry(entry)}
			{/each}
		</div>
	</details>
{/snippet}

{#snippet renderChangeSummary(summary: ChangeSummary)}
	<section class="file-change-summary" aria-label="文件变更摘要">
		<div class="file-change-header">
			<div class="file-change-title">
				<strong>{summary.files.length} 个文件已更改</strong>
				<span class="diff-add">+{summary.additions}</span>
				<span class="diff-del">-{summary.deletions}</span>
			</div>
		</div>

		<div class="changed-file-list">
			{#each summary.files as file (file.path)}
				<details class="changed-file">
					<summary>
						<span class="changed-file-name" title={file.path}>{fileName(file.path)}</span>
						<span class="changed-file-stats">
							<span class="diff-add">+{file.additions}</span>
							<span class="diff-del">-{file.deletions}</span>
						</span>
						<span class="changed-file-dot" title={file.kind}></span>
						<span class="changed-file-chevron" aria-hidden="true">⌄</span>
					</summary>
					{#if file.diff}
						<pre class="changed-file-diff">{file.diff}</pre>
					{/if}
				</details>
			{/each}
		</div>
	</section>
{/snippet}

<section class="timeline">
	{#if omittedTurnCount > 0 && onLoadFullHistory}
		<div class="load-more-strip">
			<button type="button" class="ghost load-more-btn" onclick={onLoadFullHistory}>
				Load full history — <span class="load-more-count">{omittedTurnCount}+ earlier turn{omittedTurnCount > 1 ? 's' : ''}</span>
			</button>
		</div>
	{/if}

	{#if hidden > 0}
		<div class="load-more-strip">
			<button type="button" class="ghost load-more-btn" onclick={loadMore}>
				Load more history — <span class="load-more-count">{hidden > BATCH ? `${hidden}+` : hidden} turn{hidden > 1 ? 's' : ''}</span>
			</button>
		</div>
	{/if}

	{#if visibleTurns.length === 0 && liveEntries.length === 0 && preservedEntries.length === 0}
		<p class="empty">Start a thread to see activity.</p>
	{/if}

	{#each visibleTurns as turn, turnIndex (turn.id)}
		{@const analysis = analyseTurn(turn.entries)}
		{@const changeSummary = buildChangeSummary(turn.entries)}
		<section class="turn" id={`turn-${turn.id}`} data-turn-id={turn.id}>
			<div class="turn-meta">
				<span class="dot"></span>
				<span>Turn</span>
				<span>{turn.status}</span>
			</div>

			{#if analysis.mode === 'turn' && analysis.collapsed}
				{#each turn.entries as entry, index (entry.id)}
					{#if index === analysis.firstWorkIndex}
						{@render renderWorkCollapse(
							analysis.workEntries,
							turn.completedAt === null ? '处理中' : '已处理',
							formatDuration(turn.durationMs),
							analysis.workSummary
						)}
					{/if}

					{#if !isFoldableWork(entry)}
						{@render renderEntry(entry)}
					{/if}
				{/each}
			{:else if analysis.mode === 'inline' && analysis.collapsed}
				{#each turn.entries as entry, index (entry.id)}
					{@const batch = batchAt(analysis.batches, index)}
					{#if batch}
						{@render renderWorkCollapse(
							batch.entries,
							batch.summary,
							batch.duration,
							'',
							shouldOpenLatestUnfinishedWork(turn, turnIndex, batch, analysis.batches)
						)}
					{/if}

					{#if !isInlineFoldableWork(entry)}
						{@render renderEntry(entry)}
					{/if}
				{/each}
			{:else}
				{#each turn.entries as entry (entry.id)}
					{@render renderEntry(entry)}
				{/each}
			{/if}

			{#if shouldShowThinking(turn)}
				{@render renderThinkingIndicator()}
			{/if}

			{#if isFailedTurn(turn)}
				{@render renderTurnFailure(turn)}
			{/if}

			{#if turn.completedAt !== null && changeSummary}
				{@render renderChangeSummary(changeSummary)}
			{/if}
		</section>
	{/each}

{#if liveEntries.length > 0}
		{@const liveBatches = buildInlineBatches(liveEntries)}
		<section class="turn">
			<div class="turn-meta">
				<span class="dot" style:background={liveIsRunning ? 'var(--success)' : 'var(--ink-faint)'}></span>
				<span class:running={liveIsRunning}>Live</span>
				<span>
					{liveIsRunning ? 'running' : 'settled'}
				</span>
			</div>
			{#each liveEntries as entry, index (entry.id)}
				{@const batch = batchAt(liveBatches, index)}
				{#if batch}
					{@render renderWorkCollapse(batch.entries, batch.summary, batch.duration, '', isLastBatch(batch, liveBatches))}
				{/if}
				{#if !isInlineFoldableWork(entry)}
					{@render renderEntry(entry)}
				{/if}
			{/each}
		</section>
	{/if}

	{#if preservedEntries.length > 0}
		<section class="turn">
			<div class="turn-meta">
				<span class="dot"></span>
				<span>Reasoning</span>
				<span>session</span>
			</div>
			{#each preservedEntries as entry (entry.id)}
				<article class="entry">
					<span class="entry-label">{entry.label}</span>
					<details class="command-block" open>
						<summary><span>Reasoning</span></summary>
						{#if entry.text}
							<div class="markdown">{@html renderMarkdown(autoLinkStandaloneImages(entry.text), cwd)}</div>
						{/if}
					</details>
				</article>
			{/each}
		</section>
	{/if}

	{#if approvals.length > 0}
		<section class="approval-stack">
			{#each approvals as approval (approval.requestId)}
				<article class="approval-card">
					<h3>
						<span>{approval.title}</span>
						<span class="approval-wait">等待允许 {formatDuration(now - approval.requestedAt)}</span>
					</h3>
					{#if approval.reason}
						<p>{approval.reason}</p>
					{/if}
					{#if approval.command}
						<pre>{approval.command}</pre>
					{/if}
					{#if onResolveApproval}
						<div class="approval-card-actions">
							<button onclick={() => onResolveApproval(approval.requestId, 'accept')}>
								Allow once
							</button>
							<button
								class="ghost"
								onclick={() => onResolveApproval(approval.requestId, 'acceptForSession')}
							>
								Allow session
							</button>
							<button class="danger" onclick={() => onResolveApproval(approval.requestId, 'decline')}>
								Decline
							</button>
						</div>
					{/if}
				</article>
			{/each}
		</section>
	{/if}
</section>

{#if lightboxSrc}
	<!-- svelte-ignore a11y_no_static_element_interactions a11y_click_events_have_key_events -->
	<div
		class="image-lightbox-backdrop"
		onclick={() => lightboxSrc = null}
		onkeydown={(e) => { if (e.key === 'Escape') lightboxSrc = null; }}
	>
		<button
			type="button"
			class="image-lightbox-close"
			onclick={(e) => { e.stopPropagation(); lightboxSrc = null; }}
			aria-label="关闭预览"
		>&times;</button>
		<button
			type="button"
			class="image-lightbox-img-wrap"
			onclick={(e) => e.stopPropagation()}
			aria-label="图片预览"
		>
			<img class="image-lightbox-img" src={lightboxSrc} alt="图片预览" />
		</button>
	</div>
{/if}
