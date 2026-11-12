// Content and acquisition reports for one Environment: top, entry and exit pages; referrers
// and UTM tags (shared date range), plus the live count of Visitors in the last 30 minutes.
import type { Environment, ReportRangeQuery } from "@flock/shared"
import { request } from "./api.ts"
import { muted, type TopTab, TopList } from "./top-list.tsx"
import { usePoll } from "./use-poll.ts"

const PAGES: ReadonlyArray<TopTab> = [
  { report: "pages", title: "Top pages", unit: "Pageviews" },
  { report: "entryPages", title: "Entry pages", unit: "Sessions" },
  { report: "exitPages", title: "Exit pages", unit: "Sessions" }
]

const SOURCES: ReadonlyArray<TopTab> = [
  { report: "referrers", title: "Referrers", unit: "Sessions", nullLabel: "Direct / none" },
  { report: "utmSources", title: "UTM sources", unit: "Sessions" },
  { report: "utmMediums", title: "Mediums", unit: "Sessions" },
  { report: "utmCampaigns", title: "Campaigns", unit: "Sessions" }
]

export const PagesAndSources = ({ environment, range }: { environment: Environment; range: ReportRangeQuery }) => (
  <section style={{ margin: "12px 0" }}>
    <h3 style={{ marginBottom: 8 }}>Pages and sources</h3>
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
      <TopList environment={environment} range={range} tabs={PAGES} />
      <TopList environment={environment} range={range} tabs={SOURCES} />
    </div>
  </section>
)

/** Unique Visitors with an Event in the last 30 minutes, refreshed every 10 seconds. */
export const LiveVisitors = ({ environment }: { environment: Environment }) => {
  const { data } = usePoll(
    () => request((api) => api.reports.live({ params: { environmentId: environment.id } })),
    [environment.id],
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
