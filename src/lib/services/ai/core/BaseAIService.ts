/**
 * Base AI Service
 *
 * Abstract base class for all AI services that provides common functionality:
 * - Preset-based configuration (model, temperature, maxTokens)
 * - Settings override support
 * - Extra body building for API requests
 * - LLM call helpers with built-in error handling and JSON parsing
 *
 * This eliminates ~25 lines of boilerplate code that was duplicated across 10+ services.
 */

import type { GenerationPreset } from '$lib/types';
import type { Message } from './types';
import { settings } from '$lib/stores/settings.svelte';
import { buildExtraBody } from './requestOverrides';
import type { OpenAIProvider } from './OpenAIProvider';
import { tryParseJsonWithHealing } from '../utils/jsonHealing';
import { createLogger } from './config';

// Re-export the OpenAIProvider type for convenience
export type { OpenAIProvider } from './OpenAIProvider';

/**
 * Options for the callLLM helper method.
 */
export interface CallLLMOptions<T> {
  /** System prompt for the LLM */
  systemPrompt: string;
  /** User prompt/message for the LLM */
  userPrompt: string;
  /** Function to parse the response content into the desired type */
  parseResponse: (content: string) => T;
  /** Fallback result to return on error */
  fallbackResult: T;
  /** Log prefix for debugging (e.g., 'Classifier', 'Memory') */
  logPrefix: string;
  /** Optional temperature override */
  temperature?: number;
  /** Optional max tokens override */
  maxTokens?: number;
  /** Optional abort signal for cancellation */
  signal?: AbortSignal;
  /** Optional additional messages to include (for multi-turn conversations) */
  additionalMessages?: Message[];
}

/**
 * Abstract base class for AI services.
 *
 * Provides common configuration handling:
 * - Preset lookup via settings store
 * - Settings override support (allows runtime config changes)
 * - Model, temperature, maxTokens, and extraBody getters
 *
 * @example
 * ```typescript
 * class SuggestionsService extends BaseAIService {
 *   constructor(provider: OpenAIProvider, presetId: string = 'suggestions') {
 *     super(provider, presetId);
 *   }
 *
 *   async generate() {
 *     const response = await this.provider.generateResponse({
 *       model: this.model,
 *       temperature: this.temperature,
 *       maxTokens: this.maxTokens,
 *       extraBody: this.extraBody,
 *       // ...
 *     });
 *   }
 * }
 * ```
 */
export abstract class BaseAIService {
  protected provider: OpenAIProvider;
  protected presetId: string;
  protected settingsOverride?: Partial<GenerationPreset>;

  /**
   * @param provider - The OpenAI-compatible API provider
   * @param presetId - The preset ID to use for configuration
   * @param settingsOverride - Optional runtime overrides for preset settings
   */
  constructor(
    provider: OpenAIProvider,
    presetId: string,
    settingsOverride?: Partial<GenerationPreset>
  ) {
    this.provider = provider;
    this.presetId = presetId;
    this.settingsOverride = settingsOverride;
  }

  /**
   * Get the full preset configuration from settings.
   */
  protected get preset(): GenerationPreset {
    return settings.getPresetConfig(this.presetId);
  }

  /**
   * Get the model to use.
   * Uses settingsOverride if provided, otherwise falls back to preset.
   */
  protected get model(): string {
    return this.settingsOverride?.model ?? this.preset.model;
  }

  /**
   * Get the temperature to use.
   * Uses settingsOverride if provided, otherwise falls back to preset.
   */
  protected get temperature(): number {
    return this.settingsOverride?.temperature ?? this.preset.temperature;
  }

  /**
   * Get the max tokens to use.
   * Uses settingsOverride if provided, otherwise falls back to preset.
   */
  protected get maxTokens(): number {
    return this.settingsOverride?.maxTokens ?? this.preset.maxTokens;
  }

  /**
   * Build the extra body for API requests.
   * Includes reasoning effort, provider-only settings, and manual body override.
   */
  protected get extraBody(): Record<string, unknown> | undefined {
    return buildExtraBody({
      manualMode: settings.advancedRequestSettings.manualMode,
      manualBody: this.settingsOverride?.manualBody ?? this.preset.manualBody,
      reasoningEffort: this.settingsOverride?.reasoningEffort ?? this.preset.reasoningEffort,
      providerOnly: this.settingsOverride?.providerOnly ?? this.preset.providerOnly,
    });
  }

  /**
   * Standard LLM call with JSON response parsing.
   * Eliminates the duplicated try-catch-parse-fallback pattern found in most services.
   *
   * @param options - Configuration for the LLM call
   * @returns Parsed response or fallback result on error
   *
   * @example
   * ```typescript
   * return this.callLLM({
   *   systemPrompt: promptService.renderPrompt('suggestions', context),
   *   userPrompt: prompt,
   *   parseResponse: (content) => this.parseSuggestions(content),
   *   fallbackResult: { suggestions: [] },
   *   logPrefix: 'Suggestions',
   * });
   * ```
   */
  protected async callLLM<T>(options: CallLLMOptions<T>): Promise<T> {
    const log = createLogger(options.logPrefix);
    try {
      log('Sending request...');
      const messages: Message[] = [
        { role: 'system', content: options.systemPrompt },
        ...(options.additionalMessages ?? []),
        { role: 'user', content: options.userPrompt },
      ];

      const response = await this.provider.generateResponse({
        model: this.model,
        messages,
        temperature: options.temperature ?? this.temperature,
        maxTokens: options.maxTokens ?? this.maxTokens,
        extraBody: this.extraBody,
        signal: options.signal,
      });

      log('Response received', { length: response.content.length });
      return options.parseResponse(response.content);
    } catch (error) {
      log('Request failed', error);
      return options.fallbackResult;
    }
  }

  /**
   * Parse JSON with healing, returning fallback on failure.
   * Uses jsonrepair to handle common LLM JSON issues.
   *
   * @param content - Raw string content to parse
   * @param fallback - Value to return if parsing fails
   * @param logPrefix - Log prefix for debugging
   * @returns Parsed JSON or fallback value
   *
   * @example
   * ```typescript
   * const result = this.parseJsonOrFallback<MyType>(
   *   response.content,
   *   { items: [] },
   *   'MyService'
   * );
   * ```
   */
  protected parseJsonOrFallback<T>(
    content: string,
    fallback: T,
    logPrefix: string
  ): T {
    const parsed = tryParseJsonWithHealing<T>(content);
    if (!parsed) {
      const log = createLogger(logPrefix);
      log('Failed to parse JSON', { contentPreview: content.substring(0, 200) });
      return fallback;
    }
    return parsed;
  }
}
