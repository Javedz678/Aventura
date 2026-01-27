/**
 * AI Utilities Module
 *
 * Utility services and helpers for AI operations:
 * - JSON healing: Parse and repair malformed JSON from LLM responses
 * - Translation: Multi-language translation service
 * - TTS: Text-to-speech service
 */

export { tryParseJsonWithHealing, parseJsonWithHealing } from './jsonHealing';

export { TranslationService, type TranslationResult, type UITranslationItem } from './TranslationService';

export {
  AITTSService,
  aiTTSService,
  TTSProvider,
  GoogleTranslateTTSProvider,
  OpenAICompatibleTTSProvider,
  GOOGLE_TRANSLATE_LANGUAGES,
  type TTSSettings,
  type TTSVoice,
  type TTSStreamChunk,
} from './TTSService';
