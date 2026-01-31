/**
 * Agentic Retrieval Service
 *
 * Uses agentic reasoning to intelligently search and retrieve lorebook entries
 * and chapter context using the Vercel AI SDK ToolLoopAgent.
 */

import type { Entry, Chapter } from '$lib/types';
import { createLogger } from '../core/config';
import { createAgentFromPreset, extractTerminalToolResult, stopOnTerminalTool } from '../sdk/agents';
import { createRetrievalTools, type RetrievalToolContext } from '../sdk/tools';
import { promptService } from '$lib/services/prompts';

const log = createLogger('AgenticRetrieval');

/**
 * Result from an agentic retrieval session.
 */
export interface RetrievalResult {
  entries: Entry[];
  reasoning?: string;
  queryHistory?: string[];
}

/**
 * Context for running agentic retrieval.
 */
export interface RetrievalContext {
  userInput: string;
  recentNarrative: string;
  availableEntries: Entry[];
  /** Chapter summaries for context */
  chapters?: Chapter[];
  /** Optional callback to get full chapter content */
  getChapterContent?: (chapterId: string) => Promise<string>;
}

// Alias for export compatibility
export type AgenticRetrievalContext = RetrievalContext;

/**
 * Settings for agentic retrieval behavior.
 */
export interface AgenticRetrievalSettings {
  enabled: boolean;
  maxIterations: number;
}

export function getDefaultAgenticRetrievalSettings(): AgenticRetrievalSettings {
  return {
    enabled: true,
    maxIterations: 3,
  };
}

export type AgenticRetrievalResult = RetrievalResult;

/**
 * Finish retrieval tool result type.
 */
interface FinishRetrievalResult {
  completed: boolean;
  synthesis: string;
  confidence: 'low' | 'medium' | 'high';
  additionalContext?: string;
}

/**
 * Service that uses agentic reasoning for intelligent lorebook retrieval.
 * Uses ToolLoopAgent for multi-turn tool calling.
 */
export class AgenticRetrievalService {
  private presetId: string;
  private maxIterations: number;

  constructor(presetId: string = 'agentic', maxIterations: number = 3) {
    this.presetId = presetId;
    this.maxIterations = maxIterations;
  }

  /**
   * Run agentic retrieval to find relevant lorebook entries.
   *
   * @param context - The retrieval context
   * @param signal - Optional abort signal for cancellation
   * @returns Result with selected entries and reasoning
   */
  async runRetrieval(
    context: RetrievalContext,
    signal?: AbortSignal
  ): Promise<RetrievalResult> {
    log('Starting agentic retrieval', {
      entryCount: context.availableEntries.length,
      chapterCount: context.chapters?.length ?? 0,
      maxIterations: this.maxIterations,
    });

    // Track selected entries
    const selectedIndices = new Set<number>();
    const queryHistory: string[] = [];

    // Create tool context
    const toolContext: RetrievalToolContext = {
      entries: context.availableEntries,
      chapters: context.chapters ?? [],
      onSelectEntry: (index) => {
        selectedIndices.add(index);
        log('Entry selected', { index, name: context.availableEntries[index]?.name });
      },
      getChapterContent: context.getChapterContent,
    };

    // Create tools
    const tools = createRetrievalTools(toolContext);

    // Build chapter list for user prompt
    const chapterList = context.chapters
      ?.slice(0, 20) // Limit for prompt size
      .map((ch) => `- Chapter ${ch.number}${ch.title ? `: ${ch.title}` : ''} - ${ch.summary.slice(0, 100)}...`)
      .join('\n') ?? 'No chapters available.';

    // Build entry list for user prompt
    const entryList = context.availableEntries
      .slice(0, 30) // Limit for prompt size
      .map((e, i) => `${i}. [${e.type}] ${e.name}`)
      .join('\n') || 'No entries available.';

    // Get prompts from prompt service
    const dummyContext = {
      mode: 'adventure' as const,
      pov: 'second' as const,
      tense: 'present' as const,
      protagonistName: '',
    };

    const systemPrompt = promptService.renderPrompt('agentic-retrieval', dummyContext);

    const userPrompt = promptService.renderUserPrompt('agentic-retrieval', dummyContext, {
      userInput: context.userInput,
      recentContext: context.recentNarrative.slice(0, 2000),
      chaptersCount: context.chapters?.length ?? 0,
      chapterList,
      entriesCount: context.availableEntries.length,
      entryList,
    });

    // Create the agent
    const agent = createAgentFromPreset({
      presetId: this.presetId,
      instructions: systemPrompt,
      tools,
      stopWhen: stopOnTerminalTool('finish_retrieval', this.maxIterations),
      signal,
    });

    // Run the agent
    const result = await agent.generate({ prompt: userPrompt });

    // Extract the terminal result
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const terminalResult = extractTerminalToolResult<FinishRetrievalResult>(
      result.steps as any,
      'finish_retrieval'
    );

    log('Agentic retrieval completed', {
      steps: result.steps.length,
      selectedCount: selectedIndices.size,
      terminalResult,
    });

    // Build the selected entries array
    const selectedEntries = Array.from(selectedIndices)
      .filter(idx => idx >= 0 && idx < context.availableEntries.length)
      .map(idx => context.availableEntries[idx]);

    // Build reasoning from terminal result
    let reasoning = terminalResult?.synthesis;
    if (terminalResult?.additionalContext) {
      reasoning = reasoning
        ? `${reasoning}\n\nAdditional context: ${terminalResult.additionalContext}`
        : terminalResult.additionalContext;
    }

    return {
      entries: selectedEntries,
      reasoning,
      queryHistory: queryHistory.length > 0 ? queryHistory : undefined,
    };
  }
}
