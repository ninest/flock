// Small pieces every page shares: dropdown menus, grid rows, the detail pane, status dots, and
// running an action with its error shown.
import type { Member, SessionStatus } from "@flock/shared"
import { createContext, type CSSProperties, type ReactNode, useContext, useEffect, useRef, useState } from "react"

/** The signed-in Member, provided by the route that requires sign-in. */
export const MemberContext = createContext<Member | undefined>(undefined)
export const useMember = () => useContext(MemberContext)

const PHONE = "(max-width: 760px)"

/** True on a phone-sized screen, where some controls change shape. */
export const useIsPhone = () => {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE).matches)
  useEffect(() => {
    const query = window.matchMedia(PHONE)
    const update = () => setPhone(query.matches)
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return phone
}

/** Re-renders every `ms`, for "last seen N min ago" and similar. */
export const useNow = (ms = 15_000) => {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(timer)
  }, [ms])
  return now
}

export const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
    <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/**
 * A button that opens a menu below it. The menu closes on Escape, on a click outside, and after
 * choosing one of its items (any element with `role="menuitem"`).
 */
export const Dropdown = ({ label, children, buttonClass = "dropdown-button", chevron = true, end = false, ariaLabel, testId }: {
  label: ReactNode
  children: ReactNode
  buttonClass?: string
  chevron?: boolean
  /** Align the menu with the button's right edge. */
  end?: boolean
  ariaLabel?: string
  testId?: string
}) => {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener("pointerdown", close)
    window.addEventListener("keydown", close)
    return () => {
      window.removeEventListener("pointerdown", close)
      window.removeEventListener("keydown", close)
    }
  }, [open])
  return (
    <div className="dropdown" ref={ref}>
      <button
        type="button"
        className={buttonClass}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-testid={testId}
        onClick={() => setOpen(!open)}
      >
        {label}
        {chevron && <Chevron />}
      </button>
      {open && (
        <div
          className={end ? "menu menu-end" : "menu"}
          role="menu"
          onClick={(e) => {
            if ((e.target as HTMLElement).closest("[role=menuitem]")) setOpen(false)
          }}
        >
          {children}
        </div>
      )}
    </div>
  )
}

/** One column of a Rows table. The first column takes the spare width; the rest are `width` pixels. */
export interface Column {
  readonly label: ReactNode
  readonly width?: number
  /** Its width on a phone, when narrower than `width`. */
  readonly phoneWidth?: number
  /** Dropped on a phone, where tables keep three columns. */
  readonly wide?: boolean
}

const template = (columns: ReadonlyArray<Column>, phone = false) =>
  ["minmax(0, 1fr)", ...columns.slice(1).map((c) => `${(phone ? c.phoneWidth : undefined) ?? c.width ?? 88}px`)].join(" ")

/** Marks a cell that is dropped on a phone; spread it on the cell of a `wide` column. */
export const wide = { "data-wide": true } as const

/**
 * A table built from grid rows (see `.row` in console.css). Render each row as an element with
 * class `row` holding one child per column, and spread `wide` on the cells of wide columns.
 * `variant`: `bars` for breakdowns (a share bar behind each row), `select` for a list whose rows
 * open a detail pane.
 */
export const Rows = ({ columns, title, variant, children, testId }: {
  columns: ReadonlyArray<Column>
  /** Replaces the first column's label with a heading. */
  title?: ReactNode
  variant?: "bars" | "select" | "end"
  children: ReactNode
  testId?: string
}) => {
  const style = {
    "--cols": template(columns),
    "--cols-phone": template(columns.filter((c) => !c.wide), true)
  } as CSSProperties
  return (
    <div className={variant ? `rows rows-${variant}` : "rows"} style={style} data-testid={testId} role="table">
      <div className="row row-head" role="row">
        {columns.map((c, i) => (
          <span key={i} role="columnheader" className={i === 0 && title ? "rows-title" : undefined} {...(c.wide ? wide : {})}>
            {i === 0 && title ? title : c.label}
          </span>
        ))}
      </div>
      {children}
    </div>
  )
}

/** The CSS custom property that sizes a breakdown row's bar. */
export const barStyle = (width: string) => ({ "--bar": width }) as CSSProperties

const STATUS_LABEL: Record<SessionStatus, string> = { active: "Active", idle: "Idle", ended: "Ended" }

/** Green while a Session is active, amber while idle, grey once ended. */
export const StatusDot = ({ status }: { status: SessionStatus }) => (
  <i className="status" data-status={status} title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]} role="img" />
)

/** The right-hand pane of a split page. On a phone it is hidden until `open`, then covers the screen with a Back button. */
export const Detail = ({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) => (
  <section className="detail" data-open={open}>
    <button type="button" className="back" onClick={onClose}>← Back</button>
    {children}
  </section>
)

/** A one-line message in place of content: loading, empty or failed. */
export const Notice = ({ children, alert = false }: { children: ReactNode; alert?: boolean }) => (
  <p className={alert ? "notice alert" : "notice"} role={alert ? "alert" : undefined}>{children}</p>
)

/** What a report shows before its data: an error, "Loading…", or nothing. */
export const pending = (error: unknown, what: string) =>
  error ? <Notice alert>Could not load {what}.</Notice> : <Notice>Loading…</Notice>

/** Runs an action, showing its error to the Member. `run` resolves to whether it succeeded. */
export const useAction = () => {
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  const alert = error ? <p role="alert" className="alert">{error}</p> : null
  return { run, busy, alert }
}
