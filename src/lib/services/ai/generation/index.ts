/**
 * AI Generation Module
 *
 * Story narrative generation services:
 * - AIService: Main orchestrator for all AI operations
 * - ClassifierService: Extract world state from narrative
 * - MemoryService: Chapter summarization and memory retrieval
 * - SuggestionsService: Story direction suggestions
 * - ActionChoicesService: RPG-style action choices
 * - StyleReviewerService: Writing style analysis
 * - ContextBuilder: Tiered context building for prompts
 */

// Main orchestrator (exports singleton instance)
export { aiService } from '../index';

// Classification
export {
  ClassifierService,
  type ClassificationResult,
  type ClassificationContext,
  type ClassificationChatEntry,
  type CharacterUpdate,
  type LocationUpdate,
  type ItemUpdate,
  type StoryBeatUpdate,
  type NewCharacter,
  type NewLocation,
  type NewItem,
  type NewStoryBeat,
} from './ClassifierService';

// Memory
export {
  MemoryService,
  DEFAULT_MEMORY_CONFIG,
  type ChapterAnalysis,
  type ChapterSummary,
  type RetrievalDecision,
  type RetrievedContext,
} from './MemoryService';

// Suggestions and choices
export {
  SuggestionsService,
  type StorySuggestion,
  type SuggestionsResult,
} from './SuggestionsService';

export {
  ActionChoicesService,
  type ActionChoice,
  type ActionChoicesResult,
} from './ActionChoicesService';

// Style analysis
export {
  StyleReviewerService,
  type StyleReviewResult,
  type PhraseAnalysis,
} from './StyleReviewerService';

// Context building
export {
  ContextBuilder,
  DEFAULT_CONTEXT_CONFIG,
  type ContextResult,
  type ContextConfig,
  type WorldState,
  type RelevantEntry,
} from './ContextBuilder';
