---
description: Trigger the Obsidian vault processing pipeline. Processes inbox notes and/or syncs Cortex docs to Qdrant.
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Outline

This command triggers the obsidian-processor pipeline via the orchestrator's internal API.
The orchestrator spins up an ephemeral container that processes the vault inbox and/or syncs documents to Qdrant.

### Step 1 — Determine Mode

Parse user arguments to determine the processing mode:

- **"pipeline"** — Process inbox notes only (classify, enrich, move to vault)
- **"sync"** — Sync existing vault + Cortex docs to Qdrant only
- **"both"** (default) — Run pipeline first, then sync

If no arguments provided, use "both".

### Step 2 — Verify Inbox (optional)

If mode includes "pipeline", optionally check if there are files in the inbox:

```bash
ls /cortex/vault/_pipeline/inbox/ 2>/dev/null
```

Report what files are queued for processing.

### Step 3 — Call Orchestrator API

The internal services URL is available via the `SERVICES_URL` environment variable.

```bash
curl -s -X POST "${SERVICES_URL}/services/process-vault" \
  -H "Content-Type: application/json" \
  -d '{"mode": "<mode>"}'
```

**IMPORTANT**: This is an internal-only endpoint. It only works from within the Docker network.

### Step 4 — Report Results

Parse the JSON response and report:

- **Success**: mode executed, container logs summary, files processed
- **409 Conflict**: "Pipeline already in progress, wait and retry"
- **503 Service Unavailable**: "Cortex not initialized yet"
- **Error**: Show error details

### Notes

- The pipeline processes files from `/cortex/vault/_pipeline/inbox/`
- Processed notes are moved to their category folders in the vault
- Sync mode indexes vault notes + Cortex knowledge into Qdrant
- The container is ephemeral — it starts, processes, and shuts down automatically
- After pipeline mode, Cortex changes are auto-committed and pushed
