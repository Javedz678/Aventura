/**
 * Prompt Definitions - Domain Split Index
 *
 * This module re-exports all prompt definitions from the parent definitions.ts.
 * The structure is set up for incremental migration where individual template
 * categories can be moved to separate files:
 *
 * Future split (when migrated):
 * - macros.ts       - BUILTIN_MACROS, simple + complex macro definitions
 * - narrative.ts    - Adventure & creative-writing prompts
 * - analysis.ts     - Classifier, memory, style review prompts
 * - retrieval.ts    - Agentic retrieval, timeline fill prompts
 * - generation.ts   - Suggestions, action choices prompts
 * - lore.ts         - Lore management, lorebook prompts
 * - wizard.ts       - Story wizard prompts (setting, character, opening)
 * - image.ts        - Image generation & style prompts
 * - translation.ts  - Translation service prompts
 *
 * Current state: All definitions remain in ../definitions.ts
 * This file provides the directory structure for future migration.
 */

// Re-export everything from the main definitions file
export * from '../definitions';
