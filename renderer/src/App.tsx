import { useEffect } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TabsWorkspace } from './components/tabs/TabsWorkspace'
import { I18nProvider } from './i18n/I18nProvider'
import { api } from './services/api'

/**
 * The application root.
 *
 * There is no account and no server: the connections live on the device,
 * and the sync happens through a file the user carries himself. The app
 * therefore opens straight into the terminal.
 */
export default function App() {
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
      <AppShell>
        <TabsWorkspace />
      </AppShell>
    </I18nProvider>
  )
}
