// Instance admin page: Open sign-up, Invites and Members.
import type { Invite, Member } from "@flock/shared"
import { DateTime } from "effect"
import { type FormEvent, useState } from "react"
import { request } from "./api.ts"
import { Shell } from "./shell.tsx"
import { usePoll } from "./use-poll.ts"

/** The link an invited person opens; the sign-in page passes the token on sign-up. */
const inviteLink = (token: string) => `${window.location.origin}/sign-in?invite=${encodeURIComponent(token)}`

export const InstancePage = ({ me }: { me: Member }) => {
  // Bumped after each change so the lists reload right away instead of on the next poll.
  const [version, setVersion] = useState(0)
  const reload = () => setVersion((v) => v + 1)
  const [error, setError] = useState<string>()
  const act = (f: () => Promise<unknown>) => {
    setError(undefined)
    f().then(reload, (e: unknown) => setError(String((e as { message?: string }).message ?? e)))
  }
  return (
    <Shell section="instance">
      <div className="page narrow">
        <h1>Instance</h1>
        {error && <p role="alert" className="alert">{error}</p>}
        <OpenSignUp version={version} act={act} />
        <Invites version={version} act={act} />
        <Members me={me} version={version} act={act} />
      </div>
    </Shell>
  )
}

interface SectionProps {
  readonly version: number
  readonly act: (f: () => Promise<unknown>) => void
}

const OpenSignUp = ({ act, version }: SectionProps) => {
  const { data } = usePoll(() => request((api) => api.instance.settings()), [version])
  return (
    <section className="settings-section">
      <h2>Sign-up</h2>
      <label>
        <input
          type="checkbox"
          disabled={!data}
          checked={data?.openSignUp ?? false}
          onChange={(e) => {
            const openSignUp = e.currentTarget.checked
            act(() => request((api) => api.instance.updateSettings({ payload: { openSignUp } })))
          }}
        />{" "}
        Open sign-up: anyone can create a login without an Invite
      </label>
    </section>
  )
}

const Invites = ({ act, version }: SectionProps) => {
  const { data } = usePoll(() => request((api) => api.instance.invites()), [version])
  const [created, setCreated] = useState<{ note: string; link: string }>()

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const note = String(new FormData(form).get("note"))
    act(async () => {
      const { invite, token } = await request((api) => api.instance.createInvite({ payload: { note } }))
      setCreated({ note: invite.note, link: inviteLink(token) })
      form.reset()
    })
  }

  return (
    <section className="settings-section">
      <h2>Invites</h2>
      <form onSubmit={create} className="inline-form">
        <input name="note" required placeholder="Who is it for?" aria-label="Who is the Invite for?" />
        <button type="submit" className="btn">Create Invite</button>
      </form>
      {created && (
        <div>
          <p className="dim">Send this link to {created.note}. It works once, and is only shown now:</p>
          <div className="key">{created.link}</div>
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="people">
          {data.map((invite) => <InviteRow key={invite.id} invite={invite} act={act} />)}
        </ul>
      )}
    </section>
  )
}

const InviteRow = ({ act, invite }: { invite: Invite; act: SectionProps["act"] }) => (
  <li>
    <span>{invite.note}<br /><span className="dim">Created {DateTime.formatIsoDate(invite.createdAt)}</span></span>
    {invite.usedAt
      ? <span className="dim">Used by {invite.usedBy}</span>
      : (
        <button type="button" className="btn" onClick={() => act(() => request((api) => api.instance.revokeInvite({ params: { inviteId: invite.id } })))}>
          Revoke
        </button>
      )}
  </li>
)

const Members = ({ act, me, version }: SectionProps & { me: Member }) => {
  const { data } = usePoll(() => request((api) => api.instance.members()), [version])
  return (
    <section className="settings-section">
      <h2>Members</h2>
      <ul className="people">
        {data?.map((member) => (
          <li key={member.id}>
            <span>
              {member.name}
              <br />
              <span className="dim">{member.email}{member.isAdmin ? ", Instance admin" : ""}</span>
            </span>
            {member.id !== me.id && (
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  if (!confirm(`Remove ${member.email}? They will be signed out and can't sign in again.`)) return
                  act(() => request((api) => api.instance.removeMember({ params: { memberId: member.id } })))
                }}
              >
                Remove
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
