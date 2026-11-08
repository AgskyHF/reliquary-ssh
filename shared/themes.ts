/**
 * The terminal themes.
 *
 * A theme is not only a set of colours — it is the whole look of the
 * terminal: the palette of the sixteen ANSI colours, the background, the
 * cursor, the selection and the font. That is why two themes must never
 * look the same: a light theme has a light background and dark text, a
 * hacker theme has everything in one colour, a warm theme has an olive
 * background — the difference has to be visible at a glance.
 *
 * The palettes are the published ones of the respective projects.
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
  /** The font of the terminal — the themes differ in it too. */
  fontFamily: string
  /** The size of the font, in pixels. */
  fontSize: number
}

/** The theme used when nothing was picked. */
export const DEFAULT_THEME_ID = 'termius-dark'

/** The monospace fonts of macOS — every theme uses one of them. */
const MENLO = "'SF Mono', Menlo, monospace"
const MONACO = 'Monaco, monospace'
const ANDALE = "'Andale Mono', 'Lucida Console', monospace"
const COURIER = "'Courier New', Courier, monospace"

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
    fontFamily: MENLO,
    fontSize: 13,
    colors: {
      foreground: '#33FF66',
      background: '#0A0E0A',
      cursor: '#33FF66',
      cursorAccent: '#0A0E0A',
      selectionBackground: 'rgba(51, 255, 102, 0.28)',
      black: '#0A0E0A',
      red: '#FF4D4D',
      green: '#33FF66',
      yellow: '#FFD24D',
      blue: '#4DA6FF',
      magenta: '#FF66CC',
      cyan: '#4DFFFF',
      white: '#CCFFCC',
      brightBlack: '#4E6B52',
      brightRed: '#FF7373',
      brightGreen: '#66FF88',
      brightYellow: '#FFE47D',
      brightBlue: '#80BDFF',
      brightMagenta: '#FF99E0',
      brightCyan: '#80FFFF',
      brightWhite: '#F0FFF0'
    }
  },
  {
    id: 'termius-light',
    name: 'Termius Light',
    hint: 'The classic, in daylight',
    fontFamily: MENLO,
    fontSize: 13,
    colors: {
      foreground: '#1B2B1B',
      background: '#F4F6F4',
      cursor: '#0A7A32',
      cursorAccent: '#F4F6F4',
      selectionBackground: 'rgba(10, 122, 50, 0.18)',
      black: '#1B2B1B',
      red: '#B32424',
      green: '#0A7A32',
      yellow: '#8A6100',
      blue: '#1B5FBF',
      magenta: '#9B2393',
      cyan: '#00707A',
      white: '#3C4C3C',
      brightBlack: '#6A7A6A',
      brightRed: '#D14D4D',
      brightGreen: '#22A14A',
      brightYellow: '#B07C00',
      brightBlue: '#2E7BE8',
      brightMagenta: '#C43FAE',
      brightCyan: '#009AA6',
      brightWhite: '#0A0A0A'
    }
  },
  {
    id: 'flexoki-dark',
    name: 'Flexoki Dark',
    hint: 'Warm and inky',
    fontFamily: MENLO,
    fontSize: 13,
    colors: {
      foreground: '#CECDC3',
      background: '#100F0F',
      cursor: '#D0A215',
      cursorAccent: '#100F0F',
      selectionBackground: 'rgba(208, 162, 21, 0.22)',
      black: '#100F0F',
      red: '#D14D41',
      green: '#879A39',
      yellow: '#D0A215',
      blue: '#4385BE',
      magenta: '#CE5D97',
      cyan: '#3AA99F',
      white: '#CECDC3',
      brightBlack: '#878580',
      brightRed: '#EC8B49',
      brightGreen: '#A0AF54',
      brightYellow: '#D0A215',
      brightBlue: '#66A0C8',
      brightMagenta: '#8B7EC8',
      brightCyan: '#5ABDAC',
      brightWhite: '#E6E4D9'
    }
  },
  {
    id: 'flexoki-light',
    name: 'Flexoki Light',
    hint: 'Warm paper',
    fontFamily: MENLO,
    fontSize: 13,
    colors: {
      foreground: '#100F0F',
      background: '#FFFCF0',
      cursor: '#AD8301',
      cursorAccent: '#FFFCF0',
      selectionBackground: 'rgba(173, 131, 1, 0.18)',
      black: '#100F0F',
      red: '#AF3029',
      green: '#66800B',
      yellow: '#AD8301',
      blue: '#205EA6',
      magenta: '#A02F6F',
      cyan: '#24837B',
      white: '#343331',
      brightBlack: '#878580',
      brightRed: '#D14D41',
      brightGreen: '#879A39',
      brightYellow: '#D0A215',
      brightBlue: '#4385BE',
      brightMagenta: '#CE5D97',
      brightCyan: '#3AA99F',
      brightWhite: '#6F6E69'
    }
  },
  {
    id: 'kanagawa-wave',
    name: 'Kanagawa Wave',
    hint: 'Calm and warm',
    fontFamily: ANDALE,
    fontSize: 13,
    colors: {
      foreground: '#DCD7BA',
      background: '#1F1F28',
      cursor: '#C4B28A',
      cursorAccent: '#1F1F28',
      selectionBackground: 'rgba(36, 40, 59, 0.9)',
      black: '#090618',
      red: '#C34043',
      green: '#76946A',
      yellow: '#C0A36E',
      blue: '#7E9CD8',
      magenta: '#957FB8',
      cyan: '#6A9589',
      white: '#CECDC3',
      brightBlack: '#727169',
      brightRed: '#D6021C',
      brightGreen: '#98BB6C',
      brightYellow: '#E6C384',
      brightBlue: '#7E9CD8',
      brightMagenta: '#B4A1D4',
      brightCyan: '#7FB1A4',
      brightWhite: '#DCD7BA'
    }
  },
  {
    id: 'kanagawa-dragon',
    name: 'Kanagawa Dragon',
    hint: 'Darker, for the night',
    fontFamily: ANDALE,
    fontSize: 13,
    colors: {
      foreground: '#C5C9C5',
      background: '#181616',
      cursor: '#8A8980',
      cursorAccent: '#181616',
      selectionBackground: 'rgba(36, 40, 59, 0.9)',
      black: '#0D0C0C',
      red: '#C34043',
      green: '#76946A',
      yellow: '#C0A36E',
      blue: '#7E9CD8',
      magenta: '#957FB8',
      cyan: '#6A9589',
      white: '#C5C9C5',
      brightBlack: '#727169',
      brightRed: '#D6021C',
      brightGreen: '#98BB6C',
      brightYellow: '#E6C384',
      brightBlue: '#7E9CD8',
      brightMagenta: '#B4A1D4',
      brightCyan: '#7FB1A4',
      brightWhite: '#C5C9C5'
    }
  },
  {
    id: 'kanagawa-lotus',
    name: 'Kanagawa Lotus',
    hint: 'Bright and calm',
    fontFamily: ANDALE,
    fontSize: 13,
    colors: {
      foreground: '#545464',
      background: '#F2ECBC',
      cursor: '#8C6C3E',
      cursorAccent: '#F2ECBC',
      selectionBackground: 'rgba(76, 79, 105, 0.18)',
      black: '#1F1F28',
      red: '#C84053',
      green: '#6F894E',
      yellow: '#C7A53B',
      blue: '#4D7FBB',
      magenta: '#B35B79',
      cyan: '#597B75',
      white: '#545464',
      brightBlack: '#716E61',
      brightRed: '#D95763',
      brightGreen: '#87A35E',
      brightYellow: '#E0C35A',
      brightBlue: '#6691CB',
      brightMagenta: '#CE6D8B',
      brightCyan: '#6B948D',
      brightWhite: '#43436C'
    }
  },
  {
    id: 'hacker-blue',
    name: 'Hacker Blue',
    hint: 'The blue of a hacker',
    fontFamily: COURIER,
    fontSize: 14,
    colors: {
      foreground: '#4DA6FF',
      background: '#05080F',
      cursor: '#4DA6FF',
      cursorAccent: '#05080F',
      selectionBackground: 'rgba(77, 166, 255, 0.28)',
      black: '#05080F',
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
    id: 'hacker-green',
    name: 'Hacker Green',
    hint: 'Only green',
    fontFamily: MONACO,
    fontSize: 14,
    colors: {
      foreground: '#00FF41',
      background: '#000000',
      cursor: '#00FF41',
      cursorAccent: '#000000',
      selectionBackground: 'rgba(0, 255, 65, 0.3)',
      black: '#000000',
      red: '#00CC33',
      green: '#00FF41',
      yellow: '#00DD44',
      blue: '#00AA33',
      magenta: '#00CC33',
      cyan: '#00BB33',
      white: '#00CC33',
      brightBlack: '#007A28',
      brightRed: '#00FF41',
      brightGreen: '#5CFF7A',
      brightYellow: '#00FF41',
      brightBlue: '#00FF41',
      brightMagenta: '#00FF41',
      brightCyan: '#00FF41',
      brightWhite: '#00FF41'
    }
  },
  {
    id: 'hacker-red',
    name: 'Hacker Red',
    hint: 'Only red',
    fontFamily: MONACO,
    fontSize: 14,
    colors: {
      foreground: '#FF3B30',
      background: '#0A0000',
      cursor: '#FF3B30',
      cursorAccent: '#0A0000',
      selectionBackground: 'rgba(255, 59, 48, 0.3)',
      black: '#0A0000',
      red: '#FF3B30',
      green: '#C22A20',
      yellow: '#D6362C',
      blue: '#A6241B',
      magenta: '#B02A21',
      cyan: '#C22A20',
      white: '#E0392F',
      brightBlack: '#7A1A14',
      brightRed: '#FF6B60',
      brightGreen: '#E0453A',
      brightYellow: '#F25C51',
      brightBlue: '#C7382E',
      brightMagenta: '#D94339',
      brightCyan: '#E0453A',
      brightWhite: '#FF8A80'
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
