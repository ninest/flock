// Filters: the active ones as removable chips, and the form that adds one. Clicking a row in a
// breakdown adds one too. Every report sends the same Filters (kept in the URL, see project-search.ts).
import type { Environment, EventPropertyFilter, EventPropertyFilters, FilterOperator } from "@flock/shared"
import { DateTime } from "effect"
import type { FormEvent } from "react"
import { request } from "./api.ts"
import { usePoll } from "./use-poll.ts"

const OPERATORS: ReadonlyArray<{ value: FilterOperator; label: string }> = [
  { value: "is", label: "is" },
  { value: "isNot", label: "is not" },
  { value: "contains", label: "contains" }
]

/** Keys every Environment can filter by; `$path` and `$referring_domain` are derived. */
const SUGGESTED_KEYS = ["$path", "$country", "$region", "$browser", "$os", "$device", "$referring_domain", "$utm_source", "$utm_medium", "$utm_campaign"]

/** The active Filters, each with a button that removes it, and "Clear" when there are several. */
export const FilterChips = ({ filters, onChange }: {
  filters: EventPropertyFilters
  onChange: (filters: EventPropertyFilters) => void
}) => (
  <>
    {filters.map((filter, i) => (
      <span key={`${filter.eventProperty}-${filter.op}-${filter.value}`} className="filter" data-testid="filter-chip">
        <code>{filter.eventProperty}</code> {OPERATORS.find((o) => o.value === filter.op)?.label} <strong>{filter.value}</strong>
        <button type="button" aria-label={`Remove filter ${filter.eventProperty}`} onClick={() => onChange(filters.filter((_, j) => j !== i))}>
          ×
        </button>
      </span>
    ))}
    {filters.length > 1 && <button type="button" className="link" onClick={() => onChange([])}>Clear</button>}
  </>
)

/** The form that adds a Filter, suggesting the Event property keys seen in the last 30 days. */
export const AddFilter = ({ environment, onAdd, onCancel }: {
  environment: Environment
  onAdd: (filter: EventPropertyFilter) => void
  onCancel: () => void
}) => {
  const { data } = usePoll(() => {
    const to = DateTime.makeUnsafe(Date.now())
    return request((api) =>
      api.reports.eventPropertyKeys({ params: { environmentId: environment.id }, query: { from: DateTime.subtract(to, { days: 30 }), to } })
    )
  }, [environment.id], 60_000)
  const keys = [...new Set([...SUGGESTED_KEYS, ...(data?.keys ?? [])])]
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const eventProperty = String(form.get("eventProperty")).trim()
    if (eventProperty === "") return
    onAdd({ eventProperty, op: String(form.get("op")) as FilterOperator, value: String(form.get("value")) })
  }
  return (
    <form onSubmit={submit} className="add-filter">
      <input name="eventProperty" list="filter-keys" placeholder="Event property" required maxLength={200} aria-label="Event property" autoFocus />
      <datalist id="filter-keys">{keys.map((key) => <option key={key} value={key} />)}</datalist>
      <select name="op" aria-label="Operator" defaultValue="is">
        {OPERATORS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <input name="value" placeholder="Value" maxLength={1000} aria-label="Value" />
      <button type="submit" className="btn">Apply</button>
      <button type="button" className="link" onClick={onCancel}>Cancel</button>
    </form>
  )
}
