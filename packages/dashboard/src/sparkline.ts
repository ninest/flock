// The geometry of a sparkline: a small line chart with no axes, labels or Annotations.

/** Keeps the line's stroke inside the box. */
const INSET = 1

/**
 * An SVG polyline's `points` for `values` in a `width` × `height` box, oldest first, left to right.
 * The highest value touches the top and zero sits on the bottom; all zeros lie flat on the bottom.
 */
export const sparklinePoints = (values: ReadonlyArray<number>, width: number, height: number): string => {
  if (values.length === 0) return ""
  const series = values.length === 1 ? [values[0]!, values[0]!] : values
  const max = Math.max(...series)
  const x = (i: number) => INSET + (i * (width - 2 * INSET)) / (series.length - 1)
  const y = (v: number) => height - INSET - (max > 0 ? (v / max) * (height - 2 * INSET) : 0)
  const round = (n: number) => Math.round(n * 10) / 10
  return series.map((v, i) => `${round(x(i))},${round(y(v))}`).join(" ")
}
