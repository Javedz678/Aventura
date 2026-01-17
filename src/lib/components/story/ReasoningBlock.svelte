<script lang="ts">
  import { slide } from 'svelte/transition';
  import { parseMarkdown } from '$lib/utils/markdown';
  import { ui } from '$lib/stores/ui.svelte';
  import { settings } from '$lib/stores/settings.svelte';

  let { 
    content, 
    isStreaming = false,
    entryId,
  }: { 
    content: string; 
    isStreaming?: boolean;
    entryId?: string;
  } = $props();

  // Use persistent state from UI store shared between StoryEntry and StreamingEntry
  let isOpen = $derived.by(() => {
    if (isStreaming) {
      return ui.streamingReasoningExpanded;
    }
    return entryId ? ui.isReasoningExpanded(entryId) : false;
  });

  // Toggle function that updates the appropriate store
  function toggleOpen() {
    if (isStreaming) {
      ui.setStreamingReasoningExpanded(!isOpen);
    } else if (entryId) {
      ui.toggleReasoningExpanded(entryId, !isOpen);
    }
  }

  let isVisible = $derived(settings.uiSettings.showReasoning || isStreaming);

  // Clean content to prevent list items breaking into new lines (LLM artifact)
  let cleanedContent = $derived(content);
  
  let renderedContent = $derived(parseMarkdown(cleanedContent));
</script>

{#if isVisible}
  <div class="mb-4">
    {#if !settings.uiSettings.showReasoning && isStreaming}
      <div class="flex items-center gap-2 text-left w-full bg-transparent border-none p-0 h-7">
        <div class="flex items-center gap-2 text-surface-400">
          <span class="text-sm italic">Thinking</span>
          <span class="thinking-dots">
            <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
          </span>
        </div>
      </div>
    {:else}
      <button 
        class="flex items-center gap-2 text-left w-full bg-transparent border-none p-0 cursor-pointer group h-7"
        onclick={toggleOpen}
        title={isOpen ? "Collapse thought process" : "Expand thought process"}
      >
        <div class="flex items-center gap-2 text-surface-400">
          {#if isStreaming}
            <span class="text-sm italic">Thinking</span>
            <span class="thinking-dots">
              <span class="dot">.</span><span class="dot">.</span><span class="dot">.</span>
            </span>
          {:else}
            <span class="text-xs font-medium">Thought Process</span>
          {/if}
          
          <span class="text-xs opacity-50">{isOpen ? '▼' : '▶'}</span>
        </div>
      </button>
    {/if}
    
    {#if isOpen}
      <div class="border-l-2 border-surface-400 pl-4 prose-content mt-2 text-sm text-surface-400 italic break-words" transition:slide={{ duration: 200 }}>
        {@html renderedContent}
      </div>
    {/if}
  </div>
{/if}

<style>
  /* Thinking dots animation */
  @keyframes dot-pulse {
    0%, 20% { opacity: 0.2; }
    40% { opacity: 1; }
    60%, 100% { opacity: 0.2; }
  }

  .thinking-dots .dot {
    animation: dot-pulse 1.4s infinite;
    font-weight: bold;
    color: var(--color-accent-400, #60a5fa);
  }

  .thinking-dots .dot:nth-child(1) { animation-delay: 0s; }
  .thinking-dots .dot:nth-child(2) { animation-delay: 0.2s; }
  .thinking-dots .dot:nth-child(3) { animation-delay: 0.4s; }
</style>
