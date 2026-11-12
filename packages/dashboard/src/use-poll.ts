import { useEffect, useState } from "react"

/** Loads data now and every `intervalMs`, so numbers update while the page is open. */
export const usePoll = <A,>(load: () => Promise<A>, deps: ReadonlyArray<unknown>, intervalMs = 5000) => {
  const [state, setState] = useState<{ data?: A; error?: unknown }>({})
  useEffect(() => {
    let cancelled = false
    const run = () =>
      load().then(
        (data) => !cancelled && setState({ data }),
        (error: unknown) => !cancelled && setState((s) => ({ ...s, error }))
      )
    void run()
    const timer = setInterval(run, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, deps)
  return state
}
