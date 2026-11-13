// Content and acquisition reports for one Environment: top, entry and exit pages; referrers
// and UTM tags (shared date range), plus the live count of Visitors in the last 30 minutes.
import type { Environment, EventPropertyFilters, EventPropertyFilter, ReportRangeQuery } from "@flock/shared"
import { request } from "./api.ts"
import { muted, type TopTab, TopList } from "./top-list.tsx"
import { usePoll } from "./use-poll.ts"

const PAGES: ReadonlyArray<TopTab> = [
  { report: "pages", title: "Top pages", unit: "Pageviews", filterKey: "$path" },
  { report: "entryPages", title: "Entry pages", unit: "Sessions", filterKey: "$path" },
  { report: "exitPages", title: "Exit pages", unit: "Sessions", filterKey: "$path" }
]

const SOURCES: ReadonlyArray<TopTab> = [
  { report: "referrers", title: "Referrers", unit: "Sessions", nullLabel: "Direct / none", filterKey: "$referring_domain" },
  { report: "utmSources", title: "UTM sources", unit: "Sessions", filterKey: "$utm_source" },
  { report: "utmMediums", title: "Mediums", unit: "Sessions", filterKey: "$utm_medium" },
  { report: "utmCampaigns", title: "Campaigns", unit: "Sessions", filterKey: "$utm_campaign" }
]

export const PagesAndSources = ({ environment, range, onAddFilter }: {
  environment: Environment
  range: ReportRangeQuery
  onAddFilter: (filter: EventPropertyFilter) => void
}) => (
  <section style={{ margin: "12px 0" }}>
    <h3 style={{ marginBottom: 8 }}>Pages and sources</h3>
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <TopList environment={environment} range={range} tabs={PAGES} onAddFilter={onAddFilter} />
      <TopList environment={environment} range={range} tabs={SOURCES} onAddFilter={onAddFilter} />
    </div>
  </section>
)

/** Unique Visitors with a matching Event in the last 30 minutes, refreshed every 10 seconds. */
export const LiveVisitors = ({ environment, filters }: { environment: Environment; filters: EventPropertyFilters | undefined }) => {
  const { data } = usePoll(
    () => request((api) => api.reports.live({ params: { environmentId: environment.id }, query: { filters } })),
    [environment.id, JSON.stringify(filters ?? [])],
    10_000
  )
  return (
    <span data-testid="live-visitors" style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 14 }}>
      <span aria-hidden style={{ width: 8, height: 8, borderRadius: 4, background: data?.visitors ? "#1a9e55" : "#bbb" }} />
      <strong>{data === undefined ? "–" : data.visitors.toLocaleString()}</strong>
      <span style={muted}>{data?.visitors === 1 ? "Visitor" : "Visitors"} in the last 30 minutes</span>
    </span>
  )
}
