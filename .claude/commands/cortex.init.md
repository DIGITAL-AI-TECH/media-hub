---
description: Initialize Cortex project entry for the current repository. Creates project files in the Cortex knowledge base.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

This command creates a project entry in the Cortex universal knowledge repository for the current project.

### Step 1 — Locate Cortex Repository

1. Check for `CORTEX_PATH` environment variable
2. If not set, check for `../cortex` relative to the repository root
3. If not found, check for `~/cortex`
4. If none found, ERROR: "Cortex repository not found. Set CORTEX_PATH or clone it to ../cortex"

### Step 2 — Detect Project Information

1. Read the project's `CLAUDE.md` for overview, stack, and architecture
2. Read `.specify/memory/constitution.md` if it exists (for principles and constraints)
3. Detect project slug from the repository directory name (kebab-case)
4. Detect primary language and framework from existing code
5. Parse git remote URL for repository link

### Step 3 — Check for Existing Project

1. Check if `projects/<project-slug>/` already exists in Cortex
2. If it exists, ask user: "Project entry already exists. Update it? (yes/no)"
3. If user says no, STOP

### Step 4 — Create Project Structure

Create the following files in `<CORTEX_PATH>/projects/<project-slug>/`:

#### `project.md`
Overview, goals, tech stack, team/agents, key links. Pull information from CLAUDE.md and constitution.

#### `architecture.md`
System design, key interfaces, data flow, deployment model. Pull from CLAUDE.md architecture section.

#### `gotchas.md`
Empty initially or seeded from existing MEMORY.md gotchas if available. This file is APPEND-ONLY.

#### `state.md`
Current status, what's done, what's in progress, what's next.

### Step 5 — Sync to Remote

```bash
cd <CORTEX_PATH>
git add projects/<project-slug>/
git commit -m "cortex: init project <project-slug>"
git push
```

### Step 6 — Report

Report: project slug, files created, Cortex path, and suggest next steps:
- `/cortex.sync` to sync state changes
- `/cortex.context` to load Cortex context in a new session
