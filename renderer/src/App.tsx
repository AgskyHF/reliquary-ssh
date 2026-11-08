import { useCallback, useEffect, useState } from 'react'
import { AppShell } from './components/layout/AppShell'
import { TabsWorkspace } from './components/tabs/TabsWorkspace'
import { auth } from './services/auth'
import { I18nProvider } from './i18n/I18nProvider'

/**
 * The application root.
 *
 * The sync features need an account, but the terminal works without one —
 * the sign-in screen is therefore shown in the sidebar, not as a wall
 * that blocks the whole app.
 */
export default function App() {
  const [signedInAs, setSignedInAs] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        const status = await auth.status()
        if (!status.signedIn) {
          setChecked(true)
          return
        }

        const user = await auth.me()
        if (!cancelled) setSignedInAs(user.email)
      } catch {
        // The session is expired or the server is unreachable — the user
        // can sign in again.
        void auth.signOut()
      } finally {
        if (!cancelled) setChecked(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [])

  const signOut = useCallback(() => {
    void auth.signOut()
    setSignedInAs(null)
  }, [])

  return (
    <I18nProvider>
      <AppShell
        signedInAs={checked ? signedInAs : null}
        onSignIn={setSignedInAs}
        onSignOut={signOut}
      >
        <TabsWorkspace />
      </AppShell>
    </I18nProvider>
  )
}
