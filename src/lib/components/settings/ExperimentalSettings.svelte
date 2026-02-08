<script lang="ts">
  import { settings } from '$lib/stores/settings.svelte'
  import {
    FlaskConical,
    Download,
    Loader2,
    RotateCcw,
    AlertTriangle,
    Database,
    Undo2,
    GitBranch,
    Clock,
    ShieldCheck,
  } from 'lucide-svelte'
  import { Switch } from '$lib/components/ui/switch'
  import { Label } from '$lib/components/ui/label'
  import { Button } from '$lib/components/ui/button'
  import { Slider } from '$lib/components/ui/slider'
  import { Separator } from '$lib/components/ui/separator'

  let isBackingUp = $state(false)
  let backupResult = $state<{ success: boolean; message: string } | null>(null)
  let hasEverBackedUp = $state(false)

  async function handleBackup() {
    isBackingUp = true
    backupResult = null
    try {
      const { backupService } = await import('$lib/services/backupService')
      const result = await backupService.createFullBackup()
      if (result) {
        backupResult = { success: true, message: 'Backup created successfully!' }
        hasEverBackedUp = true
      } else {
        backupResult = { success: false, message: 'Backup cancelled.' }
      }
    } catch (error) {
      console.error('[ExperimentalSettings] Backup failed:', error)
      backupResult = {
        success: false,
        message: `Backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      }
    } finally {
      isBackingUp = false
    }
  }

  async function handleStateTrackingToggle(checked: boolean) {
    if (checked && !hasEverBackedUp) {
      // Recommend backup before enabling
      const shouldContinue = confirm(
        'It is strongly recommended to download a full backup before enabling experimental features.\n\nWould you like to continue without a backup?',
      )
      if (!shouldContinue) return
    }
    await settings.updateExperimentalFeatures({ stateTracking: checked })
  }

  async function handleRollbackToggle(checked: boolean) {
    await settings.updateExperimentalFeatures({ rollbackOnDelete: checked })
  }

  async function handleLightweightBranchesToggle(checked: boolean) {
    await settings.updateExperimentalFeatures({ lightweightBranches: checked })
  }

  async function handleSnapshotIntervalChange(value: number) {
    await settings.updateExperimentalFeatures({ autoSnapshotInterval: value })
  }

  async function handleResetAll() {
    await settings.resetExperimentalFeatures()
  }
</script>

<div class="space-y-6">
  <!-- Header Banner -->
  <div class="bg-amber-500/10 border-amber-500/30 flex items-start gap-3 rounded-lg border p-4">
    <AlertTriangle class="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
    <div class="space-y-1">
      <p class="text-sm font-medium text-amber-500">Experimental Features</p>
      <p class="text-muted-foreground text-xs">
        These features are in active development. They may change behavior or data formats.
        <strong>Always create a backup before enabling.</strong>
      </p>
    </div>
  </div>

  <!-- Backup Section -->
  <div class="bg-muted/30 space-y-3 rounded-lg border p-4">
    <div class="flex items-center gap-2">
      <ShieldCheck class="text-primary h-4 w-4" />
      <Label class="text-sm font-medium">Data Safety</Label>
    </div>
    <p class="text-muted-foreground text-xs">
      Download a full backup of your database and all stories as a ZIP archive. Includes the raw
      SQLite database and individual story exports (.avt) for maximum safety.
    </p>
    <div class="flex items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        onclick={handleBackup}
        disabled={isBackingUp}
        class="gap-2"
      >
        {#if isBackingUp}
          <Loader2 class="h-4 w-4 animate-spin" />
          Creating Backup...
        {:else}
          <Download class="h-4 w-4" />
          Download Full Backup
        {/if}
      </Button>
      {#if backupResult}
        <p
          class="text-xs {backupResult.success
            ? 'text-green-500'
            : 'text-destructive'}"
        >
          {backupResult.message}
        </p>
      {/if}
    </div>
  </div>

  <Separator />

  <!-- Feature Toggles -->
  <div class="space-y-5">
    <div class="flex items-center gap-2">
      <FlaskConical class="text-muted-foreground h-4 w-4" />
      <Label class="text-sm font-medium">Feature Toggles</Label>
    </div>

    <!-- State Tracking -->
    <div class="flex flex-row items-center justify-between">
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Database class="text-muted-foreground h-4 w-4" />
          <Label>State Tracking</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          Record world state changes (deltas) on each story entry after AI classification. This is
          the foundation for rollback and lightweight branches.
        </p>
        {#if settings.experimentalFeatures.stateTracking}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — deltas will be recorded on new entries.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.stateTracking}
        onCheckedChange={handleStateTrackingToggle}
      />
    </div>

    <!-- Rollback on Delete -->
    <div
      class="flex flex-row items-center justify-between {!settings.experimentalFeatures
        .stateTracking
        ? 'opacity-50'
        : ''}"
    >
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <Undo2 class="text-muted-foreground h-4 w-4" />
          <Label>Rollback on Delete</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          When deleting a message, automatically undo all world state changes from that point
          onward. Entries after the deleted one are also removed (cascade).
        </p>
        {#if !settings.experimentalFeatures.stateTracking}
          <p class="text-muted-foreground pt-1 text-xs italic">
            Requires State Tracking to be enabled.
          </p>
        {:else if settings.experimentalFeatures.rollbackOnDelete}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — deleting entries will cascade and rollback state.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.rollbackOnDelete}
        onCheckedChange={handleRollbackToggle}
        disabled={!settings.experimentalFeatures.stateTracking}
      />
    </div>

    <!-- Lightweight Branches -->
    <div
      class="flex flex-row items-center justify-between {!settings.experimentalFeatures
        .stateTracking
        ? 'opacity-50'
        : ''}"
    >
      <div class="space-y-0.5">
        <div class="flex items-center gap-2">
          <GitBranch class="text-muted-foreground h-4 w-4" />
          <Label>Lightweight Branches</Label>
        </div>
        <p class="text-muted-foreground text-xs">
          New branches share parent world state instead of copying all entities. Changes are
          copy-on-write — only modified entities get duplicated.
        </p>
        {#if !settings.experimentalFeatures.stateTracking}
          <p class="text-muted-foreground pt-1 text-xs italic">
            Requires State Tracking to be enabled.
          </p>
        {:else if settings.experimentalFeatures.lightweightBranches}
          <p class="pt-1 text-xs font-medium text-amber-500">
            Active — new branches will use copy-on-write.
          </p>
        {/if}
      </div>
      <Switch
        checked={settings.experimentalFeatures.lightweightBranches}
        onCheckedChange={handleLightweightBranchesToggle}
        disabled={!settings.experimentalFeatures.stateTracking}
      />
    </div>
  </div>

  <Separator />

  <!-- Snapshot Interval -->
  <div
    class="space-y-3 {!settings.experimentalFeatures.stateTracking ? 'opacity-50' : ''}"
  >
    <div class="flex items-center gap-2">
      <Clock class="text-muted-foreground h-4 w-4" />
      <Label>Auto-Snapshot Interval</Label>
    </div>
    <p class="text-muted-foreground text-xs">
      Number of entries between automatic world state snapshots. Lower values allow faster rollback
      but use more storage.
    </p>
    <div class="flex items-center gap-4">
      <Slider
        type="single"
        value={settings.experimentalFeatures.autoSnapshotInterval}
        onValueChange={handleSnapshotIntervalChange}
        min={5}
        max={100}
        step={5}
        disabled={!settings.experimentalFeatures.stateTracking}
        class="flex-1"
      />
      <span class="text-muted-foreground w-12 text-right text-sm font-mono">
        {settings.experimentalFeatures.autoSnapshotInterval}
      </span>
    </div>
  </div>

  <Separator />

  <!-- Reset Button -->
  <div class="flex items-center justify-between">
    <div class="space-y-0.5">
      <p class="text-sm font-medium">Reset Experimental Features</p>
      <p class="text-muted-foreground text-xs">
        Disable all experimental features and reset to defaults.
      </p>
    </div>
    <Button variant="outline" size="sm" onclick={handleResetAll} class="gap-2">
      <RotateCcw class="h-4 w-4" />
      Reset
    </Button>
  </div>
</div>
