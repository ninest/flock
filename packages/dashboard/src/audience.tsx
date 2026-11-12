// Audience reports for one Environment: Pageviews by country, browser, OS and device in the
// shared date range, as ranked lists with proportional bars.
import type { Environment, PropertyFilter, ReportRangeQuery } from "@flock/shared"
import { muted, type TopTab, TopList } from "./top-list.tsx"

const countryNames = new Intl.DisplayNames(undefined, { type: "region" })
const countryName = (code: string) => {
  try {
    return countryNames.of(code) ?? code
  } catch {
    return code
  }
}

const REPORTS: ReadonlyArray<TopTab> = [
  { report: "countries", title: "Countries", unit: "Pageviews", label: countryName, filterKey: "$country" },
  { report: "browsers", title: "Browsers", unit: "Pageviews", filterKey: "$browser" },
  { report: "oses", title: "Operating systems", unit: "Pageviews", filterKey: "$os" },
  { report: "devices", title: "Devices", unit: "Pageviews", filterKey: "$device", label: (value) => value.charAt(0).toUpperCase() + value.slice(1) }
]

export const AudienceReports = ({ environment, range, onAddFilter }: {
  environment: Environment
  range: ReportRangeQuery
  onAddFilter: (filter: PropertyFilter) => void
}) => (
  <section style={{ margin: "12px 0" }}>
    <h3 style={{ marginBottom: 8 }}>Audience</h3>
    <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
      {REPORTS.map((tab) => <TopList key={tab.report} environment={environment} range={range} tabs={[tab]} onAddFilter={onAddFilter} />)}
    </div>
    <p style={{ ...muted, fontSize: 12 }}>
      <a href="https://db-ip.com" style={{ color: "inherit" }}>IP Geolocation by DB-IP</a>
    </p>
  </section>
)
