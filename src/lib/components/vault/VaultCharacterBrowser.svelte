<script lang="ts">
  import { characterVault } from "$lib/stores/characterVault.svelte";
  import type { VaultCharacter, VaultCharacterType } from "$lib/types";
  import { Search, User, Users, Loader2 } from "lucide-svelte";
  import { normalizeImageDataUrl } from "$lib/utils/image";

  interface Props {
    onSelect: (character: VaultCharacter) => void;
    /** Filter by character type */
    filterType?: VaultCharacterType;
    /** ID of character that has been selected (to show visual indicator) */
    selectedCharacterId?: string | null;
    onNavigateToVault?: () => void;
  }

  let {
    onSelect,
    filterType,
    selectedCharacterId = null,
    onNavigateToVault,
  }: Props = $props();

  let searchQuery = $state("");

  const filteredCharacters = $derived.by(() => {
    let chars = characterVault.characters;

    // Filter by type if specified
    if (filterType) {
      chars = chars.filter((c) => c.characterType === filterType);
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      chars = chars.filter(
        (c) =>
          c.name.toLowerCase().includes(query) ||
          c.description?.toLowerCase().includes(query) ||
          c.traits.some((t) => t.toLowerCase().includes(query)),
      );
    }

    // Sort favorites first, then by updated
    return [...chars].sort((a, b) => {
      if (a.favorite && !b.favorite) return -1;
      if (!a.favorite && b.favorite) return 1;
      return b.updatedAt - a.updatedAt;
    });
  });

  const hasVaultCharacters = $derived(
    characterVault.isLoaded && filteredCharacters.length > 0,
  );

  const emptyMessage = $derived(
    filterType === "protagonist"
      ? "No protagonists in vault"
      : filterType === "supporting"
        ? "No supporting characters in vault"
        : "No characters in vault",
  );

  $effect(() => {
    if (!characterVault.isLoaded) {
      characterVault.load();
    }
  });

  function handleSelect(character: VaultCharacter) {
    onSelect(character);
  }

  function isSelected(characterId: string): boolean {
    return selectedCharacterId === characterId;
  }
</script>

<div class="space-y-3">
  <!-- Search -->
  {#if characterVault.characters.filter((c) => !filterType || c.characterType === filterType).length > 0}
    <div class="relative">
      <Search
        class="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-surface-500"
      />
      <input
        type="text"
        bind:value={searchQuery}
        placeholder="Search characters..."
        class="w-full rounded-lg border border-surface-600 bg-surface-800 pl-10 pr-3 py-2 text-sm text-surface-100 placeholder-surface-500 focus:border-accent-500 focus:outline-none"
      />
    </div>
  {/if}

  <!-- Character List -->
  <div class="max-h-64 overflow-y-auto">
    {#if !characterVault.isLoaded}
      <div class="flex h-32 items-center justify-center">
        <Loader2 class="h-6 w-6 animate-spin text-surface-500" />
      </div>
    {:else if filteredCharacters.length === 0}
      <div class="flex h-32 items-center justify-center">
        <div class="text-center">
          {#if filterType === "protagonist"}
            <User class="mx-auto h-8 w-8 text-surface-600" />
          {:else}
            <Users class="mx-auto h-8 w-8 text-surface-600" />
          {/if}
          <p class="mt-2 text-sm text-surface-400">
            {#if searchQuery}
              No characters match your search
            {:else}
              {emptyMessage}
            {/if}
          </p>
          {#if !searchQuery && onNavigateToVault}
            <button
              class="mt-3 px-3 py-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-xs text-surface-200 transition-colors"
              onclick={onNavigateToVault}
            >
              Go to Vault
            </button>
          {/if}
        </div>
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {#each filteredCharacters as character (character.id)}
          <button
            class="relative text-left rounded-lg border bg-surface-800 p-3 transition-all {isSelected(character.id)
              ? 'border-green-500 bg-green-500/10'
              : 'border-surface-700 hover:border-accent-500'}"
            onclick={() => handleSelect(character)}
          >
            {#if isSelected(character.id)}
              <div
                class="absolute top-2 right-2 text-xs text-green-400 bg-green-500/20 px-1.5 py-0.5 rounded"
              >
                Selected
              </div>
            {/if}
            <div class="flex items-start gap-2">
              <!-- Portrait -->
              {#if character.portrait}
                <img
                  src={normalizeImageDataUrl(character.portrait) ?? ""}
                  alt={character.name}
                  class="h-10 w-10 rounded-lg object-cover ring-1 ring-surface-600 shrink-0"
                />
              {:else if character.characterType === "protagonist"}
                <User class="h-5 w-5 text-accent-400 shrink-0 mt-0.5" />
              {:else}
                <Users class="h-5 w-5 text-surface-400 shrink-0 mt-0.5" />
              {/if}
              <div class="flex-1 min-w-0">
                <h4 class="font-medium text-surface-100 truncate text-sm">
                  {character.name}
                </h4>
                <p class="text-xs text-surface-400 mt-0.5">
                  {character.characterType === "protagonist"
                    ? "Protagonist"
                    : character.role || "Supporting"}
                </p>
              </div>
            </div>
          </button>
        {/each}
      </div>
    {/if}
  </div>
</div>
