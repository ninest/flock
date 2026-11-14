// A breakdown: one `top` report as rows with a faint bar behind each, sized by the row's unique
// Visitors against the largest. Its title can switch between related reports (Pages, Entry pages, Exit
// pages). Clicking a row adds its value as a Filter.
import type { Environment, EventPropertyFilter, ReportRangeQuery, TopReport, TopRow } from "@flock/shared"
import { useState } from "react"
import { request } from "./api.ts"
import { barWidth, capitalize, countryName, formatCount, formatDuration, formatShare } from "./format.ts"
import { isComplete, queryDeps } from "./project-search.ts"
import { barStyle, Dropdown, Notice, pending, Rows, wide } from "./ui.tsx"
import { usePoll } from "./use-poll.ts"

export interface BreakdownReport {
  readonly report: TopReport
  readonly title: string
  /** Columns after Visitors, from the row's optional fields, e.g. Pageviews for pages. */
  readonly columns?: ReadonlyArray<BreakdownColumn>
  /** Display text for a value. */
  readonly label?: (value: string) => string
  /** What a `null` value means. */
  readonly nullLabel: string
  /** The Event property a row's value filters by, e.g. `$path` for pages. */
  readonly filterKey: string
}

/** A column after Visitors, showing one of the optional fields a report fills in. */
export interface BreakdownColumn {
  readonly label: string
  readonly cell: (row: TopRow) => string
  readonly width?: number
  /** Dropped on a phone, where tables keep three columns. */
  readonly wide?: boolean
}

const pageviews: BreakdownColumn = { label: "Pageviews", cell: (row) => formatCount(row.pageviews ?? 0), width: 88 }
const bounceRate: BreakdownColumn = { label: "Bounce rate", cell: (row) => formatShare(row.bounceRate), width: 88 }
const exitRate: BreakdownColumn = { label: "Left from here", cell: (row) => formatShare(row.exitRate), width: 104, wide: true }
const timeOnPage: BreakdownColumn = {
  label: "Time on page",
  cell: (row) => row.timeOnPage == null ? "–" : formatDuration(row.timeOnPage),
  width: 96,
  wide: true
}

/** `DE` as a flag and a name. */
const country = (code: string) => {
  const flag = /^[A-Z]{2}$/.test(code) ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : ""
  return `${flag}  ${countryName(code)}`.trim()
}

/** The four breakdowns on the Dashboard, each with the reports its title switches between. */
export const BREAKDOWNS: ReadonlyArray<ReadonlyArray<BreakdownReport>> = [
  [
    { report: "pages", title: "Pages", columns: [pageviews, { ...bounceRate, wide: true }, exitRate, timeOnPage], nullLabel: "Unknown", filterKey: "$path" },
    { report: "entryPages", title: "Entry pages", columns: [bounceRate], nullLabel: "Unknown", filterKey: "$path" },
    { report: "exitPages", title: "Exit pages", columns: [bounceRate], nullLabel: "Unknown", filterKey: "$path" }
  ],
  [
    { report: "referrers", title: "Sources", columns: [bounceRate], nullLabel: "Direct", filterKey: "$referring_domain" },
    { report: "utmSources", title: "UTM sources", columns: [bounceRate], nullLabel: "None", filterKey: "$utm_source" },
    { report: "utmMediums", title: "UTM mediums", columns: [bounceRate], nullLabel: "None", filterKey: "$utm_medium" },
    { report: "utmCampaigns", title: "UTM campaigns", columns: [bounceRate], nullLabel: "None", filterKey: "$utm_campaign" }
  ],
  [{ report: "countries", title: "Countries", label: country, nullLabel: "Unknown", filterKey: "$country" }],
  [
    { report: "devices", title: "Devices", columns: [bounceRate], label: capitalize, nullLabel: "Unknown", filterKey: "$device" },
    { report: "browsers", title: "Browsers", columns: [bounceRate], nullLabel: "Unknown", filterKey: "$browser" },
    { report: "oses", title: "Operating systems", columns: [bounceRate], nullLabel: "Unknown", filterKey: "$os" }
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
  const max = Math.max(0, ...(rows ?? []).map((r) => r.visitors))
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
    <section className={reports.some((r) => (r.columns?.length ?? 0) > 1) ? "breakdown-full" : undefined}>
      <Rows variant="bars" title={title} columns={[{ label: report.title }, { label: "Visitors", width: 96 }, ...(report.columns ?? [])]} testId={`top-${report.report}`}>
        {!complete ? null : !rows ? pending(error, report.title) : rows.length === 0 ? <Notice>Nothing in this range.</Notice> : rows.map((row) => {
          const cells = (
            <>
              <span className={row.value === null ? "muted" : undefined}>{row.value === null ? report.nullLabel : report.label ? report.label(row.value) : row.value}</span>
              <span>{formatCount(row.visitors)}</span>
              {report.columns?.map((c) => <span key={c.label} {...(c.wide ? wide : {})}>{c.cell(row)}</span>)}
            </>
          )
          return row.value === null
            ? <div key="\u0000" className="row" role="row" style={barStyle(barWidth(row.visitors, max))}>{cells}</div>
            : (
              <button
                key={row.value}
                type="button"
                role="row"
                className="row"
                style={barStyle(barWidth(row.visitors, max))}
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
