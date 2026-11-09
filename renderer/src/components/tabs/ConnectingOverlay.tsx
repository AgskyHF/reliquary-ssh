/**
 * The animation of a connection that is being opened.
 *
 * While the session is coming up there is nothing to show — the form of
 * a new connection would ask for the data the user has already given.
 * This is what takes its place: the name of the host, a pulsing dot and
 * the steps that go by.
 */
import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n/I18nProvider'

export interface ConnectingOverlayProps {
  /** The name of the host — "user@host". */
  label: string
  /** The protocol of the session: SSH or SFTP. */
  protocol: 'ssh' | 'sftp'
  /** Called when the user cancels the connection. */
  onCancel?: () => void
}

/** The steps of the animation — they cycle while the session comes up. */
const STEPS = ['connect.stepLookup', 'connect.stepHandshake', 'connect.stepAuth'] as const

export function ConnectingOverlay({
  label,
  protocol,
  onCancel
}: ConnectingOverlayProps) {
  const { t } = useI18n()
  const [step, setStep] = useState(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // The steps go by while the session is opening.
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setStep((prev) => (prev + 1) % STEPS.length)
    }, 900)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return (
    <div className="connecting" role="status" aria-live="polite">
      <div className="connecting__card">
        <div className="connecting__spinner" aria-hidden="true">
          <span className="connecting__spinner-dot" />
          <span className="connecting__spinner-dot" />
          <span className="connecting__spinner-dot" />
        </div>

        <div className="connecting__text">
          <div className="connecting__title">{t('connect.connecting')}</div>
          <div className="connecting__label">
            <span className="connecting__protocol">{protocol.toUpperCase()}</span>
            {label}
          </div>
        </div>
      </div>

      <div className="connecting__steps">
        {STEPS.map((key, index) => (
          <div
            key={key}
            className={`connecting__step${index === step ? ' connecting__step--active' : ''}`}
          >
            <span className="connecting__step-mark" aria-hidden="true" />
            {t(key)}
          </div>
        ))}
      </div>

      {/*
        The connection can be taken back — the user may have picked the
        wrong host.
      */}
      {onCancel ? (
        <button type="button" className="button button--ghost connecting__cancel" onClick={onCancel}>
          {t('connect.cancel')}
        </button>
      ) : null}
    </div>
  )
}
