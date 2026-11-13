// One series over time as an orange line with a faint area, a hairline grid, and a crosshair with
// a tooltip on hover or touch. Drawn as SVG so it can follow the Console look exactly.
import { type PointerEvent, useEffect, useRef, useState } from "react"
import { labelStep, niceMax } from "./chart-scale.ts"

const COLOR = "var(--accent)"
const TOP = 24
const BOTTOM_AXIS = 28

const useWidth = () => {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current!
    const observer = new ResizeObserver(() => setWidth(el.clientWidth))
    observer.observe(el)
    setWidth(el.clientWidth)
    return () => observer.disconnect()
  }, [])
  return [ref, width] as const
}

/** A smooth path through the points. Control points share their ends' heights, so it never overshoots. */
const smooth = (points: ReadonlyArray<readonly [number, number]>) =>
  points.map(([x, y], i) => {
    if (i === 0) return `M${x},${y}`
    const [px, py] = points[i - 1]!
    const mid = (px + x) / 2
    return `C${mid},${py} ${mid},${y} ${x},${y}`
  }).join(" ")

/** Runs of consecutive non-null values, so a missing value leaves a gap instead of a drop to zero. */
const runs = (values: ReadonlyArray<number | null>) => {
  const result: Array<Array<number>> = []
  let current: Array<number> = []
  values.forEach((v, i) => {
    if (v === null) {
      if (current.length) result.push(current)
      current = []
    } else current.push(i)
  })
  if (current.length) result.push(current)
  return result
}

export const TrendChart = ({ name, labels, values, format, height = 300 }: {
  /** What the values are, e.g. "Unique Visitors". */
  name: string
  labels: ReadonlyArray<string>
  values: ReadonlyArray<number | null>
  format: (value: number) => string
  height?: number
}) => {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState<number | null>(null)
  const n = values.length
  const max = niceMax(Math.max(0, ...values.map((v) => v ?? 0)))
  const padX = width < 500 ? 16 : 28
  const bottom = height - BOTTOM_AXIS
  const x = (i: number) => (n <= 1 ? width / 2 : padX + (i * (width - 2 * padX)) / (n - 1))
  const y = (v: number) => bottom - (v / max) * (bottom - TOP)
  const step = labelStep(n, width - 2 * padX)

  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (n === 0 || width === 0) return
    const left = e.clientX - e.currentTarget.getBoundingClientRect().left
    const i = n <= 1 ? 0 : Math.round(((left - padX) / (width - 2 * padX)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  const hovered = hover === null ? undefined : values[hover]

  return (
    <div ref={ref} className="trend" style={{ height }} onPointerMove={move} onPointerDown={move} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={`${name} over time`}>
          {[0.5, 1].map((f) => (
            <g key={f}>
              <line x1={0} x2={width} y1={y(max * f)} y2={y(max * f)} stroke="var(--line)" />
              <text x={width} y={y(max * f) - 6} textAnchor="end">{format(max * f)}</text>
            </g>
          ))}
          <line x1={0} x2={width} y1={bottom} y2={bottom} stroke="var(--line)" />
          {runs(values).map((run) => {
            const points = run.map((i) => [x(i), y(values[i]!)] as const)
            const line = smooth(points)
            return (
              <g key={run[0]}>
                {points.length > 1 && <path d={`${line} L${x(run.at(-1)!)},${bottom} L${x(run[0]!)},${bottom} Z`} fill={COLOR} opacity={0.08} />}
                {points.length > 1
                  ? <path d={line} fill="none" stroke={COLOR} strokeWidth={2} strokeLinecap="round" />
                  : <circle cx={points[0]![0]} cy={points[0]![1]} r={3} fill={COLOR} />}
              </g>
            )
          })}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={TOP - 8} y2={bottom} stroke="var(--muted)" />
              {hovered !== null && hovered !== undefined && (
                <circle cx={x(hover)} cy={y(hovered)} r={4.5} fill={COLOR} stroke="var(--bg)" strokeWidth={2} />
              )}
            </g>
          )}
          {labels.map((label, i) =>
            i % step === 0
              ? (
                <text key={i} x={x(i)} y={height - 6} textAnchor={n > 1 && i === 0 ? "start" : "middle"} style={hover === i ? { fill: "var(--ink)" } : undefined}>
                  {label}
                </text>
              )
              : null
          )}
        </svg>
      )}
      {hover !== null && (
        <div className="trend-tip" style={x(hover) > width - 180 ? { right: width - x(hover) + 12 } : { left: x(hover) + 12 }}>
          <span>{labels[hover]}</span>
          <strong>{hovered === null || hovered === undefined ? "–" : format(hovered)}</strong>
        </div>
      )}
    </div>
  )
}
