/**
 * Terminal component based on xterm.js.
 * The component is dumb: it renders output and forwards input.
 * All transport work happens in the main process.
 */
import { useEffect, useRef } from 'react'
import { Terminal, type ITheme } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export interface TerminalViewProps {
  sessionId: string
  /** Called with every keystroke the user types. */
  onInput: (data: string) => void
  /** Called when the terminal is resized, with the new column/row count. */
  onResize?: (cols: number, rows: number) => void
  /** Called when the user clicks or focuses the terminal. */
  onFocus?: () => void
  /** Called once the xterm instance exists — the owner can write into it. */
  onReady?: (terminal: Terminal | null) => void
}

/**
 * xterm needs concrete color values, so the theme tokens are read from the
 * stylesheet at runtime. The component itself hardcodes no colors.
 */
function readThemeTokens(element: HTMLElement): ITheme {
  const styles = getComputedStyle(element)
  const read = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback

  return {
    background: read('--color-bg-main', '#1c2128'),
    foreground: read('--color-text', '#d7dde5'),
    cursor: read('--color-accent', '#388bfd'),
    selectionBackground: read('--color-accent-muted', '#388bfd40')
  }
}

export function TerminalView({
  sessionId,
  onInput,
  onResize,
  onFocus,
  onReady
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef(onInput)
  const resizeRef = useRef(onResize)
  const readyRef = useRef(onReady)

  // Callbacks are kept in refs, but they may only be written from an effect.
  useEffect(() => {
    inputRef.current = onInput
    resizeRef.current = onResize
    readyRef.current = onReady
  }, [onInput, onResize, onReady])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const terminal = new Terminal({
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      cursorBlink: true,
      allowProposedApi: true,
      theme: readThemeTokens(container)
    })

    const fit = new FitAddon()
    terminal.loadAddon(fit)

    terminal.open(container)
    fit.fit()

    const dataDisposable = terminal.onData((data) => inputRef.current(data))
    const resizeObserver = new ResizeObserver(() => {
      try {
        fit.fit()
        resizeRef.current?.(terminal.cols, terminal.rows)
      } catch {
        // The terminal can be detached mid-resize; ignoring is safe here.
      }
    })
    resizeObserver.observe(container)

    readyRef.current?.(terminal)

    return () => {
      resizeObserver.disconnect()
      dataDisposable.dispose()
      terminal.dispose()
      readyRef.current?.(null)
    }
  }, [sessionId])

  return (
    <div
      className="terminal-view"
      ref={containerRef}
      onClick={() => {
        onFocus?.()
        containerRef.current?.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus()
      }}
    />
  )
}
