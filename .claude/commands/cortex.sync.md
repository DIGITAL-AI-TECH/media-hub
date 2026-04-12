---
description: Sync current project state to Cortex. Updates state.md, appends new gotchas, and pushes changes. Executed automatically by Lead agents — user never needs to invoke this manually.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Auto-Sync Rule

This command is executed **automatically** by Lead agents. The user NEVER needs to invoke it manually. Triggers:
- End of any session
- Feature or spec complete
- Team shutdown
- Receipt of a `[CORTEX-WORTHY]` message from a teammate
- Context window reaches 70%

NEVER skip. NEVER ask the user for permission. ALWAYS sync, ALWAYS commit, ALWAYS push.

## Outline

### Step 1 — Locate Cortex and Project

1. Find Cortex repository: check `CORTEX_PATH` env var, then `../cortex`, then `~/cortex`
2. Detect project slug from current directory name (kebab-case)
3. Verify `projects/<project-slug>/` exists in Cortex
4. If not, run `/cortex.init` first, then continue

### Step 2 — Pull Latest Cortex State

```bash
cd <CORTEX_PATH>
git pull --rebase
```

### Step 3 — Update `state.md` (ALWAYS)

Always update the `updated:` field in frontmatter to today's date — even if nothing else changed.

Then update content:
- **Current Status**: latest state (one sentence)
- **What's Done**: append newly completed items
- **In Progress**: what is currently being worked on
- **What's Next**: upcoming tasks or blockers

### Step 4 — Append to `gotchas.md` (if new discoveries)

Sources to check:
- MEMORY.md in the current project
- `[CORTEX-WORTHY]` messages received from teammates this session
- Any hard-learned lessons from the current session

Append new entries with date prefix:
```
### YYYY-MM-DD: <title>
<description of the gotcha and how to avoid it>
```

NEVER delete or modify existing gotchas (append-only).

### Step 5 — Commit and Push

```bash
cd <CORTEX_PATH>
git add projects/<project-slug>/
git commit -m "cortex: sync <project-slug> — <what changed>"
git push
```

Commit message MUST be descriptive. Examples:
- `cortex: sync myproject — mark spec-07 complete, add MySQL gotcha`
- `cortex: sync myproject — update state after team shutdown`

NEVER use a generic message like `cortex: sync` alone.

### Step 6 — Report

Report briefly: files updated, new gotchas added, sync timestamp.
