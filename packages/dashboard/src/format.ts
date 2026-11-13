// How numbers, durations and shares read across the dashboard.

const whole = (seconds: number) => Math.max(0, Math.round(seconds))

/** A count, grouped for the reader's locale: `12,480`. */
export const formatCount = (value: number) => value.toLocaleString()

/** A number that may have decimals, such as an average: `12.35`. */
export const formatNumber = (value: number | null | undefined) =>
  value === null || value === undefined ? "–" : value.toLocaleString(undefined, { maximumFractionDigits: 2 })

/** `42s`, `3m 5s` or `1h 2m`. */
export const formatDuration = (seconds: number) => {
  const s = whole(seconds)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

/** A time offset in a Session timeline: `0:42`, `4:02` or `1:05:09`. */
export const formatClock = (seconds: number) => {
  const s = whole(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`
}

/** A share from 0 to 1 as a whole percent: `44%`. */
export const formatPercent = (share: number) => `${Math.round(share * 100)}%`

/** The CSS width of a breakdown row's bar: its count against the largest row's, never quite empty. */
export const barWidth = (count: number, max: number) => `${max > 0 ? Math.max(1, Math.round((count / max) * 100)) : 1}%`

const countryNames = (() => {
  try {
    return new Intl.DisplayNames(undefined, { type: "region" })
  } catch {
    return undefined
  }
})()

/** `DE` as `Germany`, or the code itself when the browser doesn't know it. */
export const countryName = (code: string) => {
  try {
    return countryNames?.of(code) ?? code
  } catch {
    return code
  }
}

/** `mobile` as `Mobile`. */
export const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
