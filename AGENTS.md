# Agent Instructions (Codex)

Always read `~/.config/agent/POLICY.md` before doing any work; it defines the shell policy, including the required wrappers for git and Beads commands and the allowed Beads actions.

## Mission
Implement tasks for this repo safely and incrementally.

## Landing the Plane (Session Completion)

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git_net pull --rebase
   git_net push
   git_local status -sb  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes; only prune remote branches if explicitly requested (use `git_net fetch --prune` or `git_net remote prune origin`)
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

**POLICY ALIGNMENT:**
- Do not run raw `git` or `bd` commands; use `git_local`, `git_net`, and `bd_safe` only.
- Beads sync is disabled by policy; do not run `bd sync`.

## Project Brain Authority
- The Project Brain at `/home/jirving/projects/lol/project-brain` is the source of truth for project intent, policy, architecture, and decisions.
- Before doing work, read `/home/jirving/projects/lol/project-brain/AGENTS.md` and the latest Daily Brief.
- If a local doc conflicts with the Project Brain, flag it and ask for resolution.
