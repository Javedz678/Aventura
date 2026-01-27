import { BaseAIService, type OpenAIProvider } from '../core/BaseAIService';
import type { GenerationPreset, TranslationSettings } from '$lib/types';
import { promptService, type PromptContext } from '$lib/services/prompts';
import { tryParseJsonWithHealing } from './jsonHealing';
import { createLogger } from '../core/config';

const log = createLogger('Translation');

// Use Intl.DisplayNames for proper language name resolution
const languageDisplayNames = new Intl.DisplayNames(['en'], { type: 'language' });

// Common language codes for the UI dropdown
const SUPPORTED_LANGUAGE_CODES = [
  'en', 'es', 'fr', 'de', 'it', 'pt', 'ja', 'ko', 'zh', 'ru',
  'ar', 'hi', 'nl', 'pl', 'tr', 'vi', 'th', 'id', 'sv', 'da',
  'no', 'fi', 'cs', 'el', 'he', 'uk', 'ro', 'hu', 'bg', 'hr',
  'sk', 'sl', 'et', 'lv', 'lt', 'ms', 'fil', 'bn', 'ta', 'te',
];

export interface TranslationResult {
  translatedContent: string;
  detectedLanguage?: string;
}

export interface UITranslationItem {
  id: string;
  text: string;
  type: 'name' | 'description' | 'title';
}

export class TranslationService extends BaseAIService {
  constructor(provider: OpenAIProvider, presetId: string = 'translation', settingsOverride?: Partial<GenerationPreset>) {
    super(provider, presetId, settingsOverride);
  }

  /**
   * Get the human-readable name for a language code using Intl API
   */
  private getLanguageName(code: string): string {
    if (code === 'auto') return 'auto-detect';
    try {
      return languageDisplayNames.of(code) || code;
    } catch {
      return code;
    }
  }

  /**
   * Module 1: Translate narration (post-generation)
   * Handles both plain text and visual prose HTML
   */
  async translateNarration(
    content: string,
    targetLanguage: string,
    isVisualProse: boolean = false
  ): Promise<TranslationResult> {
    // Skip if target is English and content appears to be English
    if (targetLanguage === 'en') {
      return { translatedContent: content };
    }

    log('translateNarration called', {
      contentLength: content.length,
      targetLanguage,
      isVisualProse,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-narration', promptContext, {
      targetLanguage: this.getLanguageName(targetLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-narration', promptContext, {
      content,
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      log('Narration translated', {
        originalLength: content.length,
        translatedLength: response.content.length,
      });

      return { translatedContent: response.content.trim() };
    } catch (error) {
      log('Narration translation failed:', error);
      throw error;
    }
  }

  /**
   * Module 2: Translate user input to English
   * Used before sending to AI for narrative generation
   */
  async translateInput(
    content: string,
    sourceLanguage: string
  ): Promise<TranslationResult> {
    log('translateInput called', {
      contentLength: content.length,
      sourceLanguage,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-input', promptContext, {
      sourceLanguage: sourceLanguage === 'auto' ? 'the detected language' : this.getLanguageName(sourceLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-input', promptContext, {
      content,
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      log('Input translated', {
        originalLength: content.length,
        translatedLength: response.content.length,
      });

      return { translatedContent: response.content.trim() };
    } catch (error) {
      log('Input translation failed:', error);
      throw error;
    }
  }

  /**
   * Module 3: Batch translate UI elements
   * Used for world state (characters, locations, items, story beats)
   */
  async translateUIElements(
    items: UITranslationItem[],
    targetLanguage: string
  ): Promise<UITranslationItem[]> {
    if (items.length === 0) return [];

    // Skip if target is English
    if (targetLanguage === 'en') {
      return items;
    }

    log('translateUIElements called', {
      itemCount: items.length,
      targetLanguage,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-ui', promptContext, {
      targetLanguage: this.getLanguageName(targetLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-ui', promptContext, {
      elementsJson: JSON.stringify(items, null, 2),
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      const parsed = tryParseJsonWithHealing<UITranslationItem[]>(response.content);
      if (!parsed || !Array.isArray(parsed)) {
        log('Failed to parse UI translation response');
        return items;
      }

      log('UI elements translated', {
        inputCount: items.length,
        outputCount: parsed.length,
      });

      return parsed;
    } catch (error) {
      log('UI translation failed:', error);
      return items;
    }
  }

  /**
   * Module 4: Translate suggestions (creative writing plot suggestions)
   */
  async translateSuggestions<T extends { text: string; type?: string }>(
    suggestions: T[],
    targetLanguage: string
  ): Promise<T[]> {
    if (suggestions.length === 0) return [];

    // Skip if target is English
    if (targetLanguage === 'en') {
      return suggestions;
    }

    log('translateSuggestions called', {
      count: suggestions.length,
      targetLanguage,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-suggestions', promptContext, {
      targetLanguage: this.getLanguageName(targetLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-suggestions', promptContext, {
      suggestionsJson: JSON.stringify(suggestions, null, 2),
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      const parsed = tryParseJsonWithHealing<T[]>(response.content);
      if (!parsed || !Array.isArray(parsed)) {
        log('Failed to parse suggestions translation response');
        return suggestions;
      }

      log('Suggestions translated', {
        inputCount: suggestions.length,
        outputCount: parsed.length,
      });

      return parsed;
    } catch (error) {
      log('Suggestions translation failed:', error);
      return suggestions;
    }
  }

  /**
   * Module 5: Translate action choices (adventure mode)
   */
  async translateActionChoices<T extends { text: string; type?: string }>(
    choices: T[],
    targetLanguage: string
  ): Promise<T[]> {
    if (choices.length === 0) return [];

    // Skip if target is English
    if (targetLanguage === 'en') {
      return choices;
    }

    log('translateActionChoices called', {
      count: choices.length,
      targetLanguage,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-action-choices', promptContext, {
      targetLanguage: this.getLanguageName(targetLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-action-choices', promptContext, {
      choicesJson: JSON.stringify(choices, null, 2),
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      const parsed = tryParseJsonWithHealing<T[]>(response.content);
      if (!parsed || !Array.isArray(parsed)) {
        log('Failed to parse action choices translation response');
        return choices;
      }

      log('Action choices translated', {
        inputCount: choices.length,
        outputCount: parsed.length,
      });

      return parsed;
    } catch (error) {
      log('Action choices translation failed:', error);
      return choices;
    }
  }

  /**
   * Module 6: Translate wizard content (settings, characters, openings)
   */
  async translateWizardContent(
    content: string,
    targetLanguage: string
  ): Promise<TranslationResult> {
    // Skip if target is English
    if (targetLanguage === 'en') {
      return { translatedContent: content };
    }

    log('translateWizardContent called', {
      contentLength: content.length,
      targetLanguage,
    });

    const promptContext: PromptContext = {
      mode: 'adventure',
      pov: 'second',
      tense: 'present',
      protagonistName: 'the protagonist',
    };

    const systemPrompt = promptService.renderPrompt('translate-wizard-content', promptContext, {
      targetLanguage: this.getLanguageName(targetLanguage),
    });

    const userPrompt = promptService.renderUserPrompt('translate-wizard-content', promptContext, {
      content,
    });

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      log('Wizard content translated', {
        originalLength: content.length,
        translatedLength: response.content.length,
      });

      return { translatedContent: response.content.trim() };
    } catch (error) {
      log('Wizard content translation failed:', error);
      throw error;
    }
  }

  /**
   * Module 7: Batch translate wizard content (all fields in one API call)
   * Takes a flat object of labeled strings and returns translations for all.
   */
  async translateWizardBatch(
    fields: Record<string, string>,
    targetLanguage: string
  ): Promise<Record<string, string>> {
    // Skip if target is English
    if (targetLanguage === 'en') {
      return fields;
    }

    // Filter out empty fields
    const nonEmptyFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (value && value.trim()) {
        nonEmptyFields[key] = value;
      }
    }

    // If no fields to translate, return original
    if (Object.keys(nonEmptyFields).length === 0) {
      return fields;
    }

    log('translateWizardBatch called', {
      fieldCount: Object.keys(nonEmptyFields).length,
      targetLanguage,
    });

    const languageName = this.getLanguageName(targetLanguage);

    // Build numbered format for more reliable parsing
    const fieldKeys = Object.keys(nonEmptyFields);
    const inputLines = fieldKeys.map((key, i) => `[${i + 1}] ${nonEmptyFields[key]}`);
    const inputText = inputLines.join('\n\n');

    const systemPrompt = `You are a translator. Translate each numbered item to ${languageName}.

RULES:
- Output ALL ${fieldKeys.length} items with their numbers
- Keep the exact format: [number] translated text
- For names/proper nouns: translate phonetically or keep as-is, but ALWAYS include the item
- Do not skip any items, do not add explanations

Example input:
[1] Hello world
[2] John Smith

Example output:
[1] Hola mundo
[2] John Smith`;

    const userPrompt = `Translate these ${fieldKeys.length} items to ${languageName}:\n\n${inputText}`;

    try {
      const response = await this.provider.generateResponse({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.temperature,
        maxTokens: this.maxTokens,
        extraBody: this.extraBody,
      });

      // Parse the response back into a record
      const result: Record<string, string> = { ...fields }; // Start with original (fallback)
      const responseText = response.content.trim();

      // Parse [number] content format - more flexible regex
      const itemRegex = /\[(\d+)\]\s*([\s\S]*?)(?=\n*\[\d+\]|$)/g;
      let match;
      while ((match = itemRegex.exec(responseText)) !== null) {
        const index = parseInt(match[1], 10) - 1; // Convert to 0-based
        const value = match[2].trim();
        if (index >= 0 && index < fieldKeys.length && value) {
          result[fieldKeys[index]] = value;
        }
      }

      // Debug: log if we didn't parse all expected fields
      const parsedCount = fieldKeys.filter(k => result[k] !== fields[k]).length;
      if (parsedCount < fieldKeys.length) {
        log('Batch translation parsing may have missed fields', {
          expected: fieldKeys,
          parsedCount,
          responsePreview: responseText.substring(0, 500),
        });
      }

      log('Wizard batch translated', {
        inputFields: Object.keys(nonEmptyFields).length,
        outputFields: Object.keys(result).length,
      });

      return result;
    } catch (error) {
      log('Wizard batch translation failed:', error);
      throw error;
    }
  }

  /**
   * Check if translation should be performed based on settings
   */
  static shouldTranslate(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.targetLanguage !== 'en';
  }

  /**
   * Check if user input translation should be performed
   */
  static shouldTranslateInput(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.translateUserInput;
  }

  /**
   * Check if narration translation should be performed
   */
  static shouldTranslateNarration(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.translateNarration && translationSettings.targetLanguage !== 'en';
  }

  /**
   * Check if world state UI translation should be performed
   */
  static shouldTranslateWorldState(translationSettings: TranslationSettings): boolean {
    return translationSettings.enabled && translationSettings.translateWorldState && translationSettings.targetLanguage !== 'en';
  }
}

/**
 * Get all supported language codes with their display names
 */
export function getSupportedLanguages(): { code: string; name: string }[] {
  return SUPPORTED_LANGUAGE_CODES
    .map(code => {
      try {
        return { code, name: languageDisplayNames.of(code) || code };
      } catch {
        return { code, name: code };
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Get language name for display using Intl API
 */
export function getLanguageDisplayName(code: string): string {
  if (code === 'auto') return 'Auto-detect';
  try {
    return languageDisplayNames.of(code) || code;
  } catch {
    return code;
  }
}
