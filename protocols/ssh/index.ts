/**
 * SSH protocol adapter.
 * Wraps ssh2's Client and exposes the shared ConnectionAdapter interface.
 * The adapter owns the shell channel; the app talks to it through write()/resize().
 */
import ssh2, { type Client, type ClientChannel, type ConnectConfig } from 'ssh2'

// ssh2 is a CommonJS module: the ESM build of the main process cannot use
// named imports for it, so the namespace is imported as a default.
const { Client: SshClient } = ssh2
import {
  AuthMethod,
  ProtocolCapability,
  ProtocolType,
  SessionState,
  type ConnectionOptions
} from '@shared/types'
import { BaseAdapter } from '../core/base-adapter'

export interface SshAdapterOptions {
  /** Terminal type reported to the server. */
  term?: string
  /** Initial PTY size. */
  cols?: number
  rows?: number
}

export class SshAdapter extends BaseAdapter {
  readonly protocol = ProtocolType.SSH
  readonly capabilities: ProtocolCapability[] = [ProtocolCapability.TERMINAL]

  private client: Client | null = null
  private shell: ClientChannel | null = null
  private closing = false
  private readonly term: string
  private cols: number
  private rows: number

  constructor(options: SshAdapterOptions = {}) {
    super()
    this.term = options.term ?? 'xterm-256color'
    this.cols = options.cols ?? 80
    this.rows = options.rows ?? 24
  }

  async connect(options: ConnectionOptions): Promise<void> {
    if (this.client) throw new Error('SSH adapter is already connected')

    this.setState(SessionState.CONNECTING)

    const config: ConnectConfig = {
      host: options.host,
      port: options.port,
      username: options.username,
      readyTimeout: options.timeoutMs ?? 20_000,
      keepaliveInterval: 10_000
    }

    if (options.authMethod === AuthMethod.PASSWORD) {
      if (!options.password) throw new Error('Password authentication requires a password')
      config.password = options.password
    } else if (options.authMethod === AuthMethod.KEY) {
      if (!options.privateKey) throw new Error('Key authentication requires private key material')
      config.privateKey = options.privateKey
      if (options.privateKeyPassphrase) config.passphrase = options.privateKeyPassphrase
    } else {
      config.tryKeyboard = true
    }

    const client = new SshClient()
    this.client = client

    await new Promise<void>((resolve, reject) => {
      const onFatal = (error: Error) => {
        cleanup()
        this.client = null
        this.setState(SessionState.ERROR)
        this.emitter.emit('error', error)
        reject(error)
      }

      const onReady = () => {
        cleanup()
        this.openShell(client).then(resolve, reject)
      }

      const cleanup = () => {
        client.off('ready', onReady)
        client.off('error', onFatal)
      }

      client.once('ready', onReady)
      client.once('error', onFatal)
      client.connect(config)
    })

    // The handshake listeners above are one-shot. For the rest of the
    // connection's life the Client must keep 'error'/'close' listeners:
    // without them a socket reset mid-session (read ECONNRESET thrown from
    // TCP.onStreamRead) becomes an uncaught exception and Electron shows the
    // fatal main-process error dialog instead of a reconnect prompt.
    client.on('error', (error: Error) => {
      if (this.closing) return
      this.emitter.emit('error', error)
      this.emitter.emit('close', undefined)
    })
    client.on('close', () => {
      if (this.closing) return
      this.shell = null
      this.setState(SessionState.CLOSED)
      this.emitter.emit('close', undefined)
    })

    this.setState(SessionState.CONNECTED)
  }

  /** Opens an interactive shell with a PTY. */
  private openShell(client: Client): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      client.shell(
        { term: this.term, cols: this.cols, rows: this.rows },
        (error: Error | undefined, channel: ClientChannel) => {
          if (error) {
            reject(error)
            return
          }

          this.shell = channel

          // A channel-level error with no listener would also crash the
          // process; surface it through the adapter instead.
          channel.on('error', (error: Error) => {
            if (!this.closing) this.emitter.emit('error', error)
          })

          channel.on('data', (chunk: Buffer) => {
            this.emitter.emit('data', chunk.toString('utf8'))
          })

          channel.stderr.on('data', (chunk: Buffer) => {
            this.emitter.emit('data', chunk.toString('utf8'))
          })

          channel.on('close', () => {
            if (this.closing) return
            this.shell = null
            this.setState(SessionState.CLOSED)
            this.emitter.emit('close', undefined)
          })

          // If the connection dies while the shell is opening, fail connect().
          client.once('error', reject)

          resolve()
        }
      )
    })
  }

  override write(data: string): void {
    if (!this.shell) throw new Error('SSH shell is not open')
    this.shell.write(data)
  }

  override resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.shell?.setWindow(rows, cols, 0, 0)
  }

  async disconnect(): Promise<void> {
    if (this.currentState === SessionState.CLOSED) return
    this.closing = true
    this.setState(SessionState.CLOSING)

    try {
      this.shell?.end()
      this.shell = null
    } catch {
      // The channel may already be gone — closing the client is enough.
    }

    this.client?.end()
    this.client = null
    this.setState(SessionState.CLOSED)
    this.emitter.emit('close', undefined)
  }
}
