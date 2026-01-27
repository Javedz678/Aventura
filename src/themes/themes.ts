/**
 * Centralized theme registry for Aventura.
 * Add new themes here and they'll automatically appear in the UI.
 */

export interface ThemeMetadata {
  id: string;
  label: string;
  description: string;
  isDark: boolean;
}

export const THEMES: ThemeMetadata[] = [
  {
    id: 'dark',
    label: 'Dark',
    description: 'Modern dark theme',
    isDark: true,
  },
  {
    id: 'light',
    label: 'Light (Paper)',
    description: 'Clean paper-like warm tones with amber accents',
    isDark: false,
  },
  {
    id: 'light-solarized',
    label: 'Light (Solarized)',
    description: 'Classic Solarized color scheme with cream backgrounds',
    isDark: false,
  },
  {
    id: 'retro-console',
    label: 'Retro Console',
    description: 'CRT aesthetic inspired by PS2-era games and Serial Experiments Lain',
    isDark: true,
  },
  {
    id: 'fallen-down',
    label: 'Fallen Down',
    description: '* The shadows deepen. Your adventure continues.',
    isDark: true,
  },
  {
    id: 'botanical',
    label: 'Botanical',
    description: 'Natural earth tones with organic accents',
    isDark: false,
  },
  {
    id: 'cyberpunk',
    label: 'Cyberpunk',
    description: 'Neon-lit dystopian future aesthetic',
    isDark: true,
  },
  {
    id: 'fantasy',
    label: 'Fantasy',
    description: 'Magical realm with mystical atmosphere',
    isDark: true,
  },
  {
    id: 'oled',
    label: 'OLED',
    description: 'Pure black theme optimized for OLED displays',
    isDark: true,
  },
  {
    id: 'royal',
    label: 'Royal',
    description: 'Regal theme with rich, luxurious colors',
    isDark: true,
  },
];

/**
 * Get theme metadata by ID
 */
export function getTheme(id: string): ThemeMetadata | undefined {
  return THEMES.find((theme) => theme.id === id);
}

/**
 * Type for all valid theme IDs
 */
export type ThemeId = typeof THEMES[number]['id'];
