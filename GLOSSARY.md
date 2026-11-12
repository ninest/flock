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
A Member who manages a Project: its settings, keys, Environments and who it is shared with. A Project always has at least one.

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

**Bounce**:
A Session with a single Event. The bounce rate is the share of Sessions that are bounces, and the visit duration is the average time from a Session's first Event to its last.

**Tracking mode**:
A per-Project choice of how Visitors are recognised: cookieless (an anonymous ID that resets daily) or persistent (an ID that is stored on the device and can be identified).

**Identify**:
Linking a persistent Visitor to an ID from the tracked app's own user system. Only possible in persistent Tracking mode.
