---
description: Load Cortex context for the current project. Reads identity, project state, gotchas, and relevant cross-project knowledge.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

This command loads relevant Cortex knowledge into the current session. Use it at the start of any work session to bootstrap context.

### Step 1 — Locate Cortex

1. Find Cortex repository (same logic as `/cortex.init`)
2. Pull latest: `cd <CORTEX_PATH> && git pull --rebase`

### Step 2 — Load Identity Context

Read and internalize (do not repeat verbatim to user):

1. `identity/preferences.md` — communication style, language, tool preferences
2. `identity/standards.md` — coding conventions, commit format, review rules
3. `identity/tech-stack.md` — primary technologies

### Step 3 — Load Project Context

Detect project slug and read:

1. `projects/<slug>/project.md` — overview, goals, stack
2. `projects/<slug>/gotchas.md` — **LEITURA CRÍTICA** — hard-learned lessons, read before state
3. `projects/<slug>/state.md` — current status, what's done, what's next
4. `projects/<slug>/architecture.md` — system design (if exists)

### Step 4 — Load Relevant Cross-Project Knowledge

Based on the project's tech stack, load relevant global knowledge:

1. Read `knowledge/_index.md` for available entries
2. Filter by tags matching the project's technologies
3. Read the top 3-5 most relevant gotchas and patterns
4. Summarize available knowledge without reading everything

### Step 5 — Optional Deep Load

If user provided arguments specifying a topic (e.g., `/cortex.context streaming`):

1. Search Cortex for all entries matching the topic
2. Read knowledge files, patterns, and decisions related to the topic
3. Provide a focused briefing on that topic

### Step 6 — Report

Present a concise context summary:

```
## Cortex Context Loaded

**Project**: <name> (<slug>)
**Status**: <current status from state.md>
**Last synced**: <updated date from state.md>

### Key Gotchas (project)
- <top 3 gotchas>

### Available Knowledge
- <count> patterns, <count> gotchas relevant to your stack

Ready to work. Use `/cortex.sync` when done to save progress.
```
