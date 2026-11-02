/**
 * The contract between the Electron main process and the renderer.
 * The preload script implements this shape; the renderer consumes it through
 * `renderer/src/services/api.ts`. Keeping it in /shared avoids the renderer
 * importing from /app.
 */
import type { Host, SshKey, TabLayoutInput, TabLayoutSnapshot } from './types'

export interface AppInfo {
  name: string
  version: string
  platform: string
}

export interface ConnectRequest {
  sessionId: string
  host: string
  port: number
  username: string
  authMethod: 'password' | 'key' | 'none'
  password?: string
  keyId?: string | null
  cols?: number
  rows?: number
}

export interface SessionDataEvent {
  sessionId: string
  chunk: string
}

export interface SessionStateEvent {
  sessionId: string
  state: string
}

export interface SessionErrorEvent {
  sessionId: string
  message: string
}

export interface ReliquaryApi {
  appInfo(): Promise<AppInfo>

  host: {
    list(): Promise<Host[]>
    save(host: Partial<Host>): Promise<Host>
    remove(id: string): Promise<void>
  }

  key: {
    list(): Promise<SshKey[]>
    generate(payload: {
      name: string
      type: string
      passphrase?: string
      comment?: string
    }): Promise<SshKey>
    import(payload: { name: string; privateKey: string; passphrase?: string }): Promise<SshKey>
    remove(id: string): Promise<void>
    exportPublic(id: string): Promise<string>
  }

  session: {
    connect(request: ConnectRequest): Promise<void>
    write(payload: { sessionId: string; data: string }): Promise<void>
    resize(payload: { sessionId: string; cols: number; rows: number }): Promise<void>
    disconnect(sessionId: string): Promise<void>
    onData(listener: (payload: SessionDataEvent) => void): () => void
    onState(listener: (payload: SessionStateEvent) => void): () => void
    onError(listener: (payload: SessionErrorEvent) => void): () => void
  }

  tab: {
    /** The layout saved on the last run (empty snapshot on first start). */
    load(): Promise<TabLayoutSnapshot>
    /** Persist the current layout; main stamps savedAt and deviceId. */
    save(input: TabLayoutInput): Promise<TabLayoutSnapshot>
  }
}
