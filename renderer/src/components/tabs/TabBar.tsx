import type { TabState } from '@shared/types'
import { NEW_TAB_TITLE } from '@shared/tabs-model'
import type { SessionStatus } from '../../hooks/useSession'
import { useI18n } from '../../i18n/I18nProvider'

export interface TabBarProps {
  tabs: TabState[]
  activeId: string | null
  /** Live session state per tab id — drives the status dot. */
  states: Record<string, SessionStatus['state']>
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onCreate: () => void
}

function dotClass(state: SessionStatus['state'] | undefined): string {
  if (state === 'connected') return 'status-dot status-dot--ok'
  if (state === 'error') return 'status-dot status-dot--error'
  return 'status-dot status-dot--idle'
}

/** Row of open tabs with a new-tab button. Purely presentational. */
export function TabBar({ tabs, activeId, states, onSelect, onClose, onCreate }: TabBarProps) {
  const { t } = useI18n()

  /**
   * The title of a fresh tab is stored as the English constant, because the
   * tab layout is saved on disk. The label the user sees is translated here,
   * so switching the language also translates the open tabs.
   */
  const labelOf = (tab: TabState): string =>
    tab.title === NEW_TAB_TITLE ? t('tab.newConnection') : tab.title

  return (
    <div className="tab-bar" role="tablist">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tab"
          aria-selected={tab.id === activeId}
          className={`tab-bar__tab${tab.id === activeId ? ' tab-bar__tab--active' : ''}`}
          data-tab-id={tab.id}
          onClick={() => onSelect(tab.id)}
          title={labelOf(tab)}
        >
          <span className={dotClass(states[tab.id])} />
          <span className="tab-bar__label">{labelOf(tab)}</span>
          <button
            type="button"
            className="tab-bar__close"
            title={t('tab.close')}
            aria-label={t('tab.closeNamed', { name: labelOf(tab) })}
            onClick={(event) => {
              event.stopPropagation()
              onClose(tab.id)
            }}
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        className="tab-bar__new"
        title={t('tab.new')}
        aria-label={t('tab.new')}
        onClick={onCreate}
      >
        +
      </button>
    </div>
  )
}
