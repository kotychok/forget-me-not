<script lang="ts">
  import { markdown } from '../lib/markdown';
  import type { MarkdownNode } from '../lib/markdown';
  import { compactUrl } from '../lib/links';
  import MarkedText from './MarkedText.svelte';
  let {
    text,
    query = '',
    interactive = false,
  }: { text: string; query?: string; interactive?: boolean } = $props();
  const document = $derived(markdown(text));
</script>

{#snippet content(node: MarkdownNode)}
  {#if node.compact && node.text}<MarkedText
      text={compactUrl(node.text)}
      {query}
    />{:else if node.children}{@render render(node.children)}{:else}<MarkedText
      text={node.text ?? ''}
      {query}
    />{/if}
{/snippet}
{#snippet render(nodes: MarkdownNode[])}
  {#each nodes as node}
    {#if node.kind === 'source'}<span class="md-source"
        ><MarkedText text={node.text ?? ''} {query} /></span
      >
    {:else if node.kind === 'strong'}<strong>{@render content(node)}</strong>
    {:else if node.kind === 'em'}<em>{@render content(node)}</em>
    {:else if node.kind === 'del'}<del>{@render content(node)}</del>
    {:else if node.kind === 'code'}<code>{@render content(node)}</code>
    {:else if node.kind === 'codeblock'}<code class="md-codeblock"
        >{@render content(node)}</code
      >
    {:else if node.kind === 'break'}<br />
    {:else if node.kind === 'link'}
      {#if node.href && interactive}<a
          href={node.href}
          target="_blank"
          rel="noopener noreferrer">{@render content(node)}</a
        >
      {:else}<span class:md-link={!!node.href} title={node.href}
          >{@render content(node)}</span
        >{/if}
    {:else if node.kind === 'paragraph'}<span class="md-paragraph"
        >{@render content(node)}</span
      >
    {:else if node.kind === 'heading'}<span
        class={`md-heading md-h${node.level}`}>{@render content(node)}</span
      >
    {:else if node.kind === 'quote'}<span class="md-quote"
        >{@render content(node)}</span
      >
    {:else if node.kind === 'list'}<span class="md-list"
        >{@render content(node)}</span
      >
    {:else if node.kind === 'listitem'}<span class="md-listitem"
        ><span class="md-marker">{node.marker ?? ''}</span><span
          >{@render content(node)}</span
        ></span
      >
    {:else if node.kind === 'rule'}<span class="md-rule" aria-hidden="true"
      ></span>
    {:else}<MarkedText text={node.text ?? ''} {query} />{/if}
  {/each}
{/snippet}
<span
  class="markdown-view"
  class:md-fallback={document.fallback}
  title={document.fallback ? 'Complex formatting: showing source' : undefined}
  >{@render render(document.nodes)}</span
>
