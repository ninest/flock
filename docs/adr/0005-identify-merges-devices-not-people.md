# Identify merges devices, never identified Visitors

In persistent Tracking mode, Identify links a device's own Visitor ID to the tracked app's ID for the person. From then on, that ID is the Visitor: every device identified with it counts as one Visitor, and the device's earlier Events and Sessions in the Project move over to it, so a Visitor profile shows the person's whole history across devices. A device that identifies as a different ID later switches to it (someone signed in to another account). An ID stays an identified Visitor for good once an Identify has named it, also after its last device switched to another ID. An ID that is itself already an identified Visitor is never linked to another, so two identified Visitors are never merged.

## Considered Options

- **Keep each device a separate Visitor and only label it with the ID**: rejected. One person on a laptop and a phone would show as two Visitors with two half-histories, which defeats the point of identifying them.
- **Allow merging two identified Visitors**: rejected. A mistaken or malicious Identify call could fuse two real people's histories, and that cannot be split apart again.

## Consequences

Identify rewrites earlier Events, so a Visitor's anonymous history can seem to vanish from one Visitor and reappear under the identified one. Counts of unique Visitors over past ranges can drop after an Identify.
