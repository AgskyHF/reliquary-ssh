import type { TabState } from '@shared/types'
import type { SessionStatus } from '../../hooks/useSession'

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
          title={tab.title}
        >
          <span className={dotClass(states[tab.id])} />
          <span className="tab-bar__label">{tab.title}</span>
          <button
            type="button"
            className="tab-bar__close"
            title="Close tab"
            aria-label={`Close ${tab.title}`}
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
        title="New tab"
        aria-label="New tab"
        onClick={onCreate}
      >
        +
      </button>
    </div>
  )
}
