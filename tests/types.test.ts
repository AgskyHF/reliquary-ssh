import { describe, expect, it } from 'vitest'
import {
  AuthMethod,
  IPC,
  KeyType,
  ProtocolCapability,
  ProtocolType,
  SessionState,
  TabKind
} from '@shared/types'

describe('shared types', () => {
  it('exposes stable protocol identifiers', () => {
    expect(ProtocolType.SSH).toBe('ssh')
    expect(ProtocolType.SFTP).toBe('sftp')
    expect(ProtocolType.LOCAL).toBe('local')
  })

  it('exposes key types', () => {
    expect(Object.values(KeyType)).toEqual(['rsa', 'ed25519', 'ecdsa'])
  })

  it('exposes tab kinds and session states', () => {
    expect(Object.values(TabKind)).toEqual(['ssh', 'sftp', 'local_terminal'])
    expect(SessionState.ERROR).toBe('error')
  })

  it('exposes auth methods and capabilities', () => {
    expect(Object.values(AuthMethod)).toEqual(['password', 'key', 'none'])
    expect(Object.values(ProtocolCapability)).toEqual(['terminal', 'file_manager'])
  })

  it('keeps IPC channel names unique', () => {
    const values = Object.values(IPC)
    expect(new Set(values).size).toBe(values.length)
  })
})
