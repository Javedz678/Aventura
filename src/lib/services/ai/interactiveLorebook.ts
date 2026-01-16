import type { OpenAIProvider } from './openrouter';
import type {
  Tool,
  ToolCall,
  AgenticMessage,
} from './types';
import type { VaultLorebookEntry, EntryType, EntryInjectionMode } from '$lib/types';
import { settings, getDefaultInteractiveLorebookSettings, type InteractiveLorebookSettings } from '$lib/stores/settings.svelte';
import { buildExtraBody } from './requestOverrides';
import { promptService } from '$lib/services/prompts';

// Event types for progress updates
export type StreamEvent =
  | { type: 'tool_start'; toolName: string; args: Record<string, unknown> }
  | { type: 'tool_end'; toolCall: ToolCallDisplay }
  | { type: 'thinking' }
  | { type: 'message'; message: ChatMessage } // Intermediate message (after tool calls)
  | { type: 'done'; result: SendMessageResult }
  | { type: 'error'; error: string };

const DEBUG = true;

function log(...args: unknown[]) {
  if (DEBUG) {
    console.log('[InteractiveLorebook]', ...args);
  }
}

// Tool definitions for Interactive Lorebook Creation
const INTERACTIVE_LOREBOOK_TOOLS: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'list_entries',
      description: 'List all entries in the lorebook, optionally filtered by type',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Optional filter by entry type',
            enum: ['character', 'location', 'item', 'faction', 'concept', 'event'],
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_entry',
      description: 'Get full details of a specific entry by index',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'The index of the entry (0-based)',
          },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_entry',
      description: 'Create a new lorebook entry. Requires user approval before being added.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Name of the entry',
          },
          type: {
            type: 'string',
            description: 'Type of entry',
            enum: ['character', 'location', 'item', 'faction', 'concept', 'event'],
          },
          description: {
            type: 'string',
            description: 'Description of the entry',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords that trigger this entry (optional)',
          },
          injectionMode: {
            type: 'string',
            description: 'When to inject this entry into context',
            enum: ['always', 'keyword', 'relevant', 'never'],
          },
          priority: {
            type: 'number',
            description: 'Priority for injection ordering (higher = more important)',
          },
          group: {
            type: 'string',
            description: 'Optional group to organize entries',
          },
        },
        required: ['name', 'type', 'description'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_entry',
      description: 'Update an existing lorebook entry. Requires user approval before changes are applied.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'The index of the entry to update (0-based)',
          },
          name: {
            type: 'string',
            description: 'New name (optional)',
          },
          type: {
            type: 'string',
            description: 'New type (optional)',
            enum: ['character', 'location', 'item', 'faction', 'concept', 'event'],
          },
          description: {
            type: 'string',
            description: 'New description (optional)',
          },
          keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'New keywords (optional)',
          },
          injectionMode: {
            type: 'string',
            description: 'New injection mode (optional)',
            enum: ['always', 'keyword', 'relevant', 'never'],
          },
          priority: {
            type: 'number',
            description: 'New priority (optional)',
          },
          disabled: {
            type: 'boolean',
            description: 'Whether the entry is disabled (optional)',
          },
          group: {
            type: 'string',
            description: 'New group (optional, null to remove)',
          },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_entry',
      description: 'Delete an entry from the lorebook. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'number',
            description: 'The index of the entry to delete (0-based)',
          },
        },
        required: ['index'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_entries',
      description: 'Merge multiple entries into one. Requires user approval.',
      parameters: {
        type: 'object',
        properties: {
          indices: {
            type: 'array',
            items: { type: 'number' },
            description: 'Indices of entries to merge (0-based)',
          },
          merged_name: {
            type: 'string',
            description: 'Name for the merged entry',
          },
          merged_type: {
            type: 'string',
            description: 'Type for the merged entry',
            enum: ['character', 'location', 'item', 'faction', 'concept', 'event'],
          },
          merged_description: {
            type: 'string',
            description: 'Description for the merged entry',
          },
          merged_keywords: {
            type: 'array',
            items: { type: 'string' },
            description: 'Keywords for the merged entry (optional)',
          },
        },
        required: ['indices', 'merged_name', 'merged_type', 'merged_description'],
      },
    },
  },
];

// Types for pending changes and chat messages
export interface PendingChange {
  id: string;
  type: 'create' | 'update' | 'delete' | 'merge';
  toolCallId: string;
  entry?: VaultLorebookEntry;           // For create: the new entry
  index?: number;                        // For update/delete: target index
  indices?: number[];                    // For merge: source indices
  updates?: Partial<VaultLorebookEntry>; // For update: the changes
  previous?: VaultLorebookEntry;         // For update: original entry (for diff)
  previousEntries?: VaultLorebookEntry[]; // For merge: original entries
  status: 'pending' | 'approved' | 'rejected';
}

// Tool call info for display in chat
export interface ToolCallDisplay {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
  pendingChange?: PendingChange;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  pendingChanges?: PendingChange[];
  toolCalls?: ToolCallDisplay[];
  reasoning?: string;
  isGreeting?: boolean; // Display-only message, not sent to API
}

export interface SendMessageResult {
  response: string;
  pendingChanges: PendingChange[];
  toolCalls: ToolCallDisplay[];
  reasoning?: string;
}

export class InteractiveLorebookService {
  private provider: OpenAIProvider;
  private messages: AgenticMessage[] = [];
  private lorebookName: string = '';
  private initialized: boolean = false;

  constructor(provider: OpenAIProvider) {
    this.provider = provider;
  }

  /**
   * Get the interactive lorebook settings from the settings store.
   * Falls back to defaults if not yet initialized (for existing users).
   */
  private getSettings(): InteractiveLorebookSettings {
    return settings.systemServicesSettings.interactiveLorebook ?? getDefaultInteractiveLorebookSettings();
  }

  /**
   * Get the model ID from settings.
   */
  private getModelId(): string {
    return this.getSettings().model;
  }

  /**
   * Initialize the conversation with the system prompt from the prompt service.
   */
  initialize(lorebookName: string, entryCount: number): void {
    this.lorebookName = lorebookName;
    this.initialized = true;

    // Use the prompt service to render the system prompt with placeholders
    // Provide minimal context - service prompts don't use story-specific macros
    const systemPrompt = promptService.renderPrompt(
      'interactive-lorebook',
      { mode: 'adventure', pov: 'second', tense: 'present', protagonistName: '' },
      { lorebookName, entryCount: String(entryCount) }
    );

    this.messages = [
      { role: 'system', content: systemPrompt },
    ];

    const serviceSettings = this.getSettings();
    log('Initialized conversation', { lorebookName, entryCount, model: serviceSettings.model });
  }

  /**
   * Check if the service has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Send a user message and get the AI response.
   * Implements an agentic loop that continues until the AI responds without tool calls.
   * Returns pending changes that need approval before being applied.
   */
  async sendMessage(
    userMessage: string,
    entries: VaultLorebookEntry[]
  ): Promise<SendMessageResult> {
    if (!this.initialized) {
      throw new Error('Service not initialized. Call initialize() first.');
    }

    // Add user message to conversation
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    log('Sending message', { userMessage, entriesCount: entries.length });

    const pendingChanges: PendingChange[] = [];
    const toolCalls: ToolCallDisplay[] = [];
    let responseContent = '';
    let reasoning: string | undefined;

    const MAX_ITERATIONS = 10;
    let iterations = 0;
    let continueLoop = true;

    try {
      // Agentic loop - continue until AI responds without tool calls
      while (continueLoop && iterations < MAX_ITERATIONS) {
        iterations++;
        log(`Agentic loop iteration ${iterations}`);

        const serviceSettings = this.getSettings();
        const response = await this.provider.generateWithTools({
          messages: this.messages,
          model: serviceSettings.model,
          temperature: serviceSettings.temperature,
          maxTokens: 4096,
          tools: INTERACTIVE_LOREBOOK_TOOLS,
          tool_choice: 'auto',
          extraBody: buildExtraBody({
            manualMode: false,
            manualBody: serviceSettings.manualBody,
            reasoningEffort: serviceSettings.reasoningEffort,
            providerOnly: serviceSettings.providerOnly,
          }),
        });

        log('Received response', {
          iteration: iterations,
          hasContent: !!response.content,
          hasToolCalls: !!response.tool_calls,
          toolCallCount: response.tool_calls?.length ?? 0,
          finishReason: response.finish_reason,
          hasReasoning: !!response.reasoning,
        });

        // Capture reasoning from the final response
        reasoning = response.reasoning;

        // Process tool calls if present
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add assistant response with tool calls to messages
          this.messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls,
            reasoning: response.reasoning ?? null,
          });

          // Process each tool call
          for (const toolCall of response.tool_calls) {
            const { result, pendingChange } = this.processToolCall(toolCall, entries);

            // Track tool call for display
            const toolCallDisplay: ToolCallDisplay = {
              id: toolCall.id,
              name: toolCall.function.name,
              args: JSON.parse(toolCall.function.arguments),
              result,
              pendingChange,
            };
            toolCalls.push(toolCallDisplay);

            if (pendingChange) {
              pendingChanges.push(pendingChange);
            }

            // Add tool result to messages
            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            });
          }

          // Continue the loop to let the AI respond to tool results
          continueLoop = true;
        } else {
          // No tool calls - this is the final response
          responseContent = response.content ?? '';

          // Add final assistant response to messages
          this.messages.push({
            role: 'assistant',
            content: responseContent,
            reasoning: response.reasoning ?? null,
          });

          // Exit the loop
          continueLoop = false;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        log('Warning: Max iterations reached in agentic loop');
        responseContent = responseContent || 'I apologize, but I seem to be having trouble completing my response. Please try again.';
      }

    } catch (error) {
      log('Error in agentic loop:', error);
      throw error;
    }

    return {
      response: responseContent,
      pendingChanges,
      toolCalls,
      reasoning,
    };
  }

  /**
   * Async version of sendMessage that yields progress events.
   * Uses non-streaming API calls but yields events for UI updates.
   * Yields separate 'message' events for each iteration that has tool calls.
   */
  async *sendMessageStreaming(
    userMessage: string,
    entries: VaultLorebookEntry[]
  ): AsyncGenerator<StreamEvent> {
    if (!this.initialized) {
      yield { type: 'error', error: 'Service not initialized. Call initialize() first.' };
      return;
    }

    // Add user message to conversation
    this.messages.push({
      role: 'user',
      content: userMessage,
    });

    log('Sending message', { userMessage, entriesCount: entries.length });

    // Track all pending changes across iterations (for final result)
    const allPendingChanges: PendingChange[] = [];

    const MAX_ITERATIONS = 10;
    let iterations = 0;
    let continueLoop = true;
    let finalResponseContent = '';
    let finalReasoning: string | undefined;

    try {
      // Agentic loop - continue until AI responds without tool calls
      while (continueLoop && iterations < MAX_ITERATIONS) {
        iterations++;
        log(`Agentic loop iteration ${iterations}`);

        // Signal that we're thinking
        yield { type: 'thinking' };

        const serviceSettings = this.getSettings();

        // Track this iteration's data separately
        const iterationToolCalls: ToolCallDisplay[] = [];
        const iterationPendingChanges: PendingChange[] = [];

        // Use non-streaming generateWithTools for clean reasoning
        const response = await this.provider.generateWithTools({
          messages: this.messages,
          model: serviceSettings.model,
          temperature: serviceSettings.temperature,
          maxTokens: 4096,
          tools: INTERACTIVE_LOREBOOK_TOOLS,
          tool_choice: 'auto',
          extraBody: buildExtraBody({
            manualMode: false,
            manualBody: serviceSettings.manualBody,
            reasoningEffort: serviceSettings.reasoningEffort,
            providerOnly: serviceSettings.providerOnly,
          }),
        });

        log('Received response', {
          iteration: iterations,
          hasContent: !!response.content,
          hasToolCalls: !!response.tool_calls,
          toolCallCount: response.tool_calls?.length ?? 0,
          finishReason: response.finish_reason,
          hasReasoning: !!response.reasoning,
        });

        // Process tool calls if present
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Add assistant response with tool calls to messages
          this.messages.push({
            role: 'assistant',
            content: response.content,
            tool_calls: response.tool_calls,
            reasoning: response.reasoning ?? null,
          });

          // Process each tool call
          for (const toolCall of response.tool_calls) {
            const args = JSON.parse(toolCall.function.arguments);

            // Yield tool start event
            yield { type: 'tool_start', toolName: toolCall.function.name, args };

            const { result, pendingChange } = this.processToolCall(toolCall, entries);

            // Track tool call for display
            const toolCallDisplay: ToolCallDisplay = {
              id: toolCall.id,
              name: toolCall.function.name,
              args,
              result,
              pendingChange,
            };
            iterationToolCalls.push(toolCallDisplay);

            if (pendingChange) {
              iterationPendingChanges.push(pendingChange);
              allPendingChanges.push(pendingChange);
            }

            // Add tool result to messages
            this.messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: result,
            });

            // Yield tool end event
            yield { type: 'tool_end', toolCall: toolCallDisplay };
          }

          // Yield an intermediate message for this iteration
          const iterationMessage: ChatMessage = {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: response.content ?? '',
            timestamp: Date.now(),
            toolCalls: iterationToolCalls,
            pendingChanges: iterationPendingChanges,
            reasoning: response.reasoning,
          };
          yield { type: 'message', message: iterationMessage };

          // Continue the loop
          continueLoop = true;
        } else {
          // No tool calls - this is the final response
          // Add the message to context
          this.messages.push({
            role: 'assistant',
            content: response.content ?? '',
            reasoning: response.reasoning ?? null,
          });

          finalResponseContent = response.content ?? '';
          finalReasoning = response.reasoning;
          continueLoop = false;
        }
      }

      if (iterations >= MAX_ITERATIONS) {
        log('Warning: Max iterations reached in agentic loop');
        finalResponseContent = finalResponseContent || 'I apologize, but I seem to be having trouble completing my response. Please try again.';
      }

    } catch (error) {
      log('Error in agentic loop:', error);
      yield { type: 'error', error: error instanceof Error ? error.message : 'Unknown error' };
      return;
    }

    // Yield final result (the last message without tool calls)
    yield {
      type: 'done',
      result: {
        response: finalResponseContent,
        pendingChanges: allPendingChanges,
        toolCalls: [], // Tool calls were in intermediate messages
        reasoning: finalReasoning,
      },
    };
  }

  /**
   * Process a tool call and return the result + any pending change.
   */
  private processToolCall(
    toolCall: ToolCall,
    entries: VaultLorebookEntry[]
  ): { result: string; pendingChange?: PendingChange } {
    const args = JSON.parse(toolCall.function.arguments);
    log('Processing tool call:', toolCall.function.name, args);

    switch (toolCall.function.name) {
      case 'list_entries': {
        const typeFilter = args.type as EntryType | undefined;
        const filtered = typeFilter
          ? entries.filter(e => e.type === typeFilter)
          : entries;

        const result = filtered.map((e, i) => ({
          index: entries.indexOf(e),
          name: e.name,
          type: e.type,
          keywords: e.keywords,
          disabled: e.disabled,
        }));

        return { result: JSON.stringify(result) };
      }

      case 'get_entry': {
        const index = args.index as number;
        if (index < 0 || index >= entries.length) {
          return { result: JSON.stringify({ error: `Invalid index ${index}. Valid range: 0-${entries.length - 1}` }) };
        }
        return { result: JSON.stringify(entries[index]) };
      }

      case 'create_entry': {
        const newEntry: VaultLorebookEntry = {
          name: args.name,
          type: args.type as EntryType,
          description: args.description,
          keywords: args.keywords ?? [],
          injectionMode: (args.injectionMode as EntryInjectionMode) ?? 'keyword',
          priority: args.priority ?? 10,
          disabled: false,
          group: args.group ?? null,
        };

        const pendingChange: PendingChange = {
          id: crypto.randomUUID(),
          type: 'create',
          toolCallId: toolCall.id,
          entry: newEntry,
          status: 'pending',
        };

        return {
          result: JSON.stringify({
            status: 'pending_approval',
            message: `Creating entry "${newEntry.name}" requires user approval.`,
            entry: newEntry,
          }),
          pendingChange,
        };
      }

      case 'update_entry': {
        const index = args.index as number;
        if (index < 0 || index >= entries.length) {
          return { result: JSON.stringify({ error: `Invalid index ${index}. Valid range: 0-${entries.length - 1}` }) };
        }

        const previous = entries[index];
        const updates: Partial<VaultLorebookEntry> = {};

        if (args.name !== undefined) updates.name = args.name;
        if (args.type !== undefined) updates.type = args.type as EntryType;
        if (args.description !== undefined) updates.description = args.description;
        if (args.keywords !== undefined) updates.keywords = args.keywords;
        if (args.injectionMode !== undefined) updates.injectionMode = args.injectionMode as EntryInjectionMode;
        if (args.priority !== undefined) updates.priority = args.priority;
        if (args.disabled !== undefined) updates.disabled = args.disabled;
        if (args.group !== undefined) updates.group = args.group;

        const pendingChange: PendingChange = {
          id: crypto.randomUUID(),
          type: 'update',
          toolCallId: toolCall.id,
          index,
          updates,
          previous: { ...previous },
          status: 'pending',
        };

        return {
          result: JSON.stringify({
            status: 'pending_approval',
            message: `Updating entry "${previous.name}" requires user approval.`,
            updates,
          }),
          pendingChange,
        };
      }

      case 'delete_entry': {
        const index = args.index as number;
        if (index < 0 || index >= entries.length) {
          return { result: JSON.stringify({ error: `Invalid index ${index}. Valid range: 0-${entries.length - 1}` }) };
        }

        const entry = entries[index];
        const pendingChange: PendingChange = {
          id: crypto.randomUUID(),
          type: 'delete',
          toolCallId: toolCall.id,
          index,
          previous: { ...entry },
          status: 'pending',
        };

        return {
          result: JSON.stringify({
            status: 'pending_approval',
            message: `Deleting entry "${entry.name}" requires user approval.`,
            entry: entry.name,
          }),
          pendingChange,
        };
      }

      case 'merge_entries': {
        const indices = args.indices as number[];

        // Validate all indices
        for (const index of indices) {
          if (index < 0 || index >= entries.length) {
            return { result: JSON.stringify({ error: `Invalid index ${index}. Valid range: 0-${entries.length - 1}` }) };
          }
        }

        if (indices.length < 2) {
          return { result: JSON.stringify({ error: 'Need at least 2 entries to merge' }) };
        }

        const previousEntries = indices.map(i => ({ ...entries[i] }));

        const mergedEntry: VaultLorebookEntry = {
          name: args.merged_name,
          type: args.merged_type as EntryType,
          description: args.merged_description,
          keywords: args.merged_keywords ?? [],
          injectionMode: 'keyword',
          priority: Math.max(...previousEntries.map(e => e.priority)),
          disabled: false,
          group: previousEntries[0].group,
        };

        const pendingChange: PendingChange = {
          id: crypto.randomUUID(),
          type: 'merge',
          toolCallId: toolCall.id,
          indices,
          entry: mergedEntry,
          previousEntries,
          status: 'pending',
        };

        return {
          result: JSON.stringify({
            status: 'pending_approval',
            message: `Merging ${indices.length} entries into "${mergedEntry.name}" requires user approval.`,
            mergedEntry,
            sourceEntries: previousEntries.map(e => e.name),
          }),
          pendingChange,
        };
      }

      default:
        return { result: JSON.stringify({ error: `Unknown tool: ${toolCall.function.name}` }) };
    }
  }

  /**
   * Handle approval or rejection of a pending change.
   * This adds a message to the conversation indicating the result.
   */
  handleApproval(change: PendingChange, approved: boolean, rejectionReason?: string): void {
    const message = approved
      ? `Change approved: ${this.describeChange(change)}`
      : `Change rejected: ${this.describeChange(change)}${rejectionReason ? `. Reason: ${rejectionReason}` : ''}`;

    // Find and update the tool result message for this change
    const toolResultIndex = this.messages.findIndex(
      m => m.role === 'tool' && (m as { tool_call_id: string }).tool_call_id === change.toolCallId
    );

    if (toolResultIndex !== -1) {
      // Update the tool result with the approval/rejection status
      const originalResult = JSON.parse((this.messages[toolResultIndex] as { content: string }).content);
      (this.messages[toolResultIndex] as { content: string }).content = JSON.stringify({
        ...originalResult,
        status: approved ? 'approved' : 'rejected',
        message: approved ? 'Change applied successfully.' : `Change rejected. ${rejectionReason ?? 'User declined the change.'}`,
      });
    }

    log('Handled approval', { changeId: change.id, approved, message });
  }

  /**
   * Describe a change for display in messages.
   */
  private describeChange(change: PendingChange): string {
    switch (change.type) {
      case 'create':
        return `Created entry "${change.entry?.name}"`;
      case 'update':
        return `Updated entry "${change.previous?.name}"`;
      case 'delete':
        return `Deleted entry "${change.previous?.name}"`;
      case 'merge':
        return `Merged ${change.indices?.length} entries into "${change.entry?.name}"`;
      default:
        return 'Unknown change';
    }
  }

  /**
   * Apply a pending change to the entries array.
   * Returns the modified entries array.
   */
  applyChange(change: PendingChange, entries: VaultLorebookEntry[]): VaultLorebookEntry[] {
    const newEntries = [...entries];

    switch (change.type) {
      case 'create':
        if (change.entry) {
          newEntries.push(change.entry);
        }
        break;

      case 'update':
        if (change.index !== undefined && change.updates) {
          newEntries[change.index] = {
            ...newEntries[change.index],
            ...change.updates,
          };
        }
        break;

      case 'delete':
        if (change.index !== undefined) {
          newEntries.splice(change.index, 1);
        }
        break;

      case 'merge':
        if (change.indices && change.entry) {
          // Remove source entries (in reverse order to preserve indices)
          const sortedIndices = [...change.indices].sort((a, b) => b - a);
          for (const index of sortedIndices) {
            newEntries.splice(index, 1);
          }
          // Add merged entry
          newEntries.push(change.entry);
        }
        break;
    }

    return newEntries;
  }

  /**
   * Get the conversation history for display.
   */
  getMessages(): AgenticMessage[] {
    return this.messages;
  }

  /**
   * Reset the conversation (clear all messages except system prompt).
   */
  reset(lorebookName: string, entryCount: number): void {
    this.initialize(lorebookName, entryCount);
  }
}
