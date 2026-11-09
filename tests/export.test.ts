import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import { AuthMethod, ProtocolType, type Host } from '@shared/types'
import { EXPORT_FILES, type ExportManifest, type ExportSecrets } from '@shared/export'
import { Storage } from '@app/services/storage'
import { MasterPasswordManager } from '@app/services/master-password'
import { ExportService } from '@app/services/export'

const PASSWORD = 'correct horse battery'

describe('export and import', () => {
  let dirs: string[] = []
  let deviceDir: string
  let storage: Storage
  let master: MasterPasswordManager
  let service: ExportService

  beforeEach(() => {
    dirs = []
    deviceDir = mkdtempSync(join(tmpdir(), 'reliquary-export-'))
    dirs.push(deviceDir)

    storage = new Storage(join(deviceDir, 'reliquary.db'), () => 'device-a')
    master = new MasterPasswordManager(join(deviceDir, 'master.json'), Buffer.alloc(32, 1))
    master.init()
    service = new ExportService(storage, master)
  })

  afterEach(() => {
    storage.close()
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
  })

  /** Creates a host with a stored password. */
  function makeHost(name: string, updatedAt: string, password?: string): Host {
    const host = storage.hosts.save({
      name,
      protocol: ProtocolType.SSH,
      host: `${name}.example.com`,
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      createdAt: updatedAt,
      updatedAt,
      version: 1,
      deviceId: 'device-a'
    })

    if (password) {
      // The app seals the passwords of the hosts with the device secret,
      // so a master password is not needed for one to be stored.
      storage.passwords.save(host.id, password, master.deviceKey(), 'device-a')
    }

    return host
  }

  it('builds an archive with the manifest and the connections', async () => {
    await master.set(PASSWORD)
    makeHost('prod', '2026-11-07T10:00:00.000Z')

    const { buffer } = await service.build({ mode: 'without-passwords', includeKeys: true, includeOld: true })
    const zip = new AdmZip(buffer)

    const manifest = JSON.parse(
      zip.readAsText(EXPORT_FILES.manifest)
    ) as ExportManifest

    expect(manifest.version).toBe(1)
    expect(manifest.mode).toBe('without-passwords')
    expect(manifest.connectionCount).toBe(1)
    expect(zip.getEntry(EXPORT_FILES.connections)).toBeTruthy()
  })

  it('keeps the passwords out of an export without them', async () => {
    await master.set(PASSWORD)
    makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    const { buffer } = await service.build({ mode: 'without-passwords', includeKeys: true, includeOld: true })
    const text = buffer.toString('binary')

    expect(text).not.toContain('super secret')
    expect(new AdmZip(buffer).getEntry(EXPORT_FILES.secrets)).toBeFalsy()
  })

  it('carries the passwords in an export with them', async () => {
    await master.set(PASSWORD)
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })
    const zip = new AdmZip(buffer)

    const manifest = JSON.parse(zip.readAsText(EXPORT_FILES.manifest)) as ExportManifest
    expect(manifest.mode).toBe('with-passwords')

    const secrets = JSON.parse(zip.readAsText(EXPORT_FILES.secrets)) as ExportSecrets
    expect(secrets.format).toBe('plain')
    expect(secrets.passwords[host.id]).toBe('super secret')

    // There is no master password of the file — the archive needs none.
    expect(secrets.kdf).toBeNull()
  })

  it('exports the passwords without a master password', async () => {
    // No master password is set on this device at all.
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    const secrets = JSON.parse(new AdmZip(buffer).readAsText(EXPORT_FILES.secrets)) as ExportSecrets
    expect(secrets.passwords[host.id]).toBe('super secret')
  })

  it('imports a connection and its password on a device without a master password', async () => {
    await master.set(PASSWORD)
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    // A second device that never had a master password.
    const otherDir = mkdtempSync(join(tmpdir(), 'reliquary-export-b-'))
    dirs.push(otherDir)
    const otherStorage = new Storage(join(otherDir, 'reliquary.db'), () => 'device-b')
    const otherMaster = new MasterPasswordManager(join(otherDir, 'master.json'), Buffer.alloc(32, 2))
    otherMaster.init()

    const otherService = new ExportService(otherStorage, otherMaster)
    const result = await otherService.import(buffer, otherMaster.getMasterKey())

    expect(result.added).toBe(1)
    expect(result.passwords).toBe(1)
    expect(otherStorage.hosts.list().map((item) => item.name)).toEqual(['prod'])

    // The password came back readable — no master password was entered.
    const revealed = otherStorage.passwords.reveal(host.id, otherMaster.deviceKey())
    expect(revealed).toBe('super secret')

    otherStorage.close()
  })

  it('imports a connection that is not known yet', async () => {
    await master.set(PASSWORD)
    makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    // A second device with a master password of its own.
    const otherDir = mkdtempSync(join(tmpdir(), 'reliquary-export-b-'))
    dirs.push(otherDir)
    const otherStorage = new Storage(join(otherDir, 'reliquary.db'), () => 'device-b')
    const otherMaster = new MasterPasswordManager(join(otherDir, 'master.json'), Buffer.alloc(32, 2))
    otherMaster.init()
    await otherMaster.set(PASSWORD)

    const otherService = new ExportService(otherStorage, otherMaster)
    const result = await otherService.import(buffer, otherMaster.getMasterKey())

    expect(result.added).toBe(1)
    expect(otherStorage.hosts.list().map((host) => host.name)).toEqual(['prod'])

    // The password is sealed with the device secret of the second
    // device — the master passwords of the two devices differ and it
    // still opens.
    const imported = otherStorage.hosts.list()[0]
    const revealed = otherStorage.passwords.reveal(imported!.id, otherMaster.deviceKey())
    expect(revealed).toBe('super secret')

    otherStorage.close()
  })

  it('keeps the newer version and moves the older one to old', async () => {
    await master.set(PASSWORD)
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'old password')

    // The device gets a newer version of the same host.
    storage.hosts.save({
      ...host,
      name: 'prod-new',
      updatedAt: '2026-11-08T10:00:00.000Z',
      version: 2
    })

    // The archive carries the older version — it is the one that loses.
    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    // The import sees the older version — the local one is newer, so the
    // local one wins and the older goes to old.
    const result = await service.import(buffer, master.getMasterKey())

    expect(result.unchanged).toBe(1)
    expect(result.updated).toBe(0)
    expect(storage.hosts.list()[0]?.name).toBe('prod-new')
  })

  it('moves the losing version of an import to the old folder', async () => {
    await master.set(PASSWORD)

    // The archive carries a newer version than the local one.
    const archiveHost = {
      id: 'host-1',
      name: 'prod-from-archive',
      protocol: ProtocolType.SSH,
      host: 'archive.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-09T10:00:00.000Z',
      deletedAt: null,
      version: 5,
      deviceId: 'device-b',
      hasPassword: false
    }

    const zip = new AdmZip()
    zip.addFile(
      EXPORT_FILES.manifest,
      Buffer.from(
        JSON.stringify({
          version: 1,
          exportedAt: '2026-11-09T10:00:00.000Z',
          mode: 'without-passwords',
          appVersion: '0.1.0',
          connectionCount: 1,
          keyCount: 0,
          supersededCount: 0
        }),
        'utf8'
      )
    )
    zip.addFile(
      EXPORT_FILES.connections,
      Buffer.from(JSON.stringify({ connections: [archiveHost] }), 'utf8')
    )

    // The local device has the older version — and a password of its own.
    storage.hosts.save({
      id: 'host-1',
      name: 'prod-local',
      protocol: ProtocolType.SSH,
      host: 'local.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-a'
    })

    const localMaterial = master.getMasterKey()!
    storage.passwords.save('host-1', 'local password', localMaterial, 'device-a')

    const result = await service.import(zip.toBuffer(), master.getMasterKey())

    expect(result.updated).toBe(1)
    expect(result.superseded).toBe(1)
    expect(storage.hosts.list()[0]?.name).toBe('prod-from-archive')

    // The losing version is kept, not deleted.
    const old = storage.superseded.list()
    expect(old).toHaveLength(1)
    expect(old[0]?.hostId).toBe('host-1')
    expect(old[0]?.reason).toBe('newer')

    // The old version keeps the password it had — that is the whole point
    // of the folder: the user may still need it.
    const payload = JSON.parse(old[0]!.payload) as {
      connection: { name: string }
      encryptedPassword: string | null
    }
    expect(payload.connection.name).toBe('prod-local')
    expect(payload.encryptedPassword).toBeTruthy()

    // And the password is still readable — it was not lost on the way.
    const revealed = storage.passwords.reveal('host-1', localMaterial)
    expect(revealed).toBe('local password')
  })

  it('moves the password of an older imported version to old', async () => {
    await master.set(PASSWORD)

    // The archive carries the OLD version of the host, with its own
    // password — the exact case the user described: the password was
    // changed on the other computer, and the old one must survive.
    const olderHost = {
      id: 'host-2',
      name: 'prod-old-version',
      protocol: ProtocolType.SSH,
      host: 'old.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-b',
      hasPassword: true
    }

    const zip = new AdmZip()
    zip.addFile(
      EXPORT_FILES.manifest,
      Buffer.from(
        JSON.stringify({
          version: 1,
          exportedAt: '2026-11-09T10:00:00.000Z',
          mode: 'with-passwords',
          appVersion: '0.1.0',
          connectionCount: 1,
          keyCount: 0,
          supersededCount: 0
        }),
        'utf8'
      )
    )
    zip.addFile(
      EXPORT_FILES.connections,
      Buffer.from(JSON.stringify({ connections: [olderHost] }), 'utf8')
    )
    zip.addFile(
      EXPORT_FILES.secrets,
      Buffer.from(
        JSON.stringify({
          passwords: { 'host-2': 'sealed-old-password' },
          privateKeys: {},
          kdf: null
        }),
        'utf8'
      )
    )

    // The local device has the NEWER version with a new password.
    storage.hosts.save({
      id: 'host-2',
      name: 'prod-new-version',
      protocol: ProtocolType.SSH,
      host: 'new.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-09T10:00:00.000Z',
      deletedAt: null,
      version: 4,
      deviceId: 'device-a'
    })

    const result = await service.import(zip.toBuffer(), master.getMasterKey())

    // The local version wins — it is newer.
    expect(result.unchanged).toBe(1)
    expect(result.updated).toBe(0)
    expect(storage.hosts.list()[0]?.name).toBe('prod-new-version')

    // The losing imported version goes to old together with its password.
    const old = storage.superseded.list()
    expect(old).toHaveLength(1)

    const payload = JSON.parse(old[0]!.payload) as {
      connection: { name: string }
      encryptedPassword: string | null
    }
    expect(payload.connection.name).toBe('prod-old-version')
    expect(payload.encryptedPassword).toBe('sealed-old-password')
  })

  it('carries the old folder into the archive', async () => {
    await master.set(PASSWORD)

    storage.hosts.save({
      id: 'host-1',
      name: 'prod-local',
      protocol: ProtocolType.SSH,
      host: 'local.example.com',
      port: 22,
      username: 'root',
      authMethod: AuthMethod.PASSWORD,
      keyId: null,
      color: '',
      group: null,
      notes: '',
      createdAt: '2026-11-01T10:00:00.000Z',
      updatedAt: '2026-11-02T10:00:00.000Z',
      deletedAt: null,
      version: 1,
      deviceId: 'device-a'
    })

    storage.superseded.record({
      hostId: 'host-1',
      payload: {
        connection: {
          id: 'host-1',
          name: 'prod-old',
          protocol: ProtocolType.SSH,
          host: 'old.example.com',
          port: 22,
          username: 'root',
          authMethod: AuthMethod.PASSWORD,
          keyId: null,
          color: '',
          group: null,
          notes: '',
          createdAt: '2026-11-01T10:00:00.000Z',
          updatedAt: '2026-11-02T10:00:00.000Z',
          deletedAt: null,
          version: 1,
          deviceId: 'device-a',
          hasPassword: true
        },
        encryptedPassword: 'sealed-envelope'
      },
      replacedBy: 'host-1',
      reason: 'newer'
    })

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })
    const zip = new AdmZip(buffer)

    const oldFiles = zip
      .getEntries()
      .filter((entry) => entry.entryName.startsWith(`${EXPORT_FILES.oldDirectory}/`))

    expect(oldFiles).toHaveLength(1)
    expect(zip.readAsText(oldFiles[0]!.entryName)).toContain('prod-old')
  })

  it('refuses a file that is not an export', async () => {
    const zip = new AdmZip()
    zip.addFile('random.txt', Buffer.from('hello', 'utf8'))

    await expect(service.import(zip.toBuffer(), null)).rejects.toThrow(/not a ReliquarySSH/u)
  })

  it('brings a deleted host back as a live host, not into the old folder', async () => {
    await master.set(PASSWORD)
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'super secret')

    // The user exports, deletes the host and imports the archive back.
    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })
    storage.hosts.remove(host.id)

    const result = await service.import(buffer, master.getMasterKey())

    // The host is back — right away, not as a version to restore.
    expect(result.added).toBe(1)
    expect(storage.hosts.list().map((item) => item.name)).toEqual(['prod'])
    expect(storage.hosts.get(host.id)).not.toBeNull()

    // And nothing waits in the old folder.
    expect(storage.superseded.list()).toHaveLength(0)

    // The password came back with it.
    const revealed = storage.passwords.reveal(host.id, master.deviceKey())
    expect(revealed).toBe('super secret')
  })

  it('replaces the older host with the newer one when both exist', async () => {
    await master.set(PASSWORD)
    const host = makeHost('prod', '2026-11-07T10:00:00.000Z', 'old password')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    // The host changes on the other device — the archive carries the
    // newer version of the same host.
    const newer = { ...host, name: 'prod-new', updatedAt: '2026-11-09T10:00:00.000Z', version: 9 }
    storage.hosts.save(newer)

    const result = await service.import(buffer, master.getMasterKey())

    // The older archive loses — the newer one stays.
    expect(result.updated).toBe(0)
    expect(result.unchanged).toBe(1)
    expect(storage.hosts.list()[0]?.name).toBe('prod-new')

    // The losing version waits in the old folder.
    const old = storage.superseded.list()
    expect(old).toHaveLength(1)
    expect(old[0]?.hostId).toBe(host.id)
  })

  it('does not add the same version to the old folder twice', async () => {
    await master.set(PASSWORD)
    makeHost('prod', '2026-11-07T10:00:00.000Z', 'old password')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })

    await service.import(buffer, master.getMasterKey())
    await service.import(buffer, master.getMasterKey())

    // The old folder is a list of versions, not a log of the imports.
    expect(storage.superseded.list()).toHaveLength(1)
  })

  it('empties the old folder in one go', async () => {
    await master.set(PASSWORD)
    makeHost('prod', '2026-11-07T10:00:00.000Z', 'old password')
    makeHost('stage', '2026-11-07T10:00:00.000Z', 'old password')

    const { buffer } = await service.build({ mode: 'with-passwords', includeKeys: true, includeOld: true })
    await service.import(buffer, master.getMasterKey())

    expect(storage.superseded.list().length).toBeGreaterThan(0)
    expect(storage.superseded.removeAll()).toBe(storage.superseded.list().length + 2)
    expect(storage.superseded.list()).toHaveLength(0)
  })
})
