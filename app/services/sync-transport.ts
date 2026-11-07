/**
 * The sync transport router.
 *
 * The sync engine talks to one interface — it does not care whether the
 * encrypted entries travel over HTTP to a backend or live in a folder that
 * every device shares. This router picks the transport from the settings
 * and forwards the calls.
 *
 * Two transports:
 *  - 'server': the HTTP backend with an account (email/password or Google);
 *  - 'folder': a shared folder (Syncthing, NAS, cloud disk) — no account,
 *    no server process, the folder is the server.
 */
import type { SyncEntry } from '@shared/sync'
import type { SyncBackend } from './sync'
import type { BackendClient } from './backend-client'
import { FolderSyncBackend } from './sync-folder'
import { logger } from './logger'

export type TransportKind = 'server' | 'folder'

export interface TransportSettings {
  transport: TransportKind
  serverUrl: string
  folder: string
}

export class SyncTransportRouter implements SyncBackend {
  private folderBackend: FolderSyncBackend | null = null
  private current: TransportSettings

  constructor(
    private readonly server: BackendClient,
    settings: TransportSettings
  ) {
    this.current = settings
    this.folderBackend = new FolderSyncBackend(settings.folder)
  }

  /** Points the router at another transport. */
  setSettings(settings: TransportSettings): void {
    this.current = settings
    this.folderBackend = new FolderSyncBackend(settings.folder)
    logger.info('The sync transport changed', settings)
  }

  /** The transport in use. */
  get transport(): TransportKind {
    return this.current.transport
  }

  /** True when a session is held (server) or the folder exists (folder). */
  isSignedIn(): boolean {
    if (this.current.transport === 'folder') return this.folderBackend?.isSignedIn() ?? false
    return this.server.isSignedIn()
  }

  /** The address shown in the UI. */
  get serverUrl(): string {
    if (this.current.transport === 'folder') return this.folderBackend?.serverUrl ?? ''
    return this.server.serverUrl
  }

  /** Pushes the encrypted entries. */
  async pushEntries(entries: SyncEntry[]): Promise<number> {
    if (this.current.transport === 'folder') {
      return this.requireFolder().pushEntries(entries)
    }
    return this.server.pushEntries(entries)
  }

  /** Pulls the encrypted entries. */
  async pullEntries(entity?: string): Promise<SyncEntry[]> {
    if (this.current.transport === 'folder') {
      return this.requireFolder().pullEntries(entity)
    }
    return this.server.pullEntries(entity)
  }

  /** The folder backend, when the folder transport is selected. */
  private requireFolder(): FolderSyncBackend {
    if (!this.folderBackend) {
      throw new Error('The folder transport is not configured')
    }
    return this.folderBackend
  }
}
