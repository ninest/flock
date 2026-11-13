import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Loads data now and every `intervalMs`, so numbers update while the page is open.
 * `reload()` loads again right away, e.g. after a change.
 * With `keepPolling`, polling stops once it returns false for the latest data, or after an error.
 */
export const usePoll = <A,>(
  load: () => Promise<A>,
  deps: ReadonlyArray<unknown>,
  intervalMs = 5000,
  keepPolling?: (data: A) => boolean
) => {
  const [state, setState] = useState<{ data?: A; error?: unknown }>({})
  const run = useRef<() => Promise<void>>(async () => {})
  // The latest `keepPolling`, so it can read current state without restarting the poll.
  const keep = useRef(keepPolling)
  keep.current = keepPolling
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = (poll: boolean) => {
      clearTimeout(timer)
      if (poll) timer = setTimeout(() => void run.current(), intervalMs)
    }
    run.current = () =>
      load().then(
        (data) => {
          if (cancelled) return
          setState({ data })
          next(keep.current?.(data) ?? true)
        },
        (error: unknown) => {
          if (cancelled) return
          setState((s) => ({ ...s, error }))
          next(keep.current === undefined)
        }
      )
    void run.current()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, deps)
  const reload = useCallback(() => run.current(), [])
  return { ...state, reload }
}
