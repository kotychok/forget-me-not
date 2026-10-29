<script lang="ts">
  import { onMount } from 'svelte';
  import { accountsApi } from '../lib/accounts';
  import type { LinkInfo } from '../lib/accounts';
  let token = '';
  let info = $state<LinkInfo | null>(null);
  let error = $state('');
  let loading = $state(true);
  let busy = $state(false);
  let done = $state(false);
  let password = $state('');
  let confirmation = $state('');
  let generation = 0;
  function readLink() {
    const current = ++generation;
    token = new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    const raw = token;
    history.replaceState(null, '', location.pathname);
    info = null;
    error = '';
    loading = true;
    done = false;
    busy = false;
    password = '';
    confirmation = '';
    if (!raw) {
      error =
        'No access link was provided. Ask the administrator for a new link.';
      loading = false;
      return;
    }
    void accountsApi
      .preview(raw)
      .then((value) => {
        if (current === generation) info = value;
      })
      .catch((e) => {
        if (current === generation)
          error = e instanceof Error ? e.message : 'Could not check link';
      })
      .finally(() => {
        if (current === generation) loading = false;
      });
  }
  onMount(() => {
    readLink();
    window.addEventListener('hashchange', readLink);
    return () => {
      generation++;
      token = '';
      window.removeEventListener('hashchange', readLink);
    };
  });
  async function submit() {
    if (busy) return;
    const current = generation;
    const raw = token;
    busy = true;
    error = '';
    try {
      if (password !== confirmation) throw new Error('Passwords do not match');
      await accountsApi.redeem(raw, password);
      if (current !== generation) return;
      token = '';
      password = '';
      confirmation = '';
      done = true;
    } catch (e) {
      if (current === generation)
        error = e instanceof Error ? e.message : 'Could not set password';
    } finally {
      if (current === generation) busy = false;
    }
  }
</script>

<svelte:head><meta name="referrer" content="no-referrer" /></svelte:head>
<main class="access-page activation-page">
  <div class="eyebrow">FORGET ME NOT</div>
  <h1>
    {done
      ? 'You’re ready.'
      : info?.purpose === 'reset'
        ? 'Reset password'
        : 'Activate account'}
  </h1>
  {#if loading}<p role="status">Checking your access link…</p>
  {:else if done}<p role="status">
      Password saved. Sign in using your login and new password.
    </p>
    <a class="primary-link" href="/">Go to sign in</a>
  {:else if info}<p>
      Choose a password for <strong>{info.login}</strong>. At least 12
      characters. This link expires {new Date(
        info.expiresAt * 1000,
      ).toLocaleString()}.
    </p>
    <form
      onsubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label for="activation-password">New password</label><input
        id="activation-password"
        type="password"
        autocomplete="new-password"
        minlength="12"
        bind:value={password}
        required
      />
      <label for="activation-confirm">Repeat password</label><input
        id="activation-confirm"
        type="password"
        autocomplete="new-password"
        minlength="12"
        bind:value={confirmation}
        required
      />
      <button disabled={busy}>Set password</button>
    </form>
  {/if}
  {#if error}<p class="error-message" role="alert">{error}</p>{/if}
  {#if !loading && !info && !done}<a href="/">Back to sign in</a>{/if}
</main>
