---
name: approve-and-next-session
description: "Approve a reviewed ticket, ship it to main, and write the prompt for the next ticket's session."
disable-model-invocation: true
---

The user has reviewed a ticket's story and approves it. Get the work onto `origin/main`, close the ticket with the approval, and hand over a prompt for a fresh session that implements the next ticket.

Arguments: an optional ticket number (`#18`) and an optional review note. With no number, use the ticket this session worked on. If that is ambiguous, ask.

Tickets are GitHub issues. Read `docs/agents/issue-tracker.md` first for the `gh` conventions and the repo name.

## 1. Ship to main

State the ticket's title, then:

1. Commit anything uncommitted with the agent prefix from `CLAUDE.md` and the ticket number, for example `claude(opus-5.5): approve export walking skeleton (#18)`.
2. If the work is on a branch other than `main`, merge it into `main`. When a PR exists, merge the PR with `gh pr merge` instead.
3. Push `main`. If the push is rejected, pull with rebase and push again. If a conflict remains, stop and report it; history on `origin` is only ever appended to.

Done when `git status` on `main` reports it is up to date with `origin/main` and the ticket's commits are in `git log origin/main`.

## 2. Approve

1. Tick every acceptance checkbox in the issue body (`- [ ]` → `- [x]`) and save it with `gh issue edit <n> --body-file`.
2. Close the issue with one comment: `Approved.`, the user's review note in their words if they gave one, and the short hash of the commit on `main` that ships it.

Done when `gh issue view <n>` shows the issue closed with every box ticked.

## 3. Pick the next ticket

Find the parent with `gh api repos/<repo>/issues/<n>/parent`, then list its sub-issues in order with `gh api repos/<repo>/issues/<parent>/sub_issues`. The next ticket is the first open sub-issue with no assignee whose blockers (`gh api repos/<repo>/issues/<m>/dependencies/blocked_by`) are all closed. Note any other sub-issues that are ready too; they can run in parallel sessions.

If none is ready, say whether the feature is finished (every sub-issue closed) or blocked, and by which open tickets, and stop there.

Read the next ticket in full, then the approved ticket's comments and its commits (`git log --grep '#<n>'`). Collect the **handoff**: facts the next session needs that its ticket text does not say. That means the modules, seams or fixtures it builds on, decisions or deviations made along the way, gotchas found while verifying, and anything a review note asks for. Leave out anything the ticket, the parent spec or the code already states; the next session reads those itself.

## 4. Hand over

Reply with:

- **Next ticket**: its number, title and URL, plus any other ready tickets.
- **Model**: the ticket's suggested model, if it names one, with its reason. Otherwise recommend the model you are running as.
- **Prompt**: one fenced code block the user can paste as-is. It opens with `/implement #<next>`, followed by the handoff as short bullets.
