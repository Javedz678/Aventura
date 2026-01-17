<script lang="ts">
  import { ui } from '$lib/stores/ui.svelte';
  import { BookOpen } from 'lucide-svelte';
  import { parseMarkdown } from '$lib/utils/markdown';
  import ReasoningBlock from './ReasoningBlock.svelte';

  // Reactive binding to streaming content
  let content = $derived(ui.streamingContent);
  
  // Check if streaming in Visual Prose mode
  let isVisualProse = $derived(ui.isVisualProseStreaming());
  
  // For Visual Prose, content is already wrapped HTML; for regular, parse as markdown
  let renderedContent = $derived(
    isVisualProse ? content : parseMarkdown(content)
  );

  // Show thinking state when streaming but no content yet (and no reasoning)
  let reasoning = $derived(ui.streamingReasoning);
  let isThinking = $derived(ui.isStreaming && content.length === 0 && reasoning.length === 0);
</script>

  <!-- Streaming content container -->
  <div class="rounded-lg border-l-4 border-l-accent-500 bg-accent-500/5 p-4 animate-fade-in">
    <div class="flex items-start gap-3">
      <!-- Icon Column -->
      <div class="rounded-full bg-surface-700 p-1.5">
        <BookOpen class="h-4 w-4 text-accent-400 animate-pulse" />
      </div>

      <!-- Main Content Column -->
      <div class="flex-1 min-w-0 flex flex-col gap-4">
        <!-- Reasoning Block -->
        {#if reasoning || isThinking}
          <ReasoningBlock content={reasoning} isStreaming={true} />
        {/if}

        <!-- Story Content -->
        {#if content.length > 0}
          <div class="story-text prose-content streaming-content animate-fade-in">
            {@html renderedContent}<span class="streaming-cursor"></span>
          </div>
        {/if}
      </div>
    </div>
  </div>

<style>
  @keyframes blink {
    0%, 50% { opacity: 1; }
    51%, 100% { opacity: 0; }
  }

  @keyframes fade-in {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes dot-pulse {
    0%, 20% { opacity: 0.2; }
    40% { opacity: 1; }
    60%, 100% { opacity: 0.2; }
  }

  .animate-fade-in {
    animation: fade-in 0.3s ease-out;
  }

  /* Thinking dots animation */
  .thinking-dots .dot {
    animation: dot-pulse 1.4s infinite;
    font-weight: bold;
  }

  .thinking-dots .dot:nth-child(1) {
    animation-delay: 0s;
  }

  .thinking-dots .dot:nth-child(2) {
    animation-delay: 0.2s;
  }

  .thinking-dots .dot:nth-child(3) {
    animation-delay: 0.4s;
  }

  /* Streaming cursor that appears inline after the last content */
  .streaming-cursor {
    display: inline-block;
    width: 0.5rem;
    height: 1rem;
    margin-left: 0.125rem;
    background-color: var(--color-accent-400, #60a5fa);
    animation: blink 1s infinite;
    vertical-align: text-bottom;
  }

  /* Ensure the cursor appears after the last element in streaming content */
  :global(.streaming-content > *:last-child) {
    display: inline;
  }
</style>
