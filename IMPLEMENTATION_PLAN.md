# Implementation Plan: Session-Based Stateful Database Rework

## TL;DR

Rework the database layer from "mutable latest-only" to "session-based event-sourced" state management. Every message records what changed (delta), enabling automatic rollback on delete and lightweight copy-on-write branches. Guarded behind feature toggles with a full backup system as safety net. Built in 5 phases, each independently shippable. Reuses existing `JSZip`, `ClassificationResult`, entity tables, and branch lineage infrastructure heavily.

**Core Principle**: The entity tables (`characters`, `locations`, `items`, `story_beats`, `entries`) remain the "latest materialized view." A new delta system tracks changes per story entry, enabling undo/redo and eliminating the need for full-copy branching.

---

## Architecture Overview

```
Current:
  Entry → Classify → Mutate entities (fire-and-forget) → Discard ClassificationResult
  Branch → Deep copy ALL entities → Independent silo
  Delete → Remove entry text only → Orphaned state changes

Proposed:
  Entry → Classify → Capture before-state → Mutate entities → Store delta on entry
  Branch → Create record only → COW on first modification → Share parent state
  Delete → Cascade delete entries from position → Undo deltas in reverse → State restored
```

---

## Phase 0: Safety Infrastructure (Feature Toggles + Backup)

### 0A. Feature Toggle System

**Goal**: Add an `experimentalFeatures` setting that gates all new behavior.

**Files to modify:**

1. **`src/lib/types/index.ts`** — Add new type:
   ```typescript
   export interface ExperimentalFeatures {
     stateTracking: boolean          // Phase 1: record deltas on entries
     rollbackOnDelete: boolean       // Phase 2: undo world state on delete
     lightweightBranches: boolean    // Phase 3: COW branches
     autoSnapshotInterval: number    // Entries between auto-snapshots (default 20)
   }
   ```
   All default to `false` / `20`.

2. **`src/lib/stores/settings.svelte.ts`** — Add:
   - New `$state` property: `experimentalFeatures` of type `ExperimentalFeatures`
   - Default factory function: `defaultExperimentalFeatures()`
   - `init()`: Load from DB key `experimental_features`
   - `saveExperimentalFeatures()`: Persist to DB key `experimental_features`
   - `resetExperimentalFeatures()`: Reset to defaults
   - Pattern: identical to how `serviceSpecificSettings` is handled (JSON-serialized to settings table)

3. **`src/lib/components/settings/SettingsModal.svelte`** — Add new tab:
   - Import `FlaskConical` from `lucide-svelte`
   - Add `{ id: 'experimental', label: 'Labs', icon: FlaskConical }` to `tabs` array
   - Add `'experimental'` to `SettingsTab` type union
   - Add `{:else if activeTab === 'experimental'}` rendering branch pointing to new component

4. **New file: `src/lib/components/settings/ExperimentalSettings.svelte`**
   - Toggle switches for each feature flag
   - Warning banners explaining each feature is experimental
   - "Download Backup" button (Phase 0B)
   - Auto-snapshot interval slider (10–100, default 20)
   - Visual dependency chain: `stateTracking` must be on before `rollbackOnDelete` can be enabled; `rollbackOnDelete` must be on before `lightweightBranches`
   - Reset button to disable all experimental features

### 0B. Full Backup System

**Goal**: Let users download a `.zip` containing the full SQLite DB + all stories as `.avt` JSON exports.

**New file: `src/lib/services/backupService.ts`**

The service orchestrates a complete backup:

1. **Create consistent DB snapshot** using `VACUUM INTO` via the existing `database` singleton:
   - Execute `VACUUM INTO '<tempPath>'` through `@tauri-apps/plugin-sql`
   - Read the resulting temp file via `readFile` from `@tauri-apps/plugin-fs`
   - Clean up temp file after reading
   - Requires importing `@tauri-apps/api/path` for `tempDir()` — first usage in codebase

2. **Export all stories** as `.avt` files:
   - Reuse existing `ExportCoordinationService.gatherStoryData(storyId)` for each story
   - Reuse existing `AventuraExport` format from `src/lib/services/export.ts`
   - Each story becomes `stories/<storyTitle>.avt` in the zip

3. **Export settings**:
   - Dump all keys from the `settings` table as `settings.json`
   - Reuse `database.getSetting()` pattern (or add a bulk `getAllSettings()` method)

4. **Create zip** using JSZip (already installed, pattern from `src/lib/services/imageExport.ts`):
   ```
   aventura-backup-YYYY-MM-DD/
   ├── metadata.json          # { version, createdAt, appVersion, schemaVersion, storyCount }
   ├── aventura.db            # Full SQLite snapshot (VACUUM INTO, no WAL issues)
   ├── settings.json          # All settings key-value pairs
   └── stories/
       ├── My Story.avt       # Per-story JSON export
       └── Another Story.avt
   ```

5. **Save via dialog** using `save()` from `@tauri-apps/plugin-dialog` + `writeFile()`:
   - Default filename: `aventura-backup-YYYY-MM-DD.zip`
   - Filter: `{ name: 'ZIP Archive', extensions: ['zip'] }`
   - Same pattern as existing export dialogs

**Database additions** in `src/lib/services/database.ts`:
- `getAllSettings(): Promise<Record<string, string>>` — `SELECT key, value FROM settings`
- `vacuumInto(destPath: string): Promise<void>` — `VACUUM INTO '${destPath}'`

**Capabilities** — `src-tauri/capabilities/default.json`:
- May need `fs:allow-remove` for temp cleanup and scope for `$TEMP`/`$APPCONFIG`

**UI integration** in `ExperimentalSettings.svelte`:
- "Download Full Backup" button with progress indicator
- Shows summary after completion (story count, DB size)
- **Auto-triggered**: Before enabling any experimental feature for the first time, prompt user to create a backup

---

## Phase 1: State Tracking (Record Deltas)

**Goal**: When the classifier runs after a message, record WHAT changed and WHAT the previous values were. No behavior changes yet — purely additive data recording.

### 1A. Schema Migration

**New file: `src-tauri/migrations/025_world_state_deltas.sql`**

```sql
-- Phase 1: Record world state changes per story entry
ALTER TABLE story_entries ADD COLUMN world_state_delta TEXT;

-- Phase 1: Auto-snapshots for fast state reconstruction
CREATE TABLE IF NOT EXISTS world_state_snapshots (
    id TEXT PRIMARY KEY,
    story_id TEXT NOT NULL,
    branch_id TEXT,
    entry_id TEXT NOT NULL,
    entry_position INTEGER NOT NULL,
    characters_snapshot TEXT NOT NULL,
    locations_snapshot TEXT NOT NULL,
    items_snapshot TEXT NOT NULL,
    story_beats_snapshot TEXT NOT NULL,
    lorebook_entries_snapshot TEXT,
    time_tracker_snapshot TEXT,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id) ON DELETE CASCADE,
    FOREIGN KEY (entry_id) REFERENCES story_entries(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wss_story_branch
  ON world_state_snapshots(story_id, branch_id);
CREATE INDEX IF NOT EXISTS idx_wss_position
  ON world_state_snapshots(story_id, branch_id, entry_position);
CREATE INDEX IF NOT EXISTS idx_wss_entry
  ON world_state_snapshots(entry_id);
```

**Register migration** in `src-tauri/src/lib.rs` — add `Migration { version: 25, ... }` following the existing `include_str!()` pattern.

### 1B. Type Definitions

**File: `src/lib/types/index.ts`** — Add:

```typescript
export interface WorldStateDelta {
  // The raw classification result
  classificationResult: ClassificationResult

  // Before-state of each entity that was UPDATED (for undo)
  previousState: {
    characters: Array<{
      id: string; name: string; status: string
      relationship: string | null; traits: string[]
      visualDescriptors: VisualDescriptors
    }>
    locations: Array<{
      id: string; name: string; visited: boolean
      current: boolean; description: string | null
    }>
    items: Array<{
      id: string; name: string; quantity: number
      equipped: boolean; location: string | null
    }>
    storyBeats: Array<{
      id: string; title: string; status: string
      description: string | null; resolvedAt: number | null
    }>
    currentLocationId: string | null
    timeTracker: TimeTracker | null
  }

  // IDs of entities CREATED at this entry (undo = delete these)
  createdEntities: {
    characterIds: string[]
    locationIds: string[]
    itemIds: string[]
    storyBeatIds: string[]
  }
}

export interface WorldStateSnapshot {
  id: string
  storyId: string
  branchId: string | null
  entryId: string
  entryPosition: number
  charactersSnapshot: Character[]
  locationsSnapshot: Location[]
  itemsSnapshot: Item[]
  storyBeatsSnapshot: StoryBeat[]
  lorebookEntriesSnapshot?: Entry[]
  timeTrackerSnapshot: TimeTracker | null
  createdAt: number
}
```

Update `StoryEntry` interface:
```typescript
// Add to StoryEntry
worldStateDelta?: WorldStateDelta | null
```

### 1C. Database Layer

**File: `src/lib/services/database.ts`** — Modify:

1. **`mapStoryEntry()`** (~line 1843):
   - Add `worldStateDelta: row.world_state_delta ? JSON.parse(row.world_state_delta) : null`

2. **`addStoryEntry()`** (~line 416):
   - Add `world_state_delta` to INSERT: `JSON.stringify(entry.worldStateDelta) ?? null`

3. **`updateStoryEntry()`** (~line 490):
   - Add `worldStateDelta` to the dynamic SET builder (mapped to `world_state_delta`)

4. **New methods** for snapshots (follow existing checkpoint patterns):
   ```typescript
   createWorldStateSnapshot(snapshot: WorldStateSnapshot): Promise<void>
   getWorldStateSnapshots(storyId: string, branchId: string | null): Promise<WorldStateSnapshot[]>
   getLatestSnapshotBefore(storyId: string, branchId: string | null, position: number): Promise<WorldStateSnapshot | null>
   deleteWorldStateSnapshotsAfter(storyId: string, branchId: string | null, position: number): Promise<void>
   deleteWorldStateSnapshotsForBranch(branchId: string): Promise<void>
   ```

### 1D. Delta Capture in Classification

**File: `src/lib/stores/story.svelte.ts`** — Modify `applyClassificationResult()` (~line 1277):

**Before** existing mutation logic, add `captureBeforeState()`:
1. For each `characterUpdate`: snapshot `{ id, name, status, relationship, traits, visualDescriptors }`
2. For each `locationUpdate`: snapshot `{ id, name, visited, current, description }`
3. For each `itemUpdate`: snapshot `{ id, name, quantity, equipped, location }`
4. For each `storyBeatUpdate`: snapshot `{ id, title, status, description, resolvedAt }`
5. Capture `currentLocationId` (location with `current === true`)
6. Capture current `timeTracker`

**After** mutation logic, collect created entity IDs and build the `WorldStateDelta`.

**Gate behind `settings.experimentalFeatures.stateTracking`**.

Save via `database.updateStoryEntry(entryId, { worldStateDelta: delta })`.

### 1E. Auto-Snapshot Creation

**New method in `src/lib/stores/story.svelte.ts`**: `maybeCreateAutoSnapshot(entryId, position)`
- Only runs if `stateTracking` is `true`
- Checks: `position % autoSnapshotInterval === 0`
- Creates `WorldStateSnapshot` from current in-memory state
- Saves via `database.createWorldStateSnapshot()`

**Call site**: End of `applyClassificationResult()`, after delta is saved.

---

## Phase 2: Rollback on Delete (Cascade)

**Goal**: When deleting a message, all entries from that position onward are removed AND their world state changes are undone automatically.

### 2A. Rollback Engine

**New file: `src/lib/services/rollbackService.ts`**

```typescript
rollbackFromPosition(storyId, branchId, fromPosition): Promise<void>
```

1. Collect entries at `position >= fromPosition` for the given branch, ordered `position DESC`
2. For each entry with non-null `worldStateDelta`:
   - Delete created entities (by ID from `delta.createdEntities`) using existing `database.delete*()` methods
   - Restore updated entities to `delta.previousState` values using existing `database.update*()` methods
3. Restore time tracker from the first rolled-back entry's `previousState.timeTracker`
4. Restore current location from `previousState.currentLocationId`
5. Delete auto-snapshots after `fromPosition`

**Reuses**: All existing `database.deleteCharacter()`, `database.updateCharacter()`, etc. No new DB methods needed for rollback itself.

### 2B. Integration into Delete Flow

**File: `src/lib/stores/story.svelte.ts`** — Modify:

1. **`deleteEntry(entryId)`** (~line 637):
   - **When `rollbackOnDelete` + `stateTracking` enabled**: cascade delete from that position with full rollback
   - Call `rollbackService.rollbackFromPosition(...)` before existing deletion logic
   - Reload entities from DB after rollback

2. **`deleteEntriesFromPosition(position)`** (~line 790):
   - Add rollback call before deletion when toggle is on
   - Existing code already handles entry/chapter/image cleanup

3. **Fallback**: Entries without `worldStateDelta` (pre-Phase 1) skip delta rollback with a warning log.

### 2C. Retry System Integration

Existing retry backup system is **NOT removed** — serves as fallback. When rollback is on, retry restore simplifies to `deleteEntriesFromPosition()` which now handles world state automatically.

**No changes to `RetryBackup` type or `createRetryBackup()`**.

---

## Phase 3: Lightweight Branches (Copy-on-Write)

**Goal**: Eliminate entity duplication on branch creation. New branches inherit parent state; only create entity rows when something changes.

### 3A. Schema Migration

**New file: `src-tauri/migrations/026_cow_branches.sql`**

```sql
-- Phase 3: Copy-on-Write branch support
ALTER TABLE characters ADD COLUMN overrides_id TEXT;
ALTER TABLE locations ADD COLUMN overrides_id TEXT;
ALTER TABLE items ADD COLUMN overrides_id TEXT;
ALTER TABLE story_beats ADD COLUMN overrides_id TEXT;
ALTER TABLE entries ADD COLUMN overrides_id TEXT;
```

`overrides_id` = the ID of the parent entity this row overrides. `NULL` = original entity.

### 3B. Type Changes

**File: `src/lib/types/index.ts`** — Add `overridesId?: string | null` to:
- `Character`, `Location`, `Item`, `StoryBeat`, `Entry` (lorebook)

### 3C. Database Layer

**File: `src/lib/services/database.ts`** — Modify:

1. **All `map*()` methods**: Add `overridesId: row.overrides_id ?? null`
2. **All `add*()` methods**: Include `overrides_id` in INSERT (default null)
3. **New resolution methods** (one per entity type):
   ```typescript
   getCharactersResolvedForBranch(storyId, branchId, lineage): Promise<Character[]>
   getLocationsResolvedForBranch(storyId, branchId, lineage): Promise<Location[]>
   getItemsResolvedForBranch(storyId, branchId, lineage): Promise<Item[]>
   getStoryBeatsResolvedForBranch(storyId, branchId, lineage): Promise<StoryBeat[]>
   getEntriesResolvedForBranch(storyId, branchId, lineage): Promise<Entry[]>
   ```
   Pattern:
   - Load main-branch entities (`branch_id IS NULL`)
   - For each branch in lineage, load branch-specific entities
   - Build `Map<originalId, entity>` where `originalId = entity.overridesId ?? entity.id`
   - Later lineage entries override earlier
   - Return merged array

4. **Existing `*ForBranch()` methods**: Keep as-is for backward compatibility

### 3D. Branch Creation Rework

**File: `src/lib/stores/story.svelte.ts`** — Modify `createBranchFromCheckpoint()` (~line 1981):

**When `lightweightBranches` OFF** — existing flow preserved (deep copy all entities)

**When `lightweightBranches` ON**:
1. Create branch record (same)
2. **Skip entity copying entirely**
3. Create `WorldStateSnapshot` at fork point
4. Switch to branch
5. Load entities via resolved methods

### 3E. Copy-on-Write Modification

**File: `src/lib/stores/story.svelte.ts`** — Modify `applyClassificationResult()`:

When updating an inherited entity on a non-main branch (`entity.branchId !== currentBranchId` and `lightweightBranches` on):
1. Create new entity row: `{ ...parentEntity, id: newUUID, branchId, overridesId: parentEntity.id }`
2. Apply the update to the new row
3. Save via existing `database.add*()` methods

### 3F. Entity Loading Rework

**File: `src/lib/stores/story.svelte.ts`** — Modify `reloadEntriesForCurrentBranch()`:

For non-main COW branches: replace `getXForBranch()` with `getXResolvedForBranch()`.

Story entry loading unchanged — existing lineage assembly already works correctly.

### 3G. Existing Branch Compatibility

- **COW branches**: have entities with `overrides_id` set → use resolved loading
- **Legacy branches**: full entity copies, no `overrides_id` → use direct loading
- **Detection**: presence of `overrides_id IS NOT NULL` distinguishes COW from legacy

---

## File Change Summary

### New Files
| File | Phase | Purpose |
|---|---|---|
| `src/lib/services/backupService.ts` | 0B | Full backup zip creation |
| `src/lib/components/settings/ExperimentalSettings.svelte` | 0A | Feature toggle UI + backup button |
| `src/lib/services/rollbackService.ts` | 2A | World state rollback orchestration |
| `src-tauri/migrations/025_world_state_deltas.sql` | 1A | Delta column + snapshots table |
| `src-tauri/migrations/026_cow_branches.sql` | 3A | `overrides_id` columns |

### Modified Files
| File | Phases | Changes |
|---|---|---|
| `src/lib/types/index.ts` | 0A, 1B, 3B | `ExperimentalFeatures`, `WorldStateDelta`, `WorldStateSnapshot`, `overridesId` |
| `src/lib/stores/settings.svelte.ts` | 0A | `experimentalFeatures` state + load/save/reset |
| `src/lib/components/settings/SettingsModal.svelte` | 0A | New "Labs" tab |
| `src/lib/services/database.ts` | 0B, 1C, 3C | `getAllSettings()`, `vacuumInto()`, delta CRUD, snapshot CRUD, resolved loading |
| `src/lib/stores/story.svelte.ts` | 1D, 1E, 2B, 3D-F | Delta capture, snapshots, rollback, COW branch creation/modify/load |
| `src-tauri/src/lib.rs` | 1A, 3A | Register migrations 025, 026 |
| `src-tauri/capabilities/default.json` | 0B | `fs:allow-remove` if needed |
| `src/lib/stores/ui.svelte.ts` | 2C | Simplify retry when rollback available |
| `src/lib/components/story/ActionInput.svelte` | 1D | Delta save in classification flow |

### Unchanged (preserve exactly)
- All 24 existing migrations — never modify
- Existing `.avt` export/import format — handles null new columns via defaults
- Existing `createBranchFromCheckpoint` flow — preserved behind feature flag
- Existing retry backup system — fully preserved as fallback

---

## Feature Flag Dependencies

```
stateTracking ──► rollbackOnDelete ──► lightweightBranches
     │
     └──► autoSnapshotInterval (slider)
```

- `rollbackOnDelete` requires `stateTracking` (can't undo what wasn't recorded)
- `lightweightBranches` requires `stateTracking` (COW detection relies on deltas)
- Disabling `stateTracking` auto-disables both children (with confirmation dialog)

---

## Verification Checklist

### Phase 0
- [ ] Feature toggles persist across app restart
- [ ] Backup creates valid .zip with DB + .avt files
- [ ] Each .avt re-importable via existing import flow
- [ ] Backup works with branches, checkpoints, images
- [ ] `npm run check` passes

### Phase 1
- [ ] Migration 025 applies on existing DB
- [ ] Toggle ON → entries get `world_state_delta` JSON after classification
- [ ] Toggle OFF → delta is NULL
- [ ] Auto-snapshots at correct intervals
- [ ] Delta has valid before-state and created entity IDs

### Phase 2
- [ ] Delete → cascade removes all later entries
- [ ] Created entities removed on rollback
- [ ] Updated entities revert to before-values
- [ ] Time tracker + current location revert
- [ ] Pre-Phase-1 entries (no delta) handled gracefully
- [ ] Retry still works (both paths)

### Phase 3
- [ ] COW branch: zero entity rows on creation
- [ ] Inherited state displays correctly
- [ ] COW override created on modify
- [ ] Branch switch loads correct state
- [ ] Main branch unaffected by branch mods
- [ ] Legacy branches unchanged
- [ ] Deep lineage resolves correctly

---

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Backup contents | DB + .avt exports | Raw DB for full restore, .avt for per-story portability |
| Snapshot interval | Configurable (default 20) | User controls storage/performance tradeoff |
| COW scope | New branches only | Avoids risky migration of existing data |
| Rollback behavior | Cascade from position | Consistent state; mid-story undo without dependents is inconsistent |
| Delta storage | Column on `story_entries` | Reuses existing CRUD, minimal schema change |
| Zip library | JSZip (existing) | Already installed in imageExport.ts |
| Toggle location | Settings → "Labs" tab | Discoverable but clearly experimental |
| Retry system | Keep as-is | Safety fallback, zero regression risk |

---

## Risk Mitigation

| Risk | Mitigation |
|---|---|
| Data loss during migration | Backup system (Phase 0) built FIRST |
| Schema migration failure | New columns have NULL defaults — additive only, never destructive |
| Performance regression | Feature-toggled, disabled by default. Auto-snapshots prevent expensive replay |
| Inconsistent rollback | `previousState` captures exact before-values |
| COW resolution bugs | Legacy branches bypass COW entirely |
| Large delta JSON | ClassificationResult is typically <5KB |
| Corrupt backup | VACUUM INTO creates atomic consistent snapshot |
