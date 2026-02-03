/**
 * Provider Registry
 *
 * Single entry point for creating Vercel AI SDK providers from APIProfile.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { createChutes } from '@chutes-ai/ai-sdk-provider';
import { createPollinations } from 'ai-sdk-pollinations';

import type { APIProfile, ProviderType } from '$lib/types';
import { createTimeoutFetch } from './fetch';
import { NANOGPT_API_URL } from './defaults';

const DEFAULT_TIMEOUT_MS = 180000;

const DEFAULT_BASE_URLS: Record<ProviderType, string | undefined> = {
  openrouter: 'https://openrouter.ai/api/v1',
  openai: undefined,
  anthropic: undefined,
  google: undefined,
  nanogpt: NANOGPT_API_URL,
  chutes: undefined,
  pollinations: undefined,
};

export function createProviderFromProfile(profile: APIProfile) {
  const fetch = createTimeoutFetch(DEFAULT_TIMEOUT_MS);
  const baseURL = profile.baseUrl || DEFAULT_BASE_URLS[profile.providerType];

  switch (profile.providerType) {
    case 'openrouter':
      return createOpenRouter({
        apiKey: profile.apiKey,
        baseURL: baseURL ?? 'https://openrouter.ai/api/v1',
        headers: { 'HTTP-Referer': 'https://aventura.camp', 'X-Title': 'Aventura' },
        fetch,
      });

    case 'openai':
      return createOpenAI({ apiKey: profile.apiKey, baseURL, fetch });

    case 'anthropic':
      return createAnthropic({ apiKey: profile.apiKey, baseURL, fetch });

    case 'google':
      throw new Error('Google provider not yet implemented');

    case 'nanogpt':
      return createOpenAI({
        name: 'nanogpt',
        apiKey: profile.apiKey,
        baseURL: baseURL ?? NANOGPT_API_URL,
        fetch,
      });

    case 'chutes':
      return createChutes({ apiKey: profile.apiKey });

    case 'pollinations':
      return createPollinations({ apiKey: profile.apiKey || undefined });

    default: {
      const _exhaustive: never = profile.providerType;
      throw new Error(`Unknown provider type: ${_exhaustive}`);
    }
  }
}
