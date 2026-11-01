/**
 * FTP adapter — roadmap only, not implemented in the MVP.
 * The interface is fixed so the app can register the adapter later without UI changes.
 */
import {
  ProtocolCapability,
  ProtocolType,
  SessionState,
  type ConnectionOptions
} from '@shared/types'
import { BaseAdapter } from '../core/base-adapter'

export class FtpAdapter extends BaseAdapter {
  readonly protocol = ProtocolType.FTP
  readonly capabilities: ProtocolCapability[] = [ProtocolCapability.FILE_MANAGER]

  async connect(_options: ConnectionOptions): Promise<void> {
    throw new Error('FtpAdapter is not implemented yet (roadmap)')
  }

  async disconnect(): Promise<void> {
    this.setState(SessionState.CLOSED)
  }
}
