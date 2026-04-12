---
name: swarm-deploy
description: Deploy, manage, and troubleshoot Docker Swarm applications autonomously. Creates stacks with HTTPS via Traefik, monitors status, reads logs, and removes deployments. All stacks are sandboxed with agent- prefix.
argument-hint: "[deploy|status|logs|list|remove] [options]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Swarm Deploy — Autonomous Application Deployment

You are helping deploy and manage Docker applications on Docker Swarm via the Swarm Deploy MCP tools.

## Input

The user (or another agent) will request one of:
- **Deploy** a new application
- **Check status** of deployed stacks
- **Read logs** of a running service
- **List** all agent stacks
- **Remove** a stack
- **Update** an existing application (remove + redeploy)

Parse the action from `$ARGUMENTS` or infer from context.

## Available MCP Tools

| Tool | Purpose |
|------|---------|
| `mcp__swarm-deploy__deployStack` | Deploy a new stack. Params: `stackName`, `composeContent` |
| `mcp__swarm-deploy__listStacks` | List all agent-* stacks. No params |
| `mcp__swarm-deploy__getStackStatus` | Get stack details. Params: `stackId` (numeric) |
| `mcp__swarm-deploy__removeStack` | Remove a stack. Params: `stackId` (numeric) |
| `mcp__swarm-deploy__getServiceLogs` | Get last 100 log lines. Params: `serviceId` (name or ID) |

## Security Rules (MANDATORY)

**You MUST follow these rules. Violations are blocked by the API.**

1. **Stack name**: MUST start with `agent-` (lowercase, hyphens, no spaces)
2. **Network**: MUST include `oraculusnet_v2` as external network
3. **Traefik labels**: MUST include routing with `Host(`agent-NAME.digital-ai.tech`)`
4. **Resource limits**: MUST declare CPU (max 2) and memory (max 4GB) limits
5. **Replicas**: Max 5 per service
6. **BLOCKED**: privileged, host network, host PID/IPC, dangerous volumes, dangerous capabilities, YAML anchors/aliases

## Deploy Workflow

### Step 1 — Determine Requirements

Ask or infer:
- Application name (will become `agent-<name>`)
- Docker image (must be from public registry or accessible to Swarm)
- Port the app listens on internally
- Environment variables needed
- Persistent storage needs (named volumes only, no host mounts)

### Step 2 — Generate Compose YAML

Use this exact template, replacing placeholders:

```yaml
version: '3.8'
services:
  app:
    image: IMAGE:TAG
    environment:
      - KEY=VALUE
    deploy:
      replicas: 1
      placement:
        constraints:
          - node.hostname == vmi1215893.contaboserver.net
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.1'
          memory: 128M
      labels:
        - traefik.enable=true
        - traefik.http.routers.STACKNAME.rule=Host(`STACKNAME.digital-ai.tech`)
        - traefik.http.routers.STACKNAME.entrypoints=websecure
        - traefik.http.routers.STACKNAME.tls=true
        - traefik.http.routers.STACKNAME.tls.certresolver=letsencryptresolver
        - traefik.http.routers.STACKNAME.service=STACKNAME
        - traefik.http.services.STACKNAME.loadbalancer.server.port=PORT
    networks:
      - oraculusnet_v2

networks:
  oraculusnet_v2:
    external: true
```

**Replace:**
- `IMAGE:TAG` — Docker image (e.g., `node:20-alpine`, `nginx:alpine`)
- `STACKNAME` — stack name WITHOUT `agent-` prefix in router names? NO — use the FULL name including `agent-` (e.g., `agent-myapp`)
- `PORT` — internal port the app listens on
- `KEY=VALUE` — environment variables (add/remove as needed)
- Adjust CPU/memory based on app requirements (within limits)

### Step 3 — Deploy

```javascript
mcp__swarm-deploy__deployStack({
  stackName: "agent-myapp",
  composeContent: "<the compose YAML as string>"
})
```

### Step 4 — Verify

1. Wait ~10 seconds for the stack to start
2. Call `mcp__swarm-deploy__listStacks()` to confirm it appears
3. Call `mcp__swarm-deploy__getServiceLogs({ serviceId: "agent-myapp_app" })` to check for startup errors
4. Inform the user the app is accessible at `https://agent-myapp.digital-ai.tech`
5. Note: Let's Encrypt certificate takes ~30s on first deploy

## Update Workflow

There is no in-place update. To update:
1. `mcp__swarm-deploy__listStacks()` — get the stack ID
2. `mcp__swarm-deploy__removeStack({ stackId: "ID" })` — remove old
3. `mcp__swarm-deploy__deployStack(...)` — deploy with new compose
4. Verify as above

**Warning:** This causes brief downtime. Inform the user.

## Troubleshooting

| Problem | Action |
|---------|--------|
| Stack not starting | Check logs: `getServiceLogs({ serviceId: "agent-name_service" })` |
| 502 Bad Gateway | App not listening on declared port, or still starting. Check logs |
| Certificate error | Let's Encrypt needs ~30s. Wait and retry. Check host rule matches |
| Deploy rejected | Read error message — likely a security rule violation |
| Service crash loop | Check logs for exit codes. Common: missing env vars, wrong port |

## Gotchas

- Service name format in logs: `{stackName}_{serviceName}` (e.g., `agent-myapp_app`)
- YAML must be passed as a raw string, not JSON
- Images must be pullable by the Swarm (public or pre-pushed to registry)
- The Traefik router name in labels must match across all label lines
- Always use the FULL stack name (with `agent-`) in Traefik labels
- `placement.constraints` ensures deployment on the correct Swarm node
