// A sparkline: a small line chart with no axes, labels or Annotations, drawn with the `.sparkline` styles.
import { sparklinePoints } from "./sparkline.ts"

export const SPARK_WIDTH = 96
export const SPARK_HEIGHT = 22

/** `values` oldest first; `label` describes them for screen readers, e.g. "Visitors per day". */
export const Sparkline = ({ values, label, width = SPARK_WIDTH }: {
  values: ReadonlyArray<number>
  label: string
  width?: number
}) => (
  <svg
    className="sparkline"
    width={width}
    height={SPARK_HEIGHT}
    viewBox={`0 0 ${width} ${SPARK_HEIGHT}`}
    role="img"
    aria-label={`${label}: ${values.join(", ")}`}
  >
    <polyline points={sparklinePoints(values, width, SPARK_HEIGHT)} />
  </svg>
)
