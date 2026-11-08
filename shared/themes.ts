/**
 * The terminal themes.
 *
 * Every theme is the palette of a terminal: the background, the text and
 * the sixteen ANSI colours. The values are the published palettes of the
 * respective projects, so the terminal looks exactly like it does in the
 * tool the theme comes from.
 *
 * The shape of the colours matches the `ITheme` of xterm.js, so the theme
 * can be handed to the terminal without a translation.
 */

/** The colours of one theme — the shape xterm.js expects. */
export interface ThemeColors {
  foreground: string
  background: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

/** One theme of the catalogue. */
export interface TerminalTheme {
  /** The stable id — it is stored in the settings. */
  id: string
  /** The name of the theme, as its author spells it. */
  name: string
  /** A hint about the look, shown under the name. */
  hint?: string
  /** The colours of the theme. */
  colors: ThemeColors
}

/** The theme used when nothing was picked. */
export const DEFAULT_THEME_ID = 'termius-dark'

/**
 * The catalogue.
 *
 * The first two are the classics every user knows: the green one and the
 * blue one. The rest are the palettes that are worth having — they are
 * the most popular ones of the last years.
 */
export const TERMINAL_THEMES: TerminalTheme[] = [
  {
    id: 'termius-dark',
    name: 'Termius Dark',
    hint: 'The classic green',
    colors: {
      foreground: '#D7D7D7',
      background: '#0C0C0C',
      cursor: '#00FF41',
      cursorAccent: '#0C0C0C',
      selectionBackground: 'rgba(0, 255, 65, 0.3)',
      black: '#0C0C0C',
      red: '#FF4343',
      green: '#00FF41',
      yellow: '#FFC300',
      blue: '#4FA3FF',
      magenta: '#FF73FF',
      cyan: '#00FFFF',
      white: '#D7D7D7',
      brightBlack: '#6A6A6A',
      brightRed: '#FF6B6B',
      brightGreen: '#5CFF7A',
      brightYellow: '#FFE066',
      brightBlue: '#7FC4FF',
      brightMagenta: '#FF99FF',
      brightCyan: '#66FFFF',
      brightWhite: '#FFFFFF'
    }
  },
  {
    id: 'hacker-blue',
    name: 'Hacker Blue',
    hint: 'The blue of a hacker',
    colors: {
      foreground: '#C8D3E0',
      background: '#0A0E14',
      cursor: '#4DA6FF',
      cursorAccent: '#0A0E14',
      selectionBackground: 'rgba(77, 166, 255, 0.3)',
      black: '#0A0E14',
      red: '#FF5C5C',
      green: '#7CFC00',
      yellow: '#FFD866',
      blue: '#4DA6FF',
      magenta: '#C792EA',
      cyan: '#4DD0E1',
      white: '#C8D3E0',
      brightBlack: '#4A5568',
      brightRed: '#FF8080',
      brightGreen: '#A6FF7C',
      brightYellow: '#FFE599',
      brightBlue: '#80C4FF',
      brightMagenta: '#DDA7F5',
      brightCyan: '#7FE8F5',
      brightWhite: '#FFFFFF'
    }
  },
  {
    id: 'dracula',
    name: 'Dracula',
    hint: 'Purple vampire',
    colors: {
      foreground: '#F8F8F2',
      background: '#282A36',
      cursor: '#F8F8F2',
      cursorAccent: '#282A36',
      selectionBackground: 'rgba(189, 147, 249, 0.3)',
      black: '#21222C',
      red: '#FF5555',
      green: '#50FA7B',
      yellow: '#F1FA8C',
      blue: '#BD93F9',
      magenta: '#FF79C6',
      cyan: '#8BE9FD',
      white: '#F8F8F2',
      brightBlack: '#6272A4',
      brightRed: '#FF6E6E',
      brightGreen: '#69FF94',
      brightYellow: '#FFFFA5',
      brightBlue: '#D6ACFF',
      brightMagenta: '#FF92DF',
      brightCyan: '#A4FFFF',
      brightWhite: '#FFFFFF'
    }
  },
  {
    id: 'nord',
    name: 'Nord',
    hint: 'Arctic, calm',
    colors: {
      foreground: '#D8DEE9',
      background: '#2E3440',
      cursor: '#D8DEE9',
      cursorAccent: '#2E3440',
      selectionBackground: 'rgba(136, 192, 208, 0.3)',
      black: '#3B4252',
      red: '#BF616A',
      green: '#A3BE8C',
      yellow: '#EBCB8B',
      blue: '#81A1C1',
      magenta: '#B48EAD',
      cyan: '#88C0D0',
      white: '#E5E9F0',
      brightBlack: '#4C566A',
      brightRed: '#BF616A',
      brightGreen: '#A3BE8C',
      brightYellow: '#EBCB8B',
      brightBlue: '#81A1C1',
      brightMagenta: '#B48EAD',
      brightCyan: '#8FBCBB',
      brightWhite: '#ECEFF4'
    }
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    hint: 'The scientific one',
    colors: {
      foreground: '#839496',
      background: '#002B36',
      cursor: '#93A1A1',
      cursorAccent: '#002B36',
      selectionBackground: 'rgba(147, 161, 161, 0.3)',
      black: '#073642',
      red: '#DC322F',
      green: '#859900',
      yellow: '#B58900',
      blue: '#268BD2',
      magenta: '#D33682',
      cyan: '#2AA198',
      white: '#EEE8D5',
      brightBlack: '#586E75',
      brightRed: '#CB4B16',
      brightGreen: '#586E75',
      brightYellow: '#657B83',
      brightBlue: '#839496',
      brightMagenta: '#6C71C4',
      brightCyan: '#93A1A1',
      brightWhite: '#FDF6E3'
    }
  },
  {
    id: 'one-dark',
    name: 'One Dark',
    hint: 'Balanced',
    colors: {
      foreground: '#ABB2BF',
      background: '#282C34',
      cursor: '#528BFF',
      cursorAccent: '#282C34',
      selectionBackground: 'rgba(97, 175, 239, 0.3)',
      black: '#3E4451',
      red: '#E06C75',
      green: '#98C379',
      yellow: '#E5C07B',
      blue: '#61AFEF',
      magenta: '#C678DD',
      cyan: '#56B6C2',
      white: '#ABB2BF',
      brightBlack: '#5C6370',
      brightRed: '#E06C75',
      brightGreen: '#98C379',
      brightYellow: '#E5C07B',
      brightBlue: '#61AFEF',
      brightMagenta: '#C678DD',
      brightCyan: '#56B6C2',
      brightWhite: '#FFFFFF'
    }
  },
  {
    id: 'gruvbox-dark',
    name: 'Gruvbox Dark',
    hint: 'Warm retro',
    colors: {
      foreground: '#EBDBB2',
      background: '#282828',
      cursor: '#EBDBB2',
      cursorAccent: '#282828',
      selectionBackground: 'rgba(131, 165, 152, 0.3)',
      black: '#282828',
      red: '#FB4934',
      green: '#B8BB26',
      yellow: '#FABD2F',
      blue: '#83A598',
      magenta: '#D3869B',
      cyan: '#8EC07C',
      white: '#EBDBB2',
      brightBlack: '#928374',
      brightRed: '#FB4934',
      brightGreen: '#B8BB26',
      brightYellow: '#FABD2F',
      brightBlue: '#83A598',
      brightMagenta: '#D3869B',
      brightCyan: '#8EC07C',
      brightWhite: '#FBF1C7'
    }
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    hint: 'Neon noir',
    colors: {
      foreground: '#C0CAF5',
      background: '#1A1B26',
      cursor: '#C0CAF5',
      cursorAccent: '#1A1B26',
      selectionBackground: 'rgba(122, 162, 247, 0.3)',
      black: '#15161E',
      red: '#F7768E',
      green: '#9ECE6A',
      yellow: '#E0AF68',
      blue: '#7AA2F7',
      magenta: '#BB9AF7',
      cyan: '#7DCFFF',
      white: '#A9B1D6',
      brightBlack: '#414868',
      brightRed: '#F7768E',
      brightGreen: '#9ECE6A',
      brightYellow: '#E0AF68',
      brightBlue: '#7AA2F7',
      brightMagenta: '#BB9AF7',
      brightCyan: '#7DCFFF',
      brightWhite: '#C0CAF5'
    }
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    hint: 'Soft pastel',
    colors: {
      foreground: '#CDD6F4',
      background: '#1E1E2E',
      cursor: '#F5E0DC',
      cursorAccent: '#1E1E2E',
      selectionBackground: 'rgba(137, 180, 250, 0.3)',
      black: '#45475A',
      red: '#F38BA8',
      green: '#A6E3A1',
      yellow: '#F9E2AF',
      blue: '#89B4FA',
      magenta: '#CBA6F7',
      cyan: '#94E2D5',
      white: '#BAC2DE',
      brightBlack: '#585B70',
      brightRed: '#F38BA8',
      brightGreen: '#A6E3A1',
      brightYellow: '#F9E2AF',
      brightBlue: '#89B4FA',
      brightMagenta: '#CBA6F7',
      brightCyan: '#94E2D5',
      brightWhite: '#A6ADC8'
    }
  },
  {
    id: 'rose-pine',
    name: 'Rosé Pine',
    hint: 'Muted plum',
    colors: {
      foreground: '#E0DEF4',
      background: '#191724',
      cursor: '#E0DEF4',
      cursorAccent: '#191724',
      selectionBackground: 'rgba(196, 167, 231, 0.3)',
      black: '#26233A',
      red: '#EB6F92',
      green: '#9CCFD8',
      yellow: '#F6C177',
      blue: '#31748F',
      magenta: '#C4A7E7',
      cyan: '#EBBCBA',
      white: '#E0DEF4',
      brightBlack: '#6E6A86',
      brightRed: '#EB6F92',
      brightGreen: '#9CCFD8',
      brightYellow: '#F6C177',
      brightBlue: '#31748F',
      brightMagenta: '#C4A7E7',
      brightCyan: '#EBBCBA',
      brightWhite: '#E0DEF4'
    }
  }
]

/** True when the value is the id of a known theme. */
export function isThemeId(value: unknown): value is string {
  return typeof value === 'string' && TERMINAL_THEMES.some((theme) => theme.id === value)
}

/** The theme with this id, or the default one. */
export function themeById(id: string): TerminalTheme {
  return TERMINAL_THEMES.find((theme) => theme.id === id) ?? TERMINAL_THEMES[0]
}
