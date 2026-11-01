/**
 * Type-safe access to the preload API.
 * The renderer never talks to Electron, SQLite or SSH directly — only through here.
 */
import type { ReliquaryApi } from '@shared/api'

declare global {
  interface Window {
    reliquary: ReliquaryApi
  }
}

export const api: ReliquaryApi = window.reliquary
