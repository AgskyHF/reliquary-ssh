import { useEffect, useState } from 'react'
import { TabKind } from '@shared/types'
import { AppShell } from './components/layout/AppShell'
import { TabsWorkspace } from './components/tabs/TabsWorkspace'
import { I18nProvider } from './i18n/I18nProvider'
import { ThemeProvider } from './theme/ThemeProvider'
import { api } from './services/api'

/**
 * The application root.
 *
 * There is no account and no server: the connections live on the device,
 * and the sync happens through a file the user carries himself. The app
 * therefore opens straight into the terminal.
 */
/** A host the user picked in the sidebar. */
export interface PendingHost {
  id: string
  host: string
  port: number
  username: string
  protocol: TabKind
}

export default function App() {
  // The host the sidebar picked — the workspace opens a tab for it.
  const [pendingHost, setPendingHost] = useState<PendingHost | null>(null)

  // The traffic lights of macOS are drawn over the top-left corner of the
  // window. The platform goes into the document, so the header can keep
  // clear of them.
  useEffect(() => {
    void api
      .appInfo()
      .then((info) => {
        document.documentElement.dataset.platform = info.platform
      })
      .catch(() => undefined)
  }, [])

  return (
    <I18nProvider>
      <ThemeProvider>
        <AppShell onOpenHost={(host, protocol) => setPendingHost({ ...host, protocol })}>
          <TabsWorkspace pendingHost={pendingHost} onHostOpened={() => setPendingHost(null)} />
        </AppShell>
      </ThemeProvider>
    </I18nProvider>
  )
}
