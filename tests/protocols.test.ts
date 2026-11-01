import { describe, expect, it } from 'vitest'
import { ProtocolType, SessionState } from '@shared/types'
import { PROTOCOL_DESCRIPTORS, getProtocolDescriptor } from '@shared/protocols'
import { BaseAdapter } from '@protocols/core/base-adapter'

class DummyAdapter extends BaseAdapter {
  readonly protocol = ProtocolType.SSH
  readonly capabilities = []

  async connect(): Promise<void> {
    this.setState(SessionState.CONNECTED)
  }

  async disconnect(): Promise<void> {
    this.setState(SessionState.CLOSED)
  }
}

describe('protocol registry', () => {
  it('describes every planned protocol', () => {
    expect(PROTOCOL_DESCRIPTORS.map((item) => item.protocol)).toEqual([
      ProtocolType.SSH,
      ProtocolType.SFTP,
      ProtocolType.FTP,
      ProtocolType.TELNET,
      ProtocolType.SERIAL
    ])
  })

  it('marks roadmap protocols as not implemented', () => {
    expect(getProtocolDescriptor(ProtocolType.SSH)?.implemented).toBe(true)
    expect(getProtocolDescriptor(ProtocolType.SFTP)?.implemented).toBe(true)
    expect(getProtocolDescriptor(ProtocolType.FTP)?.implemented).toBe(false)
    expect(getProtocolDescriptor(ProtocolType.TELNET)?.implemented).toBe(false)
    expect(getProtocolDescriptor(ProtocolType.SERIAL)?.implemented).toBe(false)
  })

  it('uses the standard SSH port', () => {
    expect(getProtocolDescriptor(ProtocolType.SSH)?.defaultPort).toBe(22)
  })
})

describe('BaseAdapter', () => {
  it('transitions through the session state machine', async () => {
    const adapter = new DummyAdapter()
    const states: SessionState[] = []
    adapter.on('state', (state) => states.push(state))

    expect(adapter.state).toBe(SessionState.IDLE)
    await adapter.connect()
    await adapter.disconnect()

    expect(states).toEqual([SessionState.CONNECTED, SessionState.CLOSED])
    expect(adapter.state).toBe(SessionState.CLOSED)
  })

  it('emits data events', () => {
    const adapter = new DummyAdapter()
    const chunks: string[] = []
    adapter.on('data', (chunk) => chunks.push(chunk))

    // The base class exposes the emitter to subclasses; emulate a transport push.
    Reflect.get(adapter, 'emitter').emit('data', 'hello')

    expect(chunks).toEqual(['hello'])
  })
})
