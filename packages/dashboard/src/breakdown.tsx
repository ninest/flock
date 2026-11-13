// A breakdown: one `top` report as rows with a faint bar behind each, sized by the row's count
// against the largest. Its title can switch between related reports (Pages, Entry pages, Exit
// pages). Clicking a row adds its value as a Filter.
import type { Environment, EventPropertyFilter, ReportRangeQuery, TopReport } from "@flock/shared"
import { useState } from "react"
import { request } from "./api.ts"
import { barWidth, capitalize, countryName, formatCount } from "./format.ts"
import { isComplete, queryDeps } from "./project-search.ts"
import { barStyle, Dropdown, Notice, pending, Rows } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

export interface BreakdownReport {
  readonly report: TopReport
  readonly title: string
  /** What the counts are, e.g. "Pageviews" or "Sessions". */
  readonly unit: "Pageviews" | "Sessions"
  /** Display text for a value. */
  readonly label?: (value: string) => string
  /** What a `null` value means. */
  readonly nullLabel: string
  /** The Event property a row's value filters by, e.g. `$path` for pages. */
  readonly filterKey: string
}

/** `DE` as a flag and a name. */
const country = (code: string) => {
  const flag = /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : ""
  return `${flag}  ${countryName(code)}`.trim()
}

/** The four breakdowns on the Dashboard, each with the reports its title switches between. */
export const BREAKDOWNS: ReadonlyArray<ReadonlyArray<BreakdownReport>> = [
  [
    { report: "pages", title: "Pages", unit: "Pageviews", nullLabel: "Unknown", filterKey: "$path" },
    { report: "entryPages", title: "Entry pages", unit: "Sessions", nullLabel: "Unknown", filterKey: "$path" },
    { report: "exitPages", title: "Exit pages", unit: "Sessions", nullLabel: "Unknown", filterKey: "$path" }
  ],
  [
    { report: "referrers", title: "Sources", unit: "Sessions", nullLabel: "Direct", filterKey: "$referring_domain" },
    { report: "utmSources", title: "UTM sources", unit: "Sessions", nullLabel: "None", filterKey: "$utm_source" },
    { report: "utmMediums", title: "UTM mediums", unit: "Sessions", nullLabel: "None", filterKey: "$utm_medium" },
    { report: "utmCampaigns", title: "UTM campaigns", unit: "Sessions", nullLabel: "None", filterKey: "$utm_campaign" }
  ],
  [{ report: "countries", title: "Countries", unit: "Pageviews", label: country, nullLabel: "Unknown", filterKey: "$country" }],
  [
    { report: "devices", title: "Devices", unit: "Pageviews", label: capitalize, nullLabel: "Unknown", filterKey: "$device" },
    { report: "browsers", title: "Browsers", unit: "Pageviews", nullLabel: "Unknown", filterKey: "$browser" },
    { report: "oses", title: "Operating systems", unit: "Pageviews", nullLabel: "Unknown", filterKey: "$os" }
  ]
]

const ROWS = 8

export const Breakdown = ({ environment, query, reports, onAddFilter }: {
  environment: Environment
  query: ReportRangeQuery
  reports: ReadonlyArray<BreakdownReport>
  onAddFilter: (filter: EventPropertyFilter) => void
}) => {
  const [selected, setSelected] = useState(0)
  const report = reports[selected] ?? reports[0]!
  const complete = isComplete(query)
  const { data, error } = usePoll(
    () => complete ? request((api) => api.reports.top({ params: { environmentId: environment.id }, query: { ...query, report: report.report } })) : Promise.resolve(undefined),
    [environment.id, report.report, ...queryDeps(query)]
  )
  const rows = data?.report === report.report ? data.rows.slice(0, ROWS) : undefined
  const max = Math.max(0, ...(rows ?? []).map((r) => r.count))
  const title = reports.length === 1 ? report.title : (
    <Dropdown label={<span>{report.title}</span>}>
      {reports.map((r, i) => (
        <button key={r.report} type="button" role="menuitem" className="menu-item" data-current={i === selected} onClick={() => setSelected(i)}>
          {r.title}
        </button>
      ))}
    </Dropdown>
  )
  return (
    <section>
      <Rows variant="bars" title={title} columns={[{ label: report.title }, { label: report.unit, width: 96 }]} testId={`top-${report.report}`}>
        {!complete ? null : !rows ? pending(error, report.title) : rows.length === 0 ? <Notice>Nothing in this range.</Notice> : rows.map((row) => {
          const cells = (
            <>
              <span className={row.value === null ? "muted" : undefined}>{row.value === null ? report.nullLabel : report.label ? report.label(row.value) : row.value}</span>
              <span>{formatCount(row.count)}</span>
            </>
          )
          return row.value === null
            ? <div key="\u0000" className="row" role="row" style={barStyle(barWidth(row.count, max))}>{cells}</div>
            : (
              <button
                key={row.value}
                type="button"
                role="row"
                className="row"
                style={barStyle(barWidth(row.count, max))}
                title={`Filter by ${report.filterKey} is ${row.value}`}
                onClick={() => onAddFilter({ eventProperty: report.filterKey, op: "is", value: row.value! })}
              >
                {cells}
              </button>
            )
        })}
      </Rows>
    </section>
  )
}
