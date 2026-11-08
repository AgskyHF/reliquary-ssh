import { AppShell } from './components/layout/AppShell'
import { TabsWorkspace } from './components/tabs/TabsWorkspace'
import { I18nProvider } from './i18n/I18nProvider'

/**
 * The application root.
 *
 * There is no account and no server: the connections live on the device,
 * and the sync happens through a file the user carries himself. The app
 * therefore opens straight into the terminal.
 */
export default function App() {
  return (
    <I18nProvider>
      <AppShell>
        <TabsWorkspace />
      </AppShell>
    </I18nProvider>
  )
}
