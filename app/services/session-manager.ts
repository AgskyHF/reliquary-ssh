/**
 * Session manager — owns the live protocol adapters in the Electron main process.
 * The renderer never holds a connection; it talks to sessions through IPC.
 */
import { EventEmitter } from 'node:events'
import {
  ProtocolType,
  SessionState,
  type ConnectionAdapter,
  type ConnectionOptions,
  type FileManagerAdapter,
  type FileTransferRequest,
  type RemoteListing
} from '@shared/types'
import { createAdapter } from '@protocols/index'

export interface SessionManagerEvents {
  data: { sessionId: string; chunk: string }
  /**
   * Named "session-error" instead of "error" on purpose: Node's EventEmitter
   * treats an unhandled "error" event as a fatal throw.
   */
  sessionError: { sessionId: string; message: string }
  state: { sessionId: string; state: SessionState }
}

interface ManagedSession {
  id: string
  adapter: ConnectionAdapter
}

/**
 * Typed facade over EventEmitter.
 * The class does not merge with an interface — the typed on/emit methods live
 * here so eslint's no-unsafe-declaration-merging stays happy.
 */
export class SessionManager {
  private readonly emitter = new EventEmitter()
  private readonly sessions = new Map<string, ManagedSession>()

  on<K extends keyof SessionManagerEvents>(
    event: K,
    listener: (payload: SessionManagerEvents[K]) => void
  ): this {
    this.emitter.on(event, listener)
    return this
  }

  emit<K extends keyof SessionManagerEvents>(
    event: K,
    payload: SessionManagerEvents[K]
  ): boolean {
    return this.emitter.emit(event, payload)
  }

  list(): string[] {
    return [...this.sessions.keys()]
  }

  async connect(
    sessionId: string,
    protocol: ProtocolType,
    options: ConnectionOptions
  ): Promise<void> {
    if (this.sessions.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`)
    }

    const adapter = createAdapter(protocol)
    const managed: ManagedSession = { id: sessionId, adapter }
    this.sessions.set(sessionId, managed)

    adapter.on('data', (chunk: string) => {
      this.emit('data', { sessionId, chunk })
    })
    adapter.on('error', (error: Error) => {
      this.emit('sessionError', { sessionId, message: error.message })
    })
    adapter.on('close', () => {
      this.emit('state', { sessionId, state: SessionState.CLOSED })
      this.sessions.delete(sessionId)
    })
    adapter.on('state', (state: SessionState) => {
      this.emit('state', { sessionId, state })
    })

    try {
      await adapter.connect(options)
    } catch (error) {
      this.sessions.delete(sessionId)
      throw error
    }
  }

  /**
   * Writes to a session. A session that is gone (closed tab, restored tab
   * that is not connected yet) is silently ignored: the renderer may still
   * send keystrokes or resize events for a session that no longer exists,
   * and that must not raise an error in the main process.
   */
  write(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.adapter.write?.(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.sessions.get(sessionId)?.adapter.resize?.(cols, rows)
  }

  async disconnect(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.sessions.delete(sessionId)
    await session.adapter.disconnect()
  }

  async disconnectAll(): Promise<void> {
    await Promise.all([...this.sessions.values()].map((session) => session.adapter.disconnect()))
    this.sessions.clear()
  }

  /** Lists a remote directory of a file-manager session. */
  async listFiles(sessionId: string, path: string): Promise<RemoteListing> {
    return this.requireFileManager(sessionId).list(path)
  }

  /** Downloads a remote file to a local path. */
  async download(sessionId: string, request: FileTransferRequest): Promise<string> {
    return this.requireFileManager(sessionId).download(request)
  }

  /** Uploads a local file to a remote path. */
  async upload(sessionId: string, request: FileTransferRequest): Promise<string> {
    return this.requireFileManager(sessionId).upload(request)
  }

  /** Deletes a remote file or directory. */
  async delete(sessionId: string, request: FileTransferRequest): Promise<string> {
    return this.requireFileManager(sessionId).delete(request)
  }

  /** The directory a file-manager session currently sits in. */
  cwd(sessionId: string): string {
    return this.requireFileManager(sessionId).cwd
  }

  private requireFileManager(sessionId: string): FileManagerAdapter {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Unknown session: ${sessionId}`)

    const adapter = session.adapter as Partial<FileManagerAdapter>
    if (typeof adapter.list !== 'function' || typeof adapter.download !== 'function') {
      throw new Error(`Session ${sessionId} is not a file manager session`)
    }

    return adapter as FileManagerAdapter
  }
}
