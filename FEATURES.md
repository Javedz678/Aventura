# Aventura — New Features Guide

This guide covers all the new experimental features, how to enable them, and how to test them.

---

## How to Access

1. Click the **gear icon** to open Settings
2. Go to the **Experimental** tab
3. You'll find all the toggles, buttons, and options described below

---

## 1. Manual Backups

**What it does:** Creates a full backup of your entire database — all your stories, characters, locations, items, world state, and settings — saved into a single `.zip` file. The backup includes both the raw database and individual story exports (`.avt` files) for maximum safety.

**How to use:**
- Go to **Settings → Experimental**
- Click **"Download Backup"**
- Choose where to save the `.zip` file
- Done! Your backup is saved

**What's inside the backup:**
- Your complete database (all stories and world data)
- Each story exported individually as a `.avt` file
- All your app settings
- A metadata file with version info and timestamps

**Good to know:** The app keeps things clean — backups are just regular `.zip` files you can store anywhere you like.

---

## 2. Restore from Backup

**What it does:** If something goes wrong, you can roll back your entire app to a previous backup. The app replaces your current data with the backup version.

**How to use:**
1. Go to **Settings → Experimental**
2. Click **"Restore from Backup"**
3. A confirmation dialog will appear warning you that this will replace your entire database
4. Click **"Restore & Close App"**
5. Pick your backup `.zip` file
6. The app will close automatically — reopen it and everything will be restored

**Safety net:** Before restoring, the app saves a copy of your current database as `aventura-pre-restore.db`, just in case.

---

## 3. State Tracking

**What it does:** Records all the world state changes that happen with each story entry. Every time the AI narrates something and the classifier runs (detecting character changes, location discoveries, item pickups, time progression, etc.), the app saves a "before and after" snapshot of what changed. This is the foundation that makes Rollback and Lightweight Branches possible.

**How to enable:**
- Go to **Settings → Experimental**
- Turn on **"State Tracking"**
- The app will recommend creating a backup first (a good idea!)

**What gets tracked:**
- Characters: status changes, relationship changes, new characters appearing
- Locations: discoveries, becoming the current location
- Items: quantity changes, being equipped/unequipped
- Story beats: status changes, being resolved
- Time: in-story clock progression
- Current location changes

**Auto-Snapshot Interval:** You can also adjust how often a full world state snapshot is taken (default: every 20 entries). Lower values = faster rollback but more storage. You can adjust this with the slider that appears when State Tracking is enabled.

**Important:** State Tracking only records changes *going forward*. Entries created before turning this on won't have change data.

---

## 4. Time Travel (Rollback on Delete)

**What it does:** When you delete a story entry, the app doesn't just remove the text — it actually *reverses* all the world changes that entry caused. If a character was introduced, they get removed. If a location was discovered, it becomes undiscovered. If an item was picked up, it disappears. The in-story clock rewinds. It's like that entry never happened.

Deleting one entry also removes all entries that came after it (cascade delete), and undoes all their changes too.

**How to enable:**
- Go to **Settings → Experimental**
- Turn on **"State Tracking"** first (required)
- Then turn on **"Rollback on Delete"**

**How to test:**
1. Play through a few turns in a story
2. Notice characters appearing, locations being discovered, items being found, etc.
3. Delete the last entry (or any entry)
4. Watch the world state revert — characters, locations, items, time, and your current location all go back to how they were before

**What gets rolled back:**
- Characters created by deleted entries are removed
- Character status/relationship/traits changes are undone
- Location discoveries are reversed
- Items are restored to their previous state
- Story beat progress is reverted
- The in-story clock rewinds
- Your current location is restored

---

## 5. Lightweight Branches (Copy-on-Write)

**What it does:** You can create alternate timelines that split off from any point in your story. Branches are lightweight — they don't duplicate your entire world. Instead, they share the parent branch's world state and only store the *differences*. If you change a character's status on a branch, only that change is recorded — everything else is inherited from the parent.

**How to enable:**
- Go to **Settings → Experimental**
- Turn on **"State Tracking"** first (required)
- Then turn on **"Lightweight Branches"**

**How to use:**
1. Open the **Branches panel** in the sidebar
2. Create a new branch from any entry — this becomes the "fork point"
3. Switch between branches to explore different story paths
4. Each branch has its own entries and can have its own versions of characters, locations, items, and story beats

**Rules:**
- You can't delete a branch that has child branches — delete the children first (the delete button will be greyed out with a tooltip explaining why)
- You can't delete entries that belong to a parent branch while on a child branch
- When you modify a character/location/item on a branch, a copy is made automatically (copy-on-write) — the original on the parent branch stays unchanged

---

## 6. Smart Action Suggestions (Save & Restore)

**What it does:** The action choices (in Adventure mode) or writing suggestions (in Creative Writing mode) that appear after each narration are now **saved with each entry**. This means:

- When you **delete an entry** (time travel), the suggestions from the previous turn are automatically restored — you see the same choices you had before, not stale ones from the deleted position
- If you're playing a story from **before this feature was added** (no saved suggestions exist), the app will automatically regenerate new suggestions for you via an API call
- When you **manually refresh** suggestions, the new ones are saved to the current entry too

**How to enable:** This works automatically — no settings needed. Just play normally and suggestions will be saved. Delete an entry and watch the suggestions update to match the restored position.

**How it works behind the scenes:**
1. Every time suggestions or action choices are generated, they're saved to the narration entry
2. When you delete and time-travel back, the app looks at the new last narration entry
3. If that entry has saved suggestions → they're restored immediately
4. If not (older entry from before this feature) → new suggestions are generated automatically

---

## 7. SQL Query Console (Advanced)

**What it does:** A built-in database explorer for power users. You can run raw SQL queries against your story database to inspect data, debug issues, or just explore how things are stored internally.

**How to enable:**
- Go to **Settings → Experimental**
- Scroll down and turn on the **"SQL Query Console"** toggle

**How to use:**
- Type any SQL query in the text box
- Press **Ctrl+Enter** or click **"Run Query"** to execute
- Results appear in a table below
- Click **"Copy JSON"** to copy the results to your clipboard
- Your query and results are preserved even if you close and reopen Settings

**Example queries:**
- `SELECT * FROM story_entries ORDER BY position DESC LIMIT 10` — see your last 10 entries
- `SELECT name, status FROM characters` — list all characters
- `SELECT * FROM branches` — see all branches
- `SELECT name FROM sqlite_master WHERE type='table'` — list all tables

**Warning:** Be careful with write queries (`INSERT`, `UPDATE`, `DELETE`). The console can modify your database directly. Use **read-only queries** (`SELECT`) unless you know what you're doing.

---

## Quick Reference

| Feature | Requires | How to Enable |
|---|---|---|
| Manual Backups | Nothing | Click "Download Backup" button |
| Restore from Backup | A backup `.zip` file | Click "Restore from Backup" button |
| State Tracking | Nothing | Toggle on in Experimental settings |
| Rollback on Delete | State Tracking | Toggle on in Experimental settings |
| Lightweight Branches | State Tracking | Toggle on in Experimental settings |
| Smart Suggestions | Nothing | Automatic — always active |
| SQL Query Console | Nothing | Toggle on in Experimental settings |

---

## Important Notes

- All features except Smart Suggestions are under **Settings → Experimental**
- **State Tracking** must be on for both Rollback and Branches to work — it's the foundation that records what changes the AI makes
- **Backing up before enabling experimental features** is always a good idea
- Features only track changes **going forward** — entries created before enabling State Tracking won't have rollback data
- Smart Suggestions handles old entries gracefully — if no saved suggestions exist, new ones are generated automatically
- The **Reset Experimental Features** button at the bottom of the Experimental settings will turn everything off and reset to defaults
