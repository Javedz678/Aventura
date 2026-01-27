/**
 * AI Image Module
 *
 * Image generation services and providers:
 * - ImageGeneration: Main image generation service
 * - ImagePrompt: AI-powered image prompt generation
 * - InlineImage: Inline image generation during narrative
 * - Providers: Various image generation API providers
 */

export {
  ImageGenerationService,
  type ImageGenerationContext,
} from './ImageGenerationService';

export {
  ImagePromptService,
  createImagePromptService,
  type ImagePromptSettings,
  type ImageableScene,
  type ImagePromptContext,
} from './ImagePromptService';

export {
  InlineImageGenerationService,
  inlineImageService,
  type InlineImageContext,
} from './InlineImageService';

// Image providers
export {
  ImageGenerationError,
  type ImageProvider,
  type ImageGenerationRequest,
  type ImageGenerationResponse,
  type GeneratedImage,
  type ImageModelInfo,
} from './providers/base';

export { ChutesImageProvider, createChutesProvider } from './providers/ChutesProvider';
export { NanoGPTImageProvider, createNanoGPTProvider } from './providers/NanoGPTProvider';
export { OpenAICompatibleImageProvider, createOpenAICompatibleProvider } from './providers/OpenAIProvider';
