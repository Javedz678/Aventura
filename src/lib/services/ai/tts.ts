/**
 * Text-To-Speech (TTS) Service
 * Provides audio generation via OpenAI-compatible APIs with streaming support.
 * Designed for extensibility to support multiple TTS providers.
 */

import { OPENROUTER_API_URL } from './openrouter';
import type { APIProfile } from '$lib/types';

// TTS Configuration
export interface TTSSettings {
  enabled: boolean;
  profileId: string | null;
  endpoint: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
  autonarrate: boolean;
}

export interface TTSVoice {
  name: string;
  id: string;
  lang: string;
}

export interface TTSStreamChunk {
  type: 'data' | 'end' | 'error';
  data?: ArrayBuffer;
  error?: string;
}

/**
 * Base TTS Provider - extend this for custom implementations
 */
export abstract class TTSProvider {
  abstract get name(): string;

  /**
   * Get available voices for this provider
   */
  abstract getAvailableVoices(): Promise<TTSVoice[]>;

  /**
   * Generate TTS audio and return as blob
   */
  abstract generateSpeech(text: string, voice: string): Promise<Blob>;
}

/**
 * OpenAI-compatible TTS Provider
 * Supports OpenAI, OpenRouter, and any OpenAI-compatible endpoint
 */
export class OpenAICompatibleTTSProvider extends TTSProvider {
  private settings: TTSSettings;
  private voiceCache: Map<string, TTSVoice[]> = new Map();
  private audioElement: HTMLAudioElement;

  constructor(settings: TTSSettings) {
    super();
    this.settings = settings;
    this.audioElement = typeof document !== 'undefined' ? document.createElement('audio') : null as any;
  }

  override get name(): string {
    return 'OpenAI Compatible';
  }

  /**
   * Get endpoint URL
   */
  private getEndpoint(): string {
    // If no custom endpoint, use OpenRouter default
    if (!this.settings.endpoint) {
      return `${OPENROUTER_API_URL}/audio/speech`;
    }
    // Ensure endpoint ends with /audio/speech
    const url = this.settings.endpoint.replace(/\/$/, '');
    return url.endsWith('/audio/speech') ? url : `${url}/audio/speech`;
  }

  /**
   * Verify settings are valid
   */
  private validateSettings(): void {
    if (!this.settings.apiKey) {
      throw new Error('TTS: No API key configured');
    }
    if (!this.settings.model) {
      throw new Error('TTS: No model selected');
    }
    if (!this.settings.voice) {
      throw new Error('TTS: No voice selected');
    }
  }

  /**
   * Get request headers
   */
  private getHeaders(): HeadersInit {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.settings.apiKey}`,
    };
  }

  /**
   * Get available voices - cached per endpoint
   */
  override async getAvailableVoices(): Promise<TTSVoice[]> {
    const endpoint = this.getEndpoint();

    // Return cached voices if available
    if (this.voiceCache.has(endpoint)) {
      return this.voiceCache.get(endpoint)!;
    }

    // Default voices matching OpenAI's standard set
    const defaultVoices: TTSVoice[] = [
      { name: 'Alloy', id: 'alloy', lang: 'en-US' },
      { name: 'Echo', id: 'echo', lang: 'en-US' },
      { name: 'Fable', id: 'fable', lang: 'en-US' },
      { name: 'Onyx', id: 'onyx', lang: 'en-US' },
      { name: 'Nova', id: 'nova', lang: 'en-US' },
      { name: 'Shimmer', id: 'shimmer', lang: 'en-US' },
    ];

    // Try to fetch custom voices from provider (optional)
    try {
      const response = await fetch(`${endpoint.replace('/audio/speech', '')}/models`, {
        headers: this.getHeaders(),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.data && Array.isArray(data.data)) {
          const voices = data.data.filter((m: any) => m.id?.includes('tts')).map((m: any) => ({
            name: m.id,
            id: m.id,
            lang: 'en-US',
          }));
          if (voices.length > 0) {
            this.voiceCache.set(endpoint, voices);
            return voices;
          }
        }
      }
    } catch (err) {
      console.warn('[TTS] Failed to fetch custom voices, using defaults', err);
    }

    this.voiceCache.set(endpoint, defaultVoices);
    return defaultVoices;
  }

  /**
   * Generate TTS audio blob
   */
  override async generateSpeech(text: string, voice: string): Promise<Blob> {
    this.validateSettings();

    if (!text || text.trim().length === 0) {
      throw new Error('TTS: Cannot generate speech for empty text');
    }

    const response = await fetch(this.getEndpoint(), {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        model: this.settings.model,
        input: text,
        voice: voice,
        speed: this.settings.speed,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`TTS generation failed: ${response.status} - ${error}`);
    }

    return response.blob();
  }

  /**
   * Play audio blob with visual feedback
   */
  async playAudio(blob: Blob, onProgress?: (progress: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);

      this.audioElement.src = url;
      this.audioElement.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('Failed to play audio'));
      };

      // Track progress
      if (onProgress && this.audioElement.duration) {
        const updateProgress = () => {
          onProgress((this.audioElement.currentTime / this.audioElement.duration) * 100);
        };
        this.audioElement.addEventListener('timeupdate', updateProgress);
      }

      this.audioElement.onended = () => {
        URL.revokeObjectURL(url);
        resolve();
      };

      this.audioElement.play().catch(reject);
    });
  }

  /**
   * Stop current playback
   */
  stopAudio(): void {
    this.audioElement.pause();
    this.audioElement.currentTime = 0;
  }

  /**
   * Get current playback state
   */
  getPlaybackState(): { playing: boolean; progress: number; duration: number } {
    return {
      playing: !this.audioElement.paused,
      progress: this.audioElement.currentTime,
      duration: this.audioElement.duration || 0,
    };
  }
}

/**
 * TTS Service - Main API for the application
 * Manages TTS operations and provider lifecycle
 */
export class AITTSService {
  private provider: OpenAICompatibleTTSProvider | null = null;
  private settings: TTSSettings | null = null;
  private isPlaying = false;
  private currentAudio: Blob | null = null;

  /**
   * Initialize service with settings
   */
  async initialize(settings: TTSSettings): Promise<void> {
    this.settings = settings;

    if (!settings.enabled) {
      this.provider = null;
      return;
    }

    try {
      this.provider = new OpenAICompatibleTTSProvider(settings);
      // Validate by fetching voices
      await this.provider.getAvailableVoices();
    } catch (error) {
      console.error('[TTSService] Failed to initialize provider:', error);
      this.provider = null;
      throw error;
    }
  }

  /**
   * Update settings and reinitialize if needed
   */
  async updateSettings(settings: Partial<TTSSettings>): Promise<void> {
    if (!this.settings) {
      throw new Error('TTS service not initialized');
    }

    this.settings = { ...this.settings, ...settings };
    await this.initialize(this.settings);
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return (this.settings?.enabled ?? false) && !!this.provider;
  }

  /**
   * Get available voices
   */
  async getAvailableVoices(): Promise<TTSVoice[]> {
    if (!this.provider) {
      throw new Error('TTS provider not initialized');
    }
    return this.provider.getAvailableVoices();
  }

  /**
   * Generate and play TTS audio
   */
  async generateAndPlay(
    text: string,
    voice?: string,
    onProgress?: (progress: number) => void
  ): Promise<void> {
    if (!this.provider || !this.settings) {
      throw new Error('TTS service not ready');
    }

    const voiceToUse = voice || this.settings.voice;

    try {
      this.isPlaying = true;
      const blob = await this.provider.generateSpeech(text, voiceToUse);
      this.currentAudio = blob;
      await this.provider.playAudio(blob, onProgress);
    } finally {
      this.isPlaying = false;
    }
  }

  /**
   * Generate TTS audio without playing
   */
  async generateSpeech(text: string, voice?: string): Promise<Blob> {
    if (!this.provider || !this.settings) {
      throw new Error('TTS service not ready');
    }

    const voiceToUse = voice || this.settings.voice;
    return this.provider.generateSpeech(text, voiceToUse);
  }

  /**
   * Stop playback
   */
  stopPlayback(): void {
    if (!this.provider) return;
    this.provider.stopAudio();
    this.isPlaying = false;
  }

  /**
   * Check if currently playing
   */
  isCurrentlyPlaying(): boolean {
    return this.isPlaying;
  }

  /**
   * Get current playback progress
   */
  getPlaybackProgress(): { playing: boolean; progress: number; duration: number } {
    if (!this.provider) {
      return { playing: false, progress: 0, duration: 0 };
    }
    return this.provider.getPlaybackState();
  }
}

// Export singleton instance
export const aiTTSService = new AITTSService();
