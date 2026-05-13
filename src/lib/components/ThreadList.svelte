<script lang="ts">
	import type { ThreadSummary } from '$lib/types';

	type ThreadGroup = {
		key: string;
		name: string;
		path: string;
		count: number;
		updatedAt: number | null;
		threads: ThreadSummary[];
	};

	let {
		threads,
		selectedThreadId,
		onSelect,
		onManage
	}: {
		threads: ThreadSummary[];
		selectedThreadId: string | null;
		onSelect: (threadId: string) => void;
		onManage: (thread: ThreadSummary, position: { x: number; y: number }) => void;
	} = $props();

	const collapsedWorkspaceStorageKey = 'codex-web-console.collapsedWorkspaces';
	const legacyExpandedThreadListStorageKey = 'codex-web-console.expandedThreadLists';

	let collapsedWorkspaceKeys = $state<string[]>([]);
	let expandedThreadListKeys = $state<string[]>([]);
	let knownWorkspaceKeys = $state<string[]>([]);
	let restoredCollapseState = $state(false);

	const maxCollapsedThreads = 5;
	const threadGroups = $derived.by(() => groupThreadsByWorkspace(threads));

	function readStoredKeys(key: string): string[] | null {
		if (typeof localStorage === 'undefined') return null;

		try {
			const parsed = JSON.parse(localStorage.getItem(key) ?? 'null');
			return Array.isArray(parsed)
				? parsed.filter((value): value is string => typeof value === 'string')
				: null;
		} catch {
			return null;
		}
	}

	function writeStoredKeys(key: string, value: string[]) {
		if (typeof localStorage === 'undefined') return;
		localStorage.setItem(key, JSON.stringify(value));
	}

	function removeStoredKey(key: string) {
		if (typeof localStorage === 'undefined') return;
		localStorage.removeItem(key);
	}

	function sameKeys(left: string[], right: string[]) {
		if (left.length !== right.length) return false;
		return left.every((value, index) => value === right[index]);
	}

	function uniqueKeys(keys: string[]) {
		return [...new Set(keys)];
	}

	function normalizeWorkspacePath(cwd: string): string {
		const trimmed = cwd.trim().replace(/[\\/]+$/, '') || 'Unknown workspace';
		return trimmed.replace(/^([a-z]):/i, (_, drive: string) => `${drive.toUpperCase()}:`);
	}

	function isWindowsWorkspacePath(path: string): boolean {
		return /^[a-z]:[\\/]/i.test(path) || path.startsWith('\\\\');
	}

	function workspaceKey(cwd: string): string {
		const normalized = normalizeWorkspacePath(cwd).replace(/\\/g, '/');
		return isWindowsWorkspacePath(cwd) ? normalized.toLowerCase() : normalized;
	}

	function workspaceName(cwd: string): string {
		const normalized = normalizeWorkspacePath(cwd);
		const parts = normalized.split(/[\\/]+/).filter(Boolean);
		return parts.at(-1) ?? normalized;
	}

	function groupThreadsByWorkspace(items: ThreadSummary[]): ThreadGroup[] {
		const groups = new Map<string, ThreadGroup>();

		for (const thread of items) {
			const path = normalizeWorkspacePath(thread.cwd);
			const key = workspaceKey(path);
			let group = groups.get(key);

			if (!group) {
				group = {
					key,
					name: workspaceName(path),
					path,
					count: 0,
					updatedAt: null,
					threads: []
				};
				groups.set(key, group);
			}

			group.threads.push(thread);
			group.count += 1;
			if (thread.updatedAt && (!group.updatedAt || thread.updatedAt > group.updatedAt)) {
				group.updatedAt = thread.updatedAt;
			}
		}

		return [...groups.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
	}

	function formatRelativeTime(timestamp: number | null): string {
		if (!timestamp || !Number.isFinite(timestamp)) return 'unknown';
		const delta = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
		if (delta < 60) return 'just now';
		const m = Math.floor(delta / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		if (d < 7) return `${d}d ago`;
		return new Date(timestamp).toLocaleDateString();
	}

	function statusClass(status: string): string {
		if (status === 'active' || status.startsWith('active')) return 'active';
		if (status === 'systemError') return 'error';
		return '';
	}

	function isGroupCollapsed(group: ThreadGroup): boolean {
		return collapsedWorkspaceKeys.includes(group.key);
	}

	function toggleGroup(group: ThreadGroup) {
		if (collapsedWorkspaceKeys.includes(group.key)) {
			collapsedWorkspaceKeys = collapsedWorkspaceKeys.filter((key) => key !== group.key);
		} else {
			collapsedWorkspaceKeys = [...collapsedWorkspaceKeys, group.key];
		}
	}

	function isThreadListExpanded(group: ThreadGroup): boolean {
		return expandedThreadListKeys.includes(group.key);
	}

	function visibleGroupThreads(group: ThreadGroup): ThreadSummary[] {
		if (group.threads.length <= maxCollapsedThreads || isThreadListExpanded(group)) {
			return group.threads;
		}

		const visible = group.threads.slice(0, maxCollapsedThreads);
		const selected = selectedThreadId
			? group.threads.find((thread) => thread.id === selectedThreadId)
			: null;

		if (selected && !visible.some((thread) => thread.id === selected.id)) {
			return [...visible, selected];
		}

		return visible;
	}

	function hiddenThreadCount(group: ThreadGroup): number {
		return Math.max(0, group.threads.length - visibleGroupThreads(group).length);
	}

	function toggleThreadList(group: ThreadGroup) {
		if (isThreadListExpanded(group)) {
			expandedThreadListKeys = expandedThreadListKeys.filter((key) => key !== group.key);
		} else {
			expandedThreadListKeys = [...expandedThreadListKeys, group.key];
		}
	}

	function openThreadManager(event: MouseEvent, thread: ThreadSummary) {
		event.preventDefault();
		event.stopPropagation();
		onManage(thread, { x: event.clientX, y: event.clientY });
	}

	function openThreadManagerFromButton(event: MouseEvent | KeyboardEvent, thread: ThreadSummary) {
		event.preventDefault();
		event.stopPropagation();
		const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
		onManage(thread, { x: rect.right, y: rect.bottom + 6 });
	}

	$effect(() => {
		const groupKeys = threadGroups.map((group) => group.key);

		if (!restoredCollapseState) {
			collapsedWorkspaceKeys = readStoredKeys(collapsedWorkspaceStorageKey) ?? groupKeys;
			expandedThreadListKeys = [];
			removeStoredKey(legacyExpandedThreadListStorageKey);
			knownWorkspaceKeys = groupKeys;
			restoredCollapseState = true;
			return;
		}

		const existingGroupKeys = new Set(groupKeys);
		const known = new Set(knownWorkspaceKeys);
		const newGroupKeys = groupKeys.filter((key) => !known.has(key));
		const nextCollapsedKeys = uniqueKeys([
			...collapsedWorkspaceKeys.filter((key) => existingGroupKeys.has(key)),
			...newGroupKeys
		]);
		const nextExpandedKeys = expandedThreadListKeys.filter((key) => existingGroupKeys.has(key));

		if (!sameKeys(collapsedWorkspaceKeys, nextCollapsedKeys)) {
			collapsedWorkspaceKeys = nextCollapsedKeys;
		}
		if (!sameKeys(expandedThreadListKeys, nextExpandedKeys)) {
			expandedThreadListKeys = nextExpandedKeys;
		}
		if (!sameKeys(knownWorkspaceKeys, groupKeys)) {
			knownWorkspaceKeys = groupKeys;
		}
	});

	$effect(() => {
		if (!restoredCollapseState) return;
		writeStoredKeys(collapsedWorkspaceStorageKey, collapsedWorkspaceKeys);
	});
</script>

<section class="thread-list">
	<div class="thread-items">
		{#if threads.length === 0}
			<p class="empty">No threads yet.</p>
		{:else}
			{#each threadGroups as group, index (group.key)}
				<div class="workspace-group">
					<button
						type="button"
						class:collapsed={isGroupCollapsed(group)}
						class="workspace-group-header"
						aria-expanded={!isGroupCollapsed(group)}
						aria-controls={`workspace-thread-list-${index}`}
						onclick={() => toggleGroup(group)}
					>
						<div class="workspace-group-title">
							<svg class="workspace-chevron" viewBox="0 0 16 16" aria-hidden="true">
								<path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
							</svg>
							<span class="workspace-name">{group.name}</span>
							<span class="workspace-count">{group.count}</span>
						</div>
						<span class="workspace-path" title={group.path}>{group.path}</span>
					</button>
					{#if !isGroupCollapsed(group)}
						<div class="workspace-thread-list" id={`workspace-thread-list-${index}`}>
							{#each visibleGroupThreads(group) as thread (thread.id)}
								<div
									class:selected={thread.id === selectedThreadId}
									class="thread-item-row"
								>
									<button
										type="button"
										class="thread-item"
										onclick={() => onSelect(thread.id)}
										oncontextmenu={(event) => openThreadManager(event, thread)}
									>
										<span class="thread-copy">
											<span class="thread-title">{thread.title}</span>
											<span class="thread-preview">{thread.preview || thread.cwd}</span>
											<span class="thread-meta">
												<span class="status {statusClass(thread.status)}">
													<span class="status-dot"></span>
													{thread.status === 'idle' ? 'idle' : thread.status}
												</span>
												<span>{formatRelativeTime(thread.updatedAt)}</span>
											</span>
										</span>
									</button>
									<button
										type="button"
										class="thread-manage"
										aria-label={`管理对话：${thread.title}`}
										title="管理"
										onclick={(event) => openThreadManagerFromButton(event, thread)}
									>
										<svg viewBox="0 0 20 20" aria-hidden="true">
											<circle cx="5" cy="10" r="1.5" />
											<circle cx="10" cy="10" r="1.5" />
											<circle cx="15" cy="10" r="1.5" />
										</svg>
									</button>
								</div>
							{/each}
							{#if group.threads.length > maxCollapsedThreads}
								<button
									type="button"
									class="thread-list-toggle"
									onclick={() => toggleThreadList(group)}
								>
									{#if isThreadListExpanded(group)}
										Show fewer
									{:else}
										Show {hiddenThreadCount(group)} more
									{/if}
								</button>
							{/if}
						</div>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</section>
