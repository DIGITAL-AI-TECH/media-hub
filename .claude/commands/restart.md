---
description: Restart MCP servers and reload Cortex context. Use when MCP tools fail or after adding new integrations.
---

## Restart — Reinitialize MCP and Cortex

This command triggers the orchestrator to rebuild the MCP config from Cortex integrations
and reload the Cortex context rules. Your conversation history is fully preserved.

**How it works:** The orchestrator rewrites `.mcp.json` from `/cortex/integrations/*.md`,
reloads Cortex rules into `.claude/rules/`, then the NEXT Claude CLI spawn (your next message)
picks up the updated MCPs automatically via `--resume`.

### Step 1 — Call Restart API

```bash
curl -s -X POST "${SERVICES_URL}/sessions/${SESSION_ID}/restart" | cat
```

### Step 2 — Inform the user

Tell the user EXACTLY this:

> **MCP servers atualizados.** O `.mcp.json` foi reescrito com as integrações do Cortex.
> Os novos MCP tools estarão disponíveis na **próxima mensagem** que você enviar
> (o CLI recarrega os MCPs a cada spawn, e a conversa é preservada via --resume).

Do NOT say the user needs to close or reopen the session. The next message is enough.
