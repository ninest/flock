// The overview chart's Annotations: the details of the ones on a clicked pill (owners may delete
// them), and the form owners add one with, timed now by default.
import type { Annotation, ProjectId } from "@flock/shared"
import { DateTime } from "effect"
import { type FormEvent, useState } from "react"
import { fromLocalInput, linkParts, toLocalInput } from "./annotations.ts"
import { request } from "./api.ts"
import { useAction } from "./ui.tsx"

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

export const AnnotationDetails = ({ projectId, annotations, timeZone, isOwner, onClose, onDeleted }: {
  projectId: ProjectId
  annotations: ReadonlyArray<Annotation>
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
              Added by {a.createdBy === null ? "a former Member" : a.createdBy.name || a.createdBy.email} on {formatTime(a.createdAt, timeZone)}
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

export const AddAnnotation = ({ projectId, timeZone, onAdded, onCancel }: {
  projectId: ProjectId
  timeZone: string
  onAdded: (annotation: Annotation) => Promise<unknown>
  onCancel: () => void
}) => {
  const action = useAction()
  const [defaultAt] = useState(() => toLocalInput(Date.now(), timeZone))
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData(event.currentTarget)
    const label = String(data.get("label")).trim()
    const description = String(data.get("description")).trim()
    const at = fromLocalInput(String(data.get("at")), timeZone)
    void action.run(async () => {
      const created = await request((api) =>
        api.annotations.create({
          params: { projectId },
          payload: { label, ...(description ? { description } : {}), ...(at === undefined ? {} : { at: DateTime.makeUnsafe(at) }) }
        })
      )
      await onAdded(created)
    })
  }
  return (
    <form className="form annotation-form" onSubmit={submit} data-testid="add-annotation">
      <label className="field">
        Label
        <input name="label" required maxLength={100} placeholder="Launched on Hacker News" autoFocus />
      </label>
      <label className="field">
        Description (optional)
        <textarea name="description" rows={3} maxLength={1000} placeholder="Links are clickable, e.g. https://news.ycombinator.com/item?id=…" />
      </label>
      <label className="field">
        Time ({timeZone})
        <input name="at" type="datetime-local" required defaultValue={defaultAt} />
      </label>
      <p className="dim">Applies to all of this Project's Environments, including ones added later.</p>
      <div className="actions">
        <button type="submit" className="btn" disabled={action.busy}>Add Annotation</button>
        <button type="button" className="link" onClick={onCancel}>Cancel</button>
      </div>
      {action.alert}
    </form>
  )
}
