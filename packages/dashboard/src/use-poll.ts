import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Loads data now and every `intervalMs`, so numbers update while the page is open.
 * `reload()` loads again right away, e.g. after a change.
 */
export const usePoll = <A,>(load: () => Promise<A>, deps: ReadonlyArray<unknown>, intervalMs = 5000) => {
  const [state, setState] = useState<{ data?: A; error?: unknown }>({})
  const run = useRef<() => Promise<void>>(async () => {})
  useEffect(() => {
    let cancelled = false
    run.current = () =>
      load().then(
        (data) => void (!cancelled && setState({ data })),
        (error: unknown) => void (!cancelled && setState((s) => ({ ...s, error })))
      )
    void run.current()
    const timer = setInterval(() => void run.current(), intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, deps)
  const reload = useCallback(() => run.current(), [])
  return { ...state, reload }
}
