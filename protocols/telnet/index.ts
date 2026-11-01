/**
 * Telnet adapter — roadmap only, not implemented in the MVP.
 * The interface is fixed so the app can register the adapter later without UI changes.
 */
import {
  ProtocolCapability,
  ProtocolType,
  SessionState,
  type ConnectionOptions
} from '@shared/types'
import { BaseAdapter } from '../core/base-adapter'

export class TelnetAdapter extends BaseAdapter {
  readonly protocol = ProtocolType.TELNET
  readonly capabilities: ProtocolCapability[] = [ProtocolCapability.TERMINAL]

  async connect(_options: ConnectionOptions): Promise<void> {
    throw new Error('TelnetAdapter is not implemented yet (roadmap)')
  }

  async disconnect(): Promise<void> {
    this.setState(SessionState.CLOSED)
  }
}
