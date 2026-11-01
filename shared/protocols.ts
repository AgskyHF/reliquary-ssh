/**
 * Protocol adapter registry.
 * Every protocol lives in /protocols/<name>/ and exposes the same ConnectionAdapter
 * interface, so the app never talks to a protocol implementation directly.
 */
import { ProtocolCapability, ProtocolType, type ProtocolDescriptor } from '@shared/types'

export const PROTOCOL_DESCRIPTORS: ProtocolDescriptor[] = [
  {
    protocol: ProtocolType.SSH,
    label: 'SSH',
    capabilities: [ProtocolCapability.TERMINAL],
    defaultPort: 22,
    implemented: true
  },
  {
    protocol: ProtocolType.SFTP,
    label: 'SFTP',
    capabilities: [ProtocolCapability.FILE_MANAGER],
    defaultPort: 22,
    implemented: true
  },
  {
    protocol: ProtocolType.FTP,
    label: 'FTP',
    capabilities: [ProtocolCapability.FILE_MANAGER],
    defaultPort: 21,
    implemented: false
  },
  {
    protocol: ProtocolType.TELNET,
    label: 'Telnet',
    capabilities: [ProtocolCapability.TERMINAL],
    defaultPort: 23,
    implemented: false
  },
  {
    protocol: ProtocolType.SERIAL,
    label: 'Serial',
    capabilities: [ProtocolCapability.TERMINAL],
    defaultPort: 0,
    implemented: false
  }
]

export function getProtocolDescriptor(protocol: ProtocolType): ProtocolDescriptor | undefined {
  return PROTOCOL_DESCRIPTORS.find((item) => item.protocol === protocol)
}
