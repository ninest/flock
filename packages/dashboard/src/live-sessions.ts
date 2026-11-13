// Which Sessions the Live tab shows. Live Sessions come from the Recent sessions list for today,
// which is ordered by latest activity, so the live ones (active or idle) come first.
import type { SessionList, SessionSummary } from "@flock/shared"

/** A Session whose Visitor may still be there: its last Event was under 30 minutes ago. */
export const isLive = (session: SessionSummary) => session.status !== "ended"

/** Whether the next page may hold more live Sessions: only while this whole page was live. */
export const needsNextPage = (page: Pick<SessionList, "sessions" | "nextCursor">) => page.nextCursor !== null && page.sessions.every(isLive)
