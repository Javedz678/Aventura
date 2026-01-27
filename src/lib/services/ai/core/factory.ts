/**
 * Service Factory
 *
 * Centralized factory for creating OpenAI providers and AI service instances.
 * This module handles profile resolution and provider configuration.
 */

import { settings } from '$lib/stores/settings.svelte';
import { OpenAIProvider } from './OpenAIProvider';
import { ClassifierService } from '../generation/ClassifierService';
import { MemoryService } from '../generation/MemoryService';
import { SuggestionsService } from '../generation/SuggestionsService';
import { ActionChoicesService } from '../generation/ActionChoicesService';
import { StyleReviewerService } from '../generation/StyleReviewerService';
import { ContextBuilder, type ContextConfig } from '../generation/ContextBuilder';
import { LoreManagementService } from '../lorebook/LoreManagementService';
import { AgenticRetrievalService } from '../retrieval/AgenticRetrievalService';
import { TimelineFillService } from '../retrieval/TimelineFillService';
import { EntryRetrievalService, getEntryRetrievalConfigFromSettings } from '../retrieval/EntryRetrievalService';
import { ImageGenerationService } from '../image/ImageGenerationService';
import { TranslationService } from '../utils/TranslationService';
import { createLogger } from './config';

const log = createLogger('ServiceFactory');

/**
 * Factory class for creating AI providers and services.
 * Centralizes profile resolution and provider configuration.
 */
export class ServiceFactory {
  /**
   * Get a provider configured for the main narrative generation.
   * Uses the mainNarrativeProfileId to get the correct API credentials.
   */
  getMainProvider(): OpenAIProvider {
    const profileId = settings.apiSettings.mainNarrativeProfileId;
    return this.getProviderForProfileId(profileId, 'main narrative');
  }

  /**
   * Get a provider configured for a specific profile.
   * Used by services that have their own profile setting.
   */
  getProviderForProfile(profileId: string | null): OpenAIProvider {
    const resolvedProfileId = profileId ?? settings.apiSettings.mainNarrativeProfileId;
    return this.getProviderForProfileId(resolvedProfileId);
  }

  /**
   * Get a provider for a specific profile ID.
   * @throws Error if no API key is configured for the profile
   */
  getProviderForProfileId(profileId: string, contextLabel?: string): OpenAIProvider {
    const apiSettings = settings.getApiSettingsForProfile(profileId);

    log('Getting provider for profile', {
      profileId,
      apiKeyConfigured: !!apiSettings.openaiApiKey,
      context: contextLabel,
    });

    if (!apiSettings.openaiApiKey) {
      if (contextLabel) {
        throw new Error(`No API key configured for ${contextLabel} profile`);
      }
      throw new Error(`No API key configured for profile: ${profileId}`);
    }
    return new OpenAIProvider(apiSettings);
  }

  /**
   * Try to get a provider, returning null if not configured.
   * Useful for optional services that can run without AI.
   */
  tryGetProviderForProfile(profileId: string | null): OpenAIProvider | null {
    try {
      return this.getProviderForProfile(profileId);
    } catch {
      log('Provider not available for profile', profileId);
      return null;
    }
  }

  // ===== Service Instance Creators =====

  /**
   * Create a classifier service instance.
   */
  createClassifierService(): ClassifierService {
    const presetId = settings.getServicePresetId('classifier');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Classifier').profileId);
    return new ClassifierService(
      provider,
      presetId,
      settings.systemServicesSettings.classifier.chatHistoryTruncation ?? 100
    );
  }

  /**
   * Create a memory service instance.
   */
  createMemoryService(): MemoryService {
    const presetId = settings.getServicePresetId('memory');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Memory').profileId);
    return new MemoryService(provider, presetId);
  }

  /**
   * Create a suggestions service instance.
   */
  createSuggestionsService(): SuggestionsService {
    const presetId = settings.getServicePresetId('suggestions');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Suggestions').profileId);
    return new SuggestionsService(provider, presetId);
  }

  /**
   * Create an action choices service instance.
   */
  createActionChoicesService(): ActionChoicesService {
    const presetId = settings.getServicePresetId('actionChoices');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Action Choices').profileId);
    return new ActionChoicesService(provider, presetId);
  }

  /**
   * Create a style reviewer service instance.
   */
  createStyleReviewerService(): StyleReviewerService {
    const presetId = settings.getServicePresetId('styleReviewer');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Style Reviewer').profileId);
    return new StyleReviewerService(provider, presetId);
  }

  /**
   * Create a context builder instance.
   */
  createContextBuilder(config?: Partial<ContextConfig>): ContextBuilder {
    let provider: OpenAIProvider | null = null;
    try {
      provider = this.getMainProvider();
    } catch {
      log('No provider available for context builder, skipping Tier 3');
    }
    return new ContextBuilder(provider, config);
  }

  /**
   * Create an entry retrieval service instance.
   */
  createEntryRetrievalService(): EntryRetrievalService {
    const config = getEntryRetrievalConfigFromSettings();
    const presetId = settings.getServicePresetId('entryRetrieval');
    let provider: OpenAIProvider | null = null;
    if (config.enableLLMSelection) {
      provider = this.tryGetProviderForProfile(settings.getPresetConfig(presetId, 'Entry Retrieval').profileId);
    }
    return new EntryRetrievalService(provider, config, presetId);
  }

  /**
   * Create a lore management service instance.
   */
  createLoreManagementService(): LoreManagementService {
    const presetId = settings.getServicePresetId('loreManagement');
    const loreManagementSettings = settings.systemServicesSettings.loreManagement;
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Lore Manager').profileId);
    return new LoreManagementService(
      provider,
      presetId,
      loreManagementSettings.maxIterations
    );
  }

  /**
   * Create an agentic retrieval service instance.
   */
  createAgenticRetrievalService(): AgenticRetrievalService {
    const presetId = settings.getServicePresetId('agenticRetrieval');
    const agenticRetrievalSettings = settings.systemServicesSettings.agenticRetrieval;
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Agentic Retrieval').profileId);
    return new AgenticRetrievalService(
      provider,
      presetId,
      agenticRetrievalSettings.maxIterations
    );
  }

  /**
   * Create a timeline fill service instance.
   */
  createTimelineFillService(): TimelineFillService {
    const presetId = settings.getServicePresetId('timelineFill');
    const timelineFillSettings = settings.systemServicesSettings.timelineFill;
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Timeline Fill').profileId);
    return new TimelineFillService(
      provider,
      presetId,
      timelineFillSettings.maxQueries
    );
  }

  /**
   * Create a timeline fill service for chapter queries.
   * Uses dedicated chapterQuery settings.
   */
  createChapterQueryService(): TimelineFillService {
    const presetId = settings.getServicePresetId('chapterQuery');
    const chapterQuerySettings = settings.systemServicesSettings.chapterQuery;
    const timelineFillSettings = settings.systemServicesSettings.timelineFill;
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Chapter Query').profileId);
    return new TimelineFillService(
      provider,
      presetId,
      timelineFillSettings.maxQueries,
      {
        model: chapterQuerySettings.model,
        temperature: chapterQuerySettings.temperature,
        reasoningEffort: chapterQuerySettings.reasoningEffort,
        providerOnly: chapterQuerySettings.providerOnly,
        manualBody: chapterQuerySettings.manualBody,
      }
    );
  }

  /**
   * Create an image generation service instance.
   */
  createImageGenerationService(): ImageGenerationService {
    const presetId = settings.getServicePresetId('imageGeneration');
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Image Generation').profileId);
    return new ImageGenerationService(provider, presetId);
  }

  /**
   * Create a translation service instance for a specific translation type.
   */
  createTranslationService(type: 'narration' | 'input' | 'ui' | 'suggestions' | 'actionChoices' | 'wizard'): TranslationService {
    const presetId = settings.getServicePresetId(`translation:${type}`);
    const provider = this.getProviderForProfile(settings.getPresetConfig(presetId, 'Translation').profileId);
    return new TranslationService(provider, presetId);
  }
}

// Export singleton instance
export const serviceFactory = new ServiceFactory();
