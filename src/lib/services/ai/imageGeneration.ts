/**
 * Image Generation Service
 *
 * Coordinates the full image generation pipeline:
 * 1. Identify imageable scenes from narrative using ImagePromptService
 * 2. Create pending EmbeddedImage records
 * 3. Queue async image generation for each scene
 *
 * Runs in parallel with other post-narrative tasks (suggestions, action choices).
 */

import type { EmbeddedImage, Character } from '$lib/types';
import type { OpenAIProvider } from './openrouter';
import { ImagePromptService, type ImagePromptContext, type ImageableScene } from './imagePrompt';
import { NanoGPTImageProvider } from './nanoGPTImageProvider';
import { database } from '$lib/services/database';
import { promptService } from '$lib/services/prompts';
import { settings } from '$lib/stores/settings.svelte';
import { emitImageQueued, emitImageReady } from '$lib/services/events';

const DEBUG = true;

function log(...args: any[]) {
  if (DEBUG) {
    console.log('[ImageGeneration]', ...args);
  }
}

export interface ImageGenerationContext {
  storyId: string;
  entryId: string;
  narrativeResponse: string;
  userAction: string;
  presentCharacters: Character[];
  currentLocation?: string;
  /** Full chat history for context (untruncated) */
  chatHistory?: string;
  /** Activated lorebook entries context */
  lorebookContext?: string;
}

export class ImageGenerationService {
  private promptService: ImagePromptService;
  private imageProvider: NanoGPTImageProvider | null = null;

  constructor(provider: OpenAIProvider) {
    // Get prompt settings from image generation settings
    const imageSettings = settings.systemServicesSettings.imageGeneration;
    const promptSettings = {
      model: imageSettings.promptModel,
      temperature: imageSettings.promptTemperature,
      maxTokens: imageSettings.promptMaxTokens,
      reasoningEffort: imageSettings.reasoningEffort,
    };
    this.promptService = new ImagePromptService(provider, promptSettings);
  }

  /**
   * Check if image generation is enabled and configured
   */
  static isEnabled(): boolean {
    const imageSettings = settings.systemServicesSettings.imageGeneration;
    if (!imageSettings?.enabled) return false;

    // Check if we have a NanoGPT API key
    return !!imageSettings.nanoGptApiKey;
  }

  /**
   * Generate images for a narrative response.
   * This is the main entry point called after narrative generation completes.
   *
   * @returns Promise that resolves when all images are queued (not completed)
   */
  async generateForNarrative(context: ImageGenerationContext): Promise<void> {
    const imageSettings = settings.systemServicesSettings.imageGeneration;

    if (!imageSettings?.enabled) {
      log('Image generation disabled');
      return;
    }

    log('Starting image generation', {
      storyId: context.storyId,
      entryId: context.entryId,
      narrativeLength: context.narrativeResponse.length,
      presentCharacters: context.presentCharacters.length,
    });

    try {
      // Get the selected style template
      const stylePrompt = this.getStylePrompt(imageSettings.styleId);

      // Build character descriptors for the prompt service
      const characterDescriptors = context.presentCharacters
        .filter(c => c.visualDescriptors && c.visualDescriptors.length > 0)
        .map(c => ({
          name: c.name,
          visualDescriptors: c.visualDescriptors ?? [],
        }));

      // Get max images setting (0 = unlimited)
      const maxImages = imageSettings.maxImagesPerMessage ?? 3;

      // Build prompt context
      const promptContext: ImagePromptContext = {
        narrativeResponse: context.narrativeResponse,
        userAction: context.userAction,
        presentCharacters: characterDescriptors,
        currentLocation: context.currentLocation,
        stylePrompt,
        maxImages,
        chatHistory: context.chatHistory,
        lorebookContext: context.lorebookContext,
      };

      // Identify imageable scenes
      const scenes = await this.promptService.identifyScenes(promptContext);

      log('Scenes identified', {
        count: scenes.length,
        types: scenes.map(s => s.sceneType),
      });

      if (scenes.length === 0) {
        log('No imageable scenes found');
        return;
      }

      // Limit to max images per message (0 = unlimited)
      const scenesToProcess = maxImages === 0
        ? scenes.sort((a, b) => b.priority - a.priority)
        : scenes.sort((a, b) => b.priority - a.priority).slice(0, maxImages);

      log('Processing scenes', {
        total: scenes.length,
        selected: scenesToProcess.length,
        maxAllowed: maxImages,
      });

      // Create pending EmbeddedImage records and queue generation
      for (const scene of scenesToProcess) {
        await this.queueImageGeneration(
          context.storyId,
          context.entryId,
          scene,
          imageSettings
        );
      }

      log('All images queued');
    } catch (error) {
      log('Image generation failed', error);
      // Don't throw - image generation failure shouldn't break the main flow
    }
  }

  /**
   * Get the style prompt for the selected style ID
   */
  private getStylePrompt(styleId: string): string {
    // Try to get from prompt service (user may have customized)
    try {
      const promptContext = {
        mode: 'adventure' as const,
        pov: 'second' as const,
        tense: 'present' as const,
        protagonistName: '',
      };
      const customized = promptService.getPrompt(styleId, promptContext);
      if (customized) {
        return customized;
      }
    } catch {
      // Template not found, use fallback
    }

    // Fallback to default styles
    const defaultStyles: Record<string, string> = {
      'image-style-soft-anime': `Soft cel-shaded anime illustration. Muted pastel color palette with low saturation. Diffused ambient lighting, subtle linework blending into colors. Smooth gradients, slight bloom effect on highlights. Dreamy, airy atmosphere. Studio Ghibli-inspired. Soft shadows, watercolor texture hints in background.`,
      'image-style-semi-realistic': `Semi-realistic anime art with refined, detailed rendering. Realistic proportions with anime influence. Detailed hair strands, subtle skin tones, fabric folds. Naturalistic lighting with clear direction and soft falloff. Cinematic composition with depth of field. Rich, slightly desaturated colors with intentional color grading. Painterly quality with polished edges. Atmospheric and grounded mood.`,
      'image-style-photorealistic': `Photorealistic digital art. True-to-life rendering with natural lighting. Detailed textures, accurate proportions. Professional photography aesthetic. Cinematic depth of field. High dynamic range. Realistic materials and surfaces.`,
    };

    return defaultStyles[styleId] || defaultStyles['image-style-soft-anime'];
  }

  /**
   * Queue image generation for a single scene
   */
  private async queueImageGeneration(
    storyId: string,
    entryId: string,
    scene: ImageableScene,
    imageSettings: typeof settings.systemServicesSettings.imageGeneration
  ): Promise<void> {
    const imageId = crypto.randomUUID();

    // Create pending record in database
    const embeddedImage: Omit<EmbeddedImage, 'createdAt'> = {
      id: imageId,
      storyId,
      entryId,
      sourceText: scene.sourceText,
      prompt: scene.prompt,
      styleId: imageSettings.styleId,
      model: imageSettings.model,
      imageData: '',
      width: imageSettings.size === '1024x1024' ? 1024 : 512,
      height: imageSettings.size === '1024x1024' ? 1024 : 512,
      status: 'pending',
    };

    await database.createEmbeddedImage(embeddedImage);
    log('Created pending image record', { imageId, sourceText: scene.sourceText });

    // Emit queued event
    emitImageQueued(imageId, entryId);

    // Start async generation (fire-and-forget)
    this.generateImage(imageId, scene.prompt, imageSettings, entryId).catch(error => {
      log('Async image generation failed', { imageId, error });
    });
  }

  /**
   * Generate a single image (runs asynchronously)
   */
  private async generateImage(
    imageId: string,
    prompt: string,
    imageSettings: typeof settings.systemServicesSettings.imageGeneration,
    entryId: string
  ): Promise<void> {
    try {
      // Update status to generating
      await database.updateEmbeddedImage(imageId, { status: 'generating' });

      // Get API key from settings
      const apiKey = imageSettings.nanoGptApiKey;
      if (!apiKey) {
        throw new Error('No NanoGPT API key configured for image generation');
      }

      // Create provider if needed
      if (!this.imageProvider) {
        this.imageProvider = new NanoGPTImageProvider(apiKey);
      }

      // Generate image
      const response = await this.imageProvider.generateImage({
        prompt,
        model: imageSettings.model,
        size: imageSettings.size,
        response_format: 'b64_json',
      });

      if (response.images.length === 0 || !response.images[0].b64_json) {
        throw new Error('No image data returned');
      }

      // Update record with image data
      await database.updateEmbeddedImage(imageId, {
        imageData: response.images[0].b64_json,
        status: 'complete',
      });

      log('Image generated successfully', { imageId });

      // Emit ready event
      emitImageReady(imageId, entryId, true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      log('Image generation failed', { imageId, error: errorMessage });

      // Update record with error
      await database.updateEmbeddedImage(imageId, {
        status: 'failed',
        errorMessage,
      });

      // Emit ready event (with failure)
      emitImageReady(imageId, entryId, false);
    }
  }
}
