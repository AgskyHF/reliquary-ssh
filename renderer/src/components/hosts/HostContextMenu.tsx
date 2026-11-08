/**
 * The context menu of a host.
 *
 * The menu opens on the right button — the left button connects to the
 * host right away. It looks like the menu of Termius: the commands on the
 * left, the submenu of the protocol on the right.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ProtocolType, type Host } from '@shared/types'
import { useI18n } from '../../i18n/I18nProvider'

export interface HostContextMenuProps {
  /** The host the menu belongs to. */
  host: Host
  /** The point the menu opens at, in client coordinates. */
  x: number
  y: number
  /** Called when the user picks a command. */
  onClose: () => void
  /** Connects to the host over the given protocol. */
  onConnect: (host: Host, protocol: ProtocolType) => void
  /** Opens the form with the host. */
  onEdit: (host: Host) => void
  /** Removes the host. */
  onDelete: (host: Host) => void
  /** Makes a copy of the host. */
  onDuplicate: (host: Host) => void
}

/** The commands of the menu, in the order they are shown. */
type Command = 'connect' | 'edit' | 'delete' | 'duplicate'

export function HostContextMenu({
  host,
  x,
  y,
  onClose,
  onConnect,
  onEdit,
  onDelete,
  onDuplicate
}: HostContextMenuProps) {
  const { t } = useI18n()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  // The submenu of the connection is open while the pointer is on it.
  const [submenuOpen, setSubmenuOpen] = useState(false)

  // The menu must stay inside the window.
  useLayoutEffect(() => {
    const element = rootRef.current
    if (!element) return

    const box = element.getBoundingClientRect()
    const margin = 8
    let left = x
    let top = y

    if (left + box.width + margin > window.innerWidth) {
      left = Math.max(margin, window.innerWidth - box.width - margin)
    }
    if (top + box.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - box.height - margin)
    }

    setPosition({ left, top })
  }, [x, y])

  // A click outside of the menu takes it away.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) onClose()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }

    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const run = useCallback(
    (command: Command) => {
      onClose()
      switch (command) {
        case 'edit':
          onEdit(host)
          break
        case 'delete':
          onDelete(host)
          break
        case 'duplicate':
          onDuplicate(host)
          break
        default:
          break
      }
    },
    [host, onClose, onDelete, onDuplicate, onEdit]
  )

  return (
    <div
      className="host-menu"
      ref={rootRef}
      style={{ left: position.left, top: position.top }}
      role="menu"
    >
      <div className="host-menu__column">
        <button
          type="button"
          className="host-menu__item host-menu__item--submenu"
          role="menuitem"
          onMouseEnter={() => setSubmenuOpen(true)}
          onClick={() => setSubmenuOpen(true)}
        >
          <span className="host-menu__icon host-menu__icon--connect" aria-hidden="true" />
          <span className="host-menu__label">{t('hosts.connect')}</span>
          <span className="host-menu__chevron" aria-hidden="true">
            ›
          </span>
        </button>

        <button
          type="button"
          className="host-menu__item"
          role="menuitem"
          onClick={() => run('edit')}
        >
          <span className="host-menu__icon host-menu__icon--edit" aria-hidden="true" />
          <span className="host-menu__label">{t('hosts.edit')}</span>
        </button>

        <button
          type="button"
          className="host-menu__item"
          role="menuitem"
          onClick={() => run('duplicate')}
        >
          <span className="host-menu__icon host-menu__icon--copy" aria-hidden="true" />
          <span className="host-menu__label">{t('hosts.duplicate')}</span>
        </button>

        <button
          type="button"
          className="host-menu__item host-menu__item--danger"
          role="menuitem"
          onClick={() => run('delete')}
        >
          <span className="host-menu__icon host-menu__icon--delete" aria-hidden="true" />
          <span className="host-menu__label">{t('hosts.delete')}</span>
        </button>
      </div>

      {submenuOpen ? (
        <div className="host-menu__column host-menu__column--submenu">
          <button
            type="button"
            className="host-menu__item"
            role="menuitem"
            onClick={() => {
              onClose()
              onConnect(host, ProtocolType.SSH)
            }}
          >
            <span className="host-menu__label">{t('hosts.connectSsh')}</span>
          </button>
          <button
            type="button"
            className="host-menu__item"
            role="menuitem"
            onClick={() => {
              onClose()
              onConnect(host, ProtocolType.SFTP)
            }}
          >
            <span className="host-menu__label">{t('hosts.connectSftp')}</span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
