/**
 * Base class for protocol adapters.
 * Handles the common state machine and event plumbing so each protocol only
 * implements the transport-specific parts.
 */
import { SessionState, type ConnectionAdapter, type ConnectionOptions } from '@shared/types'
import { Emitter } from './emitter'

interface AdapterEvents {
  data: string
  error: Error
  close: undefined
  state: SessionState
}

export abstract class BaseAdapter implements ConnectionAdapter {
  abstract readonly protocol: ConnectionAdapter['protocol']
  abstract readonly capabilities: ConnectionAdapter['capabilities']

  protected readonly emitter = new Emitter<AdapterEvents>()
  protected currentState: SessionState = SessionState.IDLE

  get state(): SessionState {
    return this.currentState
  }

  protected setState(next: SessionState): void {
    if (this.currentState === next) return
    this.currentState = next
    this.emitter.emit('state', next)
  }

  abstract connect(options: ConnectionOptions): Promise<void>
  abstract disconnect(): Promise<void>

  write(_data: string): void {
    throw new Error(`${this.constructor.name} does not support write()`)
  }

  resize(_cols: number, _rows: number): void {
    throw new Error(`${this.constructor.name} does not support resize()`)
  }

  on(event: 'data', listener: (chunk: string) => void): void
  on(event: 'error', listener: (error: Error) => void): void
  on(event: 'close', listener: () => void): void
  on(event: 'state', listener: (state: SessionState) => void): void
  on<K extends keyof AdapterEvents>(event: K, listener: (payload: AdapterEvents[K]) => void): void {
    this.emitter.on(event, listener)
  }
}
