<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import type { SubmitFunction } from '@sveltejs/kit';

	let {
		tokenConfigured,
		setupMode,
		fallbackTokenActive,
		loginError,
		setupError
	}: {
		tokenConfigured: boolean;
		setupMode: boolean;
		fallbackTokenActive: boolean;
		loginError?: string;
		setupError?: string;
	} = $props();

	const enhanceRedirect: SubmitFunction = () => {
		return async ({ result, update }) => {
			if (result.type === 'redirect') {
				await goto(result.location, { invalidateAll: true });
				return;
			}
			await update();
		};
	};
</script>

<section class="login-shell">
	<div class="login-card">
		<h1>Codex Web Console</h1>

		{#if setupMode}
			<p>Set an access token to protect your console.</p>
			<p class="warning">
				This token will be saved locally and used for future logins.
			</p>

			<form method="POST" action="?/setup" class="login-form" use:enhance={enhanceRedirect}>
				<input
					name="token"
					type="password"
					aria-label="New access token"
					autocomplete="off"
					spellcheck="false"
					placeholder="Enter a new access token"
				/>
				<button type="submit">Save &amp; Continue</button>
			</form>

			{#if setupError}
				<p class="error">{setupError}</p>
			{/if}
		{:else}
			<p>Enter your access token to continue.</p>

			{#if fallbackTokenActive}
				<p class="warning">Dev fallback token is active.</p>
			{/if}

			<form method="POST" action="?/login" class="login-form" use:enhance={enhanceRedirect}>
				<input
					name="token"
					type="password"
					aria-label="Access token"
					autocomplete="off"
					spellcheck="false"
					placeholder="Paste token"
				/>
				<button type="submit">Continue</button>
			</form>

			{#if loginError}
				<p class="error">{loginError}</p>
			{/if}
		{/if}
	</div>
</section>
