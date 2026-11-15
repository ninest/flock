# Flock

Self-hostable, event-based analytics for websites and apps. One deployment can serve several people, each tracking their own projects.

## Tenancy

**Instance**:
One running deployment of Flock, with its own data and settings.
_Avoid_: Server, deployment, tenant

**Member**:
A person with a login on an Instance, who uses the dashboard.
_Avoid_: User, account (a "user" is ambiguous with the people being tracked)

**Instance admin**:
A Member who manages Instance-wide settings, such as whether open sign-up is allowed, and sends invites.
_Avoid_: Superuser, owner

**Open sign-up**:
An Instance setting that lets anyone create a Member login without an invite. Off by default.

**Invite**:
A one-time offer that lets a specific person become a Member, which works even when Open sign-up is off.

## Tracking

**Project**:
One thing being tracked (a website, mobile app or backend), with its own key and dashboard.
_Avoid_: Site, property, app

**Project owner**:
A Member who manages a Project: its settings, keys, Environments and who it is shared with. A Project always has at least one, so a Member who is the only owner of a Project can't be removed from the Instance until another Member owns it.

**Project viewer**:
A Member a Project is shared with read-only: they see its reports for every Environment but can't change or delete anything.
_Avoid_: Guest, read-only member

**Environment**:
A separate data stream inside a Project, with its own keys. Every Project starts with `production`. Others, such as `dev`, can be added for testing.
_Avoid_: Stage, mode, dev project

**Event**:
A single recorded occurrence in an Environment, with a name, a timestamp, a Visitor, a Session and a set of Event properties.
_Avoid_: Hit, action

**Custom event**:
An Event whose name the tracked app chooses (such as `login_clicked` or `game_completed`), rather than one Flock defines.
_Avoid_: Goal, conversion

**Built-in event**:
An Event Flock defines itself. Its name starts with `$`, which is reserved for Flock.

**Pageview**:
The Built-in event named `$pageview`, which the browser script sends automatically.

**Event property**:
A key-value pair attached to an Event, such as the URL or a custom field.
_Avoid_: Attribute, param, "property" on its own (confusable with Project)

**Visitor**:
The person or device an Event is attributed to, as seen by Flock.
_Avoid_: User, client

**Session**:
A run of Events from one Visitor that ends after 30 minutes without activity.
_Avoid_: Visit

**Session timeline**:
The Events of one Session in the order they happened, oldest first, so you can follow what the Visitor did from the moment they arrived.
_Avoid_: Journey, session replay, clickstream

**Bounce**:
A Session with a single Event. The bounce rate is the share of Sessions that are bounces, and the visit duration is the average time from a Session's first Event to its last. A page's bounce rate counts only the Sessions that entered on it.

**Source**:
Where a Session came from as the browser reports it: the referring domain of its first Pageview, or Direct when there is none.
_Avoid_: Referrer (that is the full URL the Source is taken from), channel

**UTM tag**:
A label the author of a link put on it (source, medium, or campaign), read from a Session's first Pageview. It is shown beside the Source and never replaces it.
_Avoid_: UTM parameter, campaign tag

**Tracking mode**:
A per-Project choice of how Visitors are recognised: cookieless (an anonymous ID that resets daily) or persistent (an ID that is stored on the device and can be identified).

**Filter**:
A condition on one top-level Event property (is, is not, contains) that narrows every report to the Events that match. Several Filters combine with AND. Filters choose which Sessions a report covers (those with a matching Event) without changing what a Session is: its entry page, exit page and Source still come from its first or last Pageview, and whether it is a Bounce from all its Events.
_Avoid_: Segment, query

**Identify**:
Linking a persistent Visitor to an ID from the tracked app's own user system. Only possible in persistent Tracking mode. Every device identified with the same ID is one Visitor.

**Reset**:
Forgetting who a device is in persistent Tracking mode, typically when someone logs out of the tracked app. The device's later Events belong to a new anonymous Visitor, and everything it did before stays with the Visitor it was.
_Avoid_: Logout, unidentify

**Visitor name**:
The made-up two-word name, such as "Quiet Heron", that an anonymous persistent Visitor is shown by. It is always the same for the same Visitor. An identified Visitor is shown by their Display name, or their ID if they have none.
_Avoid_: Nickname, alias

**Display name**:
The name the tracked app gives an identified Visitor along with Identify, such as their username, shown in place of their ID. A Visitor has only their latest one. Changing it renames the Visitor and keeps all their history, because the ID is what makes them the same Visitor.
_Avoid_: Username, nickname, label

**Visitor profile**:
Everything one persistent Visitor did in an Environment, over all time: when they were first and last seen, their activity, their Events by name and their Sessions. Not available in cookieless Tracking mode.
_Avoid_: User profile, person

## Reports

**Annotation**:
A short dated note on a Project, such as "Launched on Hacker News", with an optional description. It is drawn on the charts of the Environments it applies to (all of them unless narrowed), to explain a change later.
_Avoid_: Event, marker, milestone
