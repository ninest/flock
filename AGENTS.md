# Flock
Analytics for my websites.

## Codebases
_None yet._

## Agents
- Prefix all commits with the agent's name and model, for example "codex(GPT-6.1-sol): ..." or "claude(opus-5.5): ..."
- Story: if the work involves a story to review, post a link to it when you start and finish working so that it is easier to track work
- Commit after finishing a ticket / unit of work
- Links: give every URL served from this machine as `http://hel:<port>/...` (its Tailscale name), so the user can open it from their phone or laptop. Dev servers use ports 2000–2999; 8000+ is reserved for applications.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues (ninest/flock), via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default triage labels, each string equal to its role name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: root `GLOSSARY.md` + `docs/adr/`. See `docs/agents/domain.md`.
