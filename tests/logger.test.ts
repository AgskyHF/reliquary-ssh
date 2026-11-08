import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Logger } from '@app/services/logger'

describe('app logger', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'reliquary-log-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('writes a line per message', () => {
    const path = join(dir, 'reliquary.log')
    const log = new Logger({ filePath: path, consoleMirror: false })

    log.info('the app is starting')
    log.warn('something odd')

    const content = readFileSync(path, 'utf8')
    expect(content).toContain('INFO')
    expect(content).toContain('the app is starting')
    expect(content).toContain('WARN')
    expect(content).toContain('something odd')
  })

  it('skips the levels below the threshold', () => {
    const path = join(dir, 'reliquary.log')
    const log = new Logger({ filePath: path, level: 'warn', consoleMirror: false })

    log.debug('noise')
    log.info('also noise')
    log.error('the real problem')

    const content = readFileSync(path, 'utf8')
    expect(content).not.toContain('noise')
    expect(content).toContain('the real problem')
  })

  it('writes nothing without a file', () => {
    const log = new Logger({ consoleMirror: false })
    expect(() => log.info('nowhere')).not.toThrow()
  })

  it('never throws on a broken path', () => {
    const log = new Logger({ filePath: '/proc/nonexistent/x.log', consoleMirror: false })
    expect(() => log.error('still fine')).not.toThrow()
  })
})
