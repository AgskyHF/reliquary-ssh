/**
 * Protocol adapter factory.
 * The app asks for an adapter by protocol type and never imports a concrete
 * implementation directly, so new protocols plug in without UI changes.
 */
import { ProtocolType, type ConnectionAdapter } from '@shared/types'
import { SshAdapter } from './ssh'

export function createAdapter(protocol: ProtocolType): ConnectionAdapter {
  switch (protocol) {
    case ProtocolType.SSH:
      return new SshAdapter()
    default:
      throw new Error(`No adapter registered for protocol: ${protocol}`)
  }
}
