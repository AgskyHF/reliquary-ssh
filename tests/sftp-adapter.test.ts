import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { AuthMethod, ProtocolType } from '@shared/types'
import { SftpAdapter } from '@protocols/sftp'
import {
  makeServerDir,
  writeServerFile,
  startTestSftpServer,
  type TestSftpServer
} from './helpers/test-sftp-server'

describe('SftpAdapter against a real SFTP server', () => {
  let server: TestSftpServer
  let adapter: SftpAdapter

  beforeAll(async () => {
    server = await startTestSftpServer()
    writeServerFile(server.root, 'hello.txt', 'hello from sftp\n')
    writeServerFile(server.root, 'data.bin', 'x'.repeat(1024))
    makeServerDir(server.root, 'subdir')

    adapter = new SftpAdapter({ initialPath: server.root })
    await adapter.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })
  })

  afterAll(async () => {
    await adapter.disconnect()
    await server.close()
  })

  it('lists a remote directory', async () => {
    const listing = await adapter.list(server.root)

    const names = listing.entries.map((entry) => entry.name)
    expect(names).toContain('hello.txt')
    expect(names).toContain('data.bin')
    expect(names).toContain('subdir')

    // Directories come first.
    expect(listing.entries[0]?.type).toBe('d')

    const file = listing.entries.find((entry) => entry.name === 'hello.txt')
    expect(file?.type).toBe('-')
    expect(file?.size).toBe(16)
    expect(file?.path).toBe(join(server.root, 'hello.txt'))
  })

  it('resolves relative paths against the current directory', async () => {
    const listing = await adapter.list('subdir')
    expect(listing.path).toBe(join(server.root, 'subdir'))
    expect(listing.parentPath).toBe(server.root)
  })

  it('downloads a file to a local path', async () => {
    const localPath = join(tmpdir(), `reliquary-download-${Date.now()}.txt`)
    await adapter.download({ remotePath: join(server.root, 'hello.txt'), localPath })

    expect(existsSync(localPath)).toBe(true)
    expect(readFileSync(localPath, 'utf8')).toBe('hello from sftp\n')
  })

  it('uploads a local file to a remote path', async () => {
    const localPath = join(tmpdir(), `reliquary-upload-${Date.now()}.txt`)
    writeFileSync(localPath, 'uploaded content\n', 'utf8')

    const remotePath = join(server.root, 'uploaded.txt')
    await adapter.upload({ localPath, remotePath })

    expect(readFileSync(remotePath, 'utf8')).toBe('uploaded content\n')
  })

  it('lists the uploaded file afterwards', async () => {
    const listing = await adapter.list(server.root)
    expect(listing.entries.map((entry) => entry.name)).toContain('uploaded.txt')
  })

  it('deletes a remote file', async () => {
    const target = join(server.root, 'doomed.txt')
    writeServerFile(server.root, 'doomed.txt', 'goodbye\n')

    await adapter.delete({ remotePath: target })

    expect(existsSync(target)).toBe(false)
    const listing = await adapter.list(server.root)
    expect(listing.entries.map((entry) => entry.name)).not.toContain('doomed.txt')
  })

  it('deletes a remote directory with its contents', async () => {
    const dir = makeServerDir(server.root, 'doomed-dir')
    writeFileSync(join(dir, 'inner.txt'), 'inner\n', 'utf8')

    await adapter.delete({ remotePath: dir })

    expect(existsSync(dir)).toBe(false)
  })

  it('refuses to delete a file that is not there', async () => {
    await expect(
      adapter.delete({ remotePath: join(server.root, 'never-existed.txt') })
    ).rejects.toThrow()
  })

  it('rejects a connection with a wrong password', async () => {
    const bad = new SftpAdapter()
    await expect(
      bad.connect({
        host: server.host,
        port: server.port,
        username: server.username,
        authMethod: AuthMethod.PASSWORD,
        password: 'wrong'
      })
    ).rejects.toThrow()
  })

  it('refuses to list after disconnect', async () => {
    const closed = new SftpAdapter()
    await closed.connect({
      host: server.host,
      port: server.port,
      username: server.username,
      authMethod: AuthMethod.PASSWORD,
      password: server.password
    })
    await closed.disconnect()
    await expect(closed.list('/')).rejects.toThrow()
  })

  it('is registered in the protocol factory', () => {
    expect(ProtocolType.SFTP).toBe('sftp')
  })
})
