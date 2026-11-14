// Annotations on the full-size time charts (the overview and a Custom event's detail, never
// sparklines): which pill is open and the details of its Annotations (owners may delete them), the
// form owners add or edit one with, timed now by default, for all Environments or chosen ones,
// and the list in Project settings.
import type { Annotation, Environment, EnvironmentId, ProjectId, ReportInterval } from "@flock/shared"
import { DateTime } from "effect"
import { type FormEvent, useState } from "react"
import { annotationEnvironments, environmentsLabel, fromLocalInput, linkParts, placeAnnotations, toLocalInput } from "./annotations.ts"
import { request } from "./api.ts"
import { useAction } from "./ui.tsx"

type ProjectEnvironments = ReadonlyArray<Pick<Environment, "id" | "name">>

/** `Mar 10, 2026, 10:37 AM` in the Project's time zone. */
const formatTime = (t: DateTime.Utc, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(DateTime.toEpochMillis(t))

/** A plain-text description with its URLs clickable. */
const Description = ({ text }: { text: string }) => (
  <p>
    {linkParts(text).map((part, i) =>
      part.href ? <a key={i} href={part.href} target="_blank" rel="noreferrer noopener">{part.text}</a> : part.text
    )}
  </p>
)

const author = (a: Annotation) => a.createdBy === null ? "a former Member" : a.createdBy.name || a.createdBy.email

/**
 * A chart's Annotations: the pills to draw on `TrendChart` and the bucket whose Annotations are
 * open, kept by name so it survives each poll.
 */
export const useChartAnnotations = (data: {
  readonly annotations: ReadonlyArray<Annotation>
  readonly buckets: ReadonlyArray<string>
  readonly interval: ReportInterval
  readonly timeZone: string
} | undefined) => {
  const [openBucket, setOpenBucket] = useState<string>()
  const buckets = data?.buckets ?? []
  const placed = data
    ? placeAnnotations(
      data.annotations.map((a) => ({ annotation: a, at: DateTime.toEpochMillis(a.at) })),
      buckets,
      data.interval,
      data.timeZone
    )
    : []
  const open = placed.find((p) => buckets[p.index] === openBucket)
  return {
    /** The props `TrendChart` draws the pills with. */
    chart: {
      annotations: placed.map((p) => ({ index: p.index, label: p.annotations[0]!.annotation.label, count: p.annotations.length })),
      selectedAnnotation: open?.index,
      onAnnotation: (index: number) => setOpenBucket((current) => (current === buckets[index] ? undefined : buckets[index]))
    },
    /** The open pill's Annotations, if any. */
    open: open?.annotations.map((p) => p.annotation),
    close: () => setOpenBucket(undefined)
  }
}

export const AnnotationDetails = ({ projectId, annotations, environments, timeZone, isOwner, onClose, onDeleted }: {
  projectId: ProjectId
  annotations: ReadonlyArray<Annotation>
  environments: ProjectEnvironments
  timeZone: string
  isOwner: boolean
  onClose: () => void
  onDeleted: () => Promise<unknown>
}) => {
  const action = useAction()
  const remove = (annotation: Annotation) => {
    if (!window.confirm(`Delete the Annotation "${annotation.label}"?`)) return
    void action.run(async () => {
      await request((api) => api.annotations.delete({ params: { projectId, annotationId: annotation.id } }))
      await onDeleted()
    })
  }
  return (
    <div className="annotations" data-testid="annotation-details">
      {annotations.map((a) => (
        <article key={a.id} className="annotation">
          <div className="annotation-head">
            <strong>{a.label}</strong>
            <span className="dim">{formatTime(a.at, timeZone)}</span>
          </div>
          {a.description !== null && <Description text={a.description} />}
          <div className="annotation-head">
            <span className="dim">
              {a.environments !== "all" && <>{environmentsLabel(a.environments, environments)} only · </>}
              Added by {author(a)} on {formatTime(a.createdAt, timeZone)}
            </span>
            {isOwner && (
              <button type="button" className="link" disabled={action.busy} onClick={() => remove(a)}>Delete</button>
            )}
          </div>
        </article>
      ))}
      {action.alert}
      <div className="actions" style={{ paddingTop: 12 }}>
        <button type="button" className="link" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

/** Adds an Annotation, or edits `annotation`. */
export const AnnotationForm = ({ projectId, timeZone, environments, annotation, onSaved, onCancel }: {
  projectId: ProjectId
  timeZone: string
  environments: ProjectEnvironments
  annotation?: Annotation
  onSaved: (annotation: Annotation) => Promise<unknown>
  onCancel: () => void
}) => {
  const action = useAction()
  const [defaultAt] = useState(() => toLocalInput(annotation ? DateTime.toEpochMillis(annotation.at) : Date.now(), timeZone))
  const [choice, setChoice] = useState<"all" | "some">(annotation && annotation.environments !== "all" ? "some" : "all")
  const [chosen, setChosen] = useState<ReadonlyArray<EnvironmentId>>(
    annotation && annotation.environments !== "all" ? annotation.environments : []
  )
  const toggle = (id: EnvironmentId, on: boolean) =>
    setChosen((current) => environments.map((e) => e.id).filter((e) => e === id ? on : current.includes(e)))
  const chosenEnvironments = annotationEnvironments(choice, chosen)
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (chosenEnvironments === undefined) return
    const data = new FormData(event.currentTarget)
    const label = String(data.get("label")).trim()
    const description = String(data.get("description")).trim()
    const at = fromLocalInput(String(data.get("at")), timeZone)
    const time = at === undefined ? {} : { at: DateTime.makeUnsafe(at) }
    void action.run(async () => {
      const saved = await request((api) =>
        annotation
          ? api.annotations.update({
            params: { projectId, annotationId: annotation.id },
            payload: { label, description: description || null, ...time, environments: chosenEnvironments }
          })
          : api.annotations.create({
            params: { projectId },
            payload: { label, ...(description ? { description } : {}), ...time, environments: chosenEnvironments }
          })
      )
      await onSaved(saved)
    })
  }
  return (
    <form className="form annotation-form" onSubmit={submit} data-testid="annotation-form">
      <label className="field">
        Label
        <input name="label" required maxLength={100} placeholder="Launched on Hacker News" defaultValue={annotation?.label} autoFocus />
      </label>
      <label className="field">
        Description (optional)
        <textarea
          name="description"
          rows={3}
          maxLength={1000}
          placeholder="Links are clickable, e.g. https://news.ycombinator.com/item?id=…"
          defaultValue={annotation?.description ?? undefined}
        />
      </label>
      <label className="field">
        Time ({timeZone})
        <input name="at" type="datetime-local" required defaultValue={defaultAt} />
      </label>
      <fieldset className="choices">
        <legend>Environments</legend>
        <label>
          <input type="radio" name="environments" checked={choice === "all"} onChange={() => setChoice("all")} />{" "}
          All Environments, including ones added later
        </label>
        <label>
          <input type="radio" name="environments" checked={choice === "some"} onChange={() => setChoice("some")} /> Only these
        </label>
        {choice === "some" && (
          <div className="choices-nested">
            {environments.map((e) => (
              <label key={e.id}>
                <input type="checkbox" checked={chosen.includes(e.id)} onChange={(ev) => toggle(e.id, ev.currentTarget.checked)} /> {e.name}
              </label>
            ))}
            {chosenEnvironments === undefined && <p className="dim">Choose at least one Environment.</p>}
          </div>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" className="btn" disabled={action.busy || chosenEnvironments === undefined}>
          {annotation ? "Save" : "Add Annotation"}
        </button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
      {action.alert}
    </form>
  )
}

/** Every Annotation of the Project, newest first. Owners edit and delete them; viewers only read. */
export const AnnotationList = ({ projectId, annotations, environments, timeZone, isOwner, onChange }: {
  projectId: ProjectId
  annotations: ReadonlyArray<Annotation>
  environments: ProjectEnvironments
  timeZone: string
  isOwner: boolean
  onChange: () => Promise<unknown>
}) => {
  const action = useAction()
  const [editing, setEditing] = useState<Annotation["id"]>()
  const remove = (annotation: Annotation) => {
    if (!window.confirm(`Delete the Annotation "${annotation.label}"?`)) return
    void action.run(async () => {
      await request((api) => api.annotations.delete({ params: { projectId, annotationId: annotation.id } }))
      await onChange()
    })
  }
  return (
    <div className="annotations annotation-list" data-testid="annotation-list">
      {annotations.map((a) =>
        editing === a.id
          ? (
            <div key={a.id} className="annotation">
              <AnnotationForm
                projectId={projectId}
                timeZone={timeZone}
                environments={environments}
                annotation={a}
                onCancel={() => setEditing(undefined)}
                onSaved={async () => {
                  setEditing(undefined)
                  await onChange()
                }}
              />
            </div>
          )
          : (
            <article key={a.id} className="annotation">
              <div className="annotation-head">
                <strong>{a.label}</strong>
                <span className="dim">{formatTime(a.at, timeZone)}</span>
              </div>
              {a.description !== null && <Description text={a.description} />}
              <div className="annotation-head">
                <span className="dim">{environmentsLabel(a.environments, environments)} · Added by {author(a)}</span>
                {isOwner && (
                  <span className="actions">
                    <button type="button" className="link" disabled={action.busy} onClick={() => setEditing(a.id)}>Edit</button>
                    <button type="button" className="link" disabled={action.busy} onClick={() => remove(a)}>Delete</button>
                  </span>
                )}
              </div>
            </article>
          )
      )}
      {action.alert}
    </div>
  )
}
