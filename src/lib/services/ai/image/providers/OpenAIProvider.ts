/**
 * OpenAI-Compatible Image Provider
 *
 * Implementation of ImageProvider for any OpenAI-compatible image generation API.
 * Users can specify their own endpoint URL, API key, and model.
 *
 * Supports two endpoints:
 * - /v1/images/generations - for text-to-image generation
 * - /v1/images/edits - for image-to-image generation (when reference images are provided)
 */

import type {
  ImageProvider,
  ImageGenerationRequest,
  ImageGenerationResponse,
  ImageModelInfo,
} from './base';
import { ImageGenerationError } from './base';

export class OpenAICompatibleImageProvider implements ImageProvider {
  id = 'openai-compatible';
  name = 'OpenAI Compatible';

  private apiKey: string;
  private baseUrl: string;
  private debug: boolean;

  constructor(baseUrl: string, apiKey: string, debug = false) {
    // Normalize the base URL - remove trailing slash and any existing path
    this.baseUrl = baseUrl
      .replace(/\/+$/, '')
      .replace(/\/v1\/images\/(generations|edits|variations)$/, '')
      .replace(/\/v1$/, '');
    this.apiKey = apiKey;
    this.debug = debug;
  }

  async generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResponse> {
    // Determine which endpoint to use based on whether reference images are provided
    const hasReferenceImages = request.imageDataUrls && request.imageDataUrls.length > 0;
    const endpoint = hasReferenceImages
      ? `${this.baseUrl}/v1/images/edits`
      : `${this.baseUrl}/v1/images/generations`;

    if (this.debug) {
      console.log('[OpenAI-Compatible] Generating image with request:', {
        model: request.model,
        size: request.size,
        n: request.n,
        promptLength: request.prompt.length,
        hasReferenceImages,
        endpoint,
      });
    }

    try {
      let response: Response;

      if (hasReferenceImages) {
        // Use multipart/form-data for image edits (required by OpenAI API)
        response = await this.generateWithEdits(request, endpoint);
      } else {
        // Use JSON for regular generations
        response = await this.generateWithJson(request, endpoint);
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new ImageGenerationError(
          `OpenAI-compatible image generation failed: ${response.status} ${response.statusText} - ${errorText}`,
          this.id,
          response.status
        );
      }

      const data = await response.json();

      if (this.debug) {
        console.log('[OpenAI-Compatible] Generation response:', {
          imageCount: data.data?.length ?? 0,
          created: data.created,
        });
      }

      return {
        images: (data.data || []).map((img: any) => ({
          b64_json: img.b64_json,
          url: img.url,
          revised_prompt: img.revised_prompt,
        })),
        model: request.model,
      };
    } catch (error) {
      if (error instanceof ImageGenerationError) {
        throw error;
      }
      throw new ImageGenerationError(
        `OpenAI-compatible request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.id,
        undefined,
        error
      );
    }
  }

  /**
   * Generate image using JSON body (for /v1/images/generations)
   */
  private async generateWithJson(request: ImageGenerationRequest, endpoint: string): Promise<Response> {
    const body: Record<string, unknown> = {
      prompt: request.prompt,
      model: request.model,
      n: request.n ?? 1,
      size: request.size ?? '1024x1024',
      response_format: request.response_format ?? 'b64_json',
    };

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });
  }

  /**
   * Generate image using multipart/form-data (for /v1/images/edits)
   * This is required when providing reference images
   */
  private async generateWithEdits(request: ImageGenerationRequest, endpoint: string): Promise<Response> {
    const formData = new FormData();

    formData.append('prompt', request.prompt);
    formData.append('model', request.model);
    formData.append('n', String(request.n ?? 1));
    formData.append('size', request.size ?? '1024x1024');

    // For edits endpoint, response_format works differently for different models
    // GPT image models always return b64, DALL-E models support url or b64_json
    if (request.response_format) {
      formData.append('response_format', request.response_format);
    }

    // Add reference images
    // OpenAI edits endpoint expects images as file uploads
    if (request.imageDataUrls && request.imageDataUrls.length > 0) {
      for (let i = 0; i < request.imageDataUrls.length; i++) {
        const dataUrl = request.imageDataUrls[i];
        const blob = await this.dataUrlToBlob(dataUrl);
        // OpenAI expects image[] for multiple images, or just image for single
        if (request.imageDataUrls.length === 1) {
          formData.append('image', blob, `reference_${i}.png`);
        } else {
          formData.append('image[]', blob, `reference_${i}.png`);
        }
      }
    }

    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        // Don't set Content-Type - browser will set it with boundary for FormData
      },
      body: formData,
    });
  }

  /**
   * Convert a data URL to a Blob for form upload
   */
  private async dataUrlToBlob(dataUrl: string): Promise<Blob> {
    // Handle both data URLs and raw base64
    if (dataUrl.startsWith('data:')) {
      const response = await fetch(dataUrl);
      return response.blob();
    } else {
      // Assume it's raw base64, convert to blob
      const byteCharacters = atob(dataUrl);
      const byteNumbers = new Array(byteCharacters.length);
      for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
      }
      const byteArray = new Uint8Array(byteNumbers);
      return new Blob([byteArray], { type: 'image/png' });
    }
  }

  async listModels(): Promise<ImageModelInfo[]> {
    // OpenAI-compatible APIs don't have a standardized models endpoint for images
    // Return empty list - user must specify their own model
    return [];
  }

  async validateCredentials(): Promise<boolean> {
    try {
      // Try to access the models endpoint to check if credentials work
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      return response.status !== 401 && response.status !== 403;
    } catch {
      // If models endpoint doesn't exist, just return true
      // Let actual generation fail if credentials are wrong
      return true;
    }
  }
}

/**
 * Create an OpenAI-compatible image provider instance.
 * @param baseUrl - The base URL of the OpenAI-compatible API (e.g., https://api.example.com)
 * @param apiKey - The API key
 * @param debug - Enable debug logging
 */
export function createOpenAICompatibleProvider(baseUrl: string, apiKey: string, debug = false): ImageProvider {
  return new OpenAICompatibleImageProvider(baseUrl, apiKey, debug);
}
