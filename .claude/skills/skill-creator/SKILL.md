---
name: skill-creator
description: Create new Claude Code skills and register them in Cortex for all agents. Use when the user asks to create a new skill, command, or reusable workflow that should be available across all agents and sessions.
argument-hint: "[skill-name] [description]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Skill Creator — Cortex-Integrated

You are creating a new Claude Code skill that will be shared across all Cortex agents.

## Input

The user will provide:
- **Skill name**: kebab-case identifier (e.g. `deploy-checker`, `code-review`)
- **Description**: What the skill does and when to use it
- **Instructions**: What the skill should do when invoked

Parse these from `$ARGUMENTS` if provided, otherwise ask the user.

## Steps

### 1. Gather Requirements

If not provided via arguments, ask:
- Skill name (kebab-case, e.g. `my-skill`)
- One-line description (shown in `/` menu and used for auto-invocation matching)
- Should it be user-invocable, model-invocable, or both?
- Which tools does it need? (Read, Write, Edit, Grep, Glob, Bash, WebSearch, WebFetch)
- Should it run in a forked context? (`context: fork`)

### 2. Create the Skill Directory

Skills are stored at: `${CORTEX_PATH}/shared/.claude/skills/<skill-name>/`

Create:
```
<skill-name>/
├── SKILL.md          # Required: frontmatter + instructions
└── (optional supporting files)
```

### 3. Write SKILL.md

Use this template:

```markdown
---
name: <skill-name>
description: <one-line description for auto-invocation matching>
argument-hint: "<expected arguments>"
allowed-tools: <comma-separated tool list>
# Optional:
# context: fork                    # Run in isolated subagent
# agent: <agent-type>              # Which subagent type (Explore, Plan, etc.)
# disable-model-invocation: true   # Only user can trigger
# user-invocable: false            # Only Claude auto-triggers
---

<Detailed instructions for what the skill does>
```

### 4. Register in Cortex

After creating the skill files, update the Cortex skills registry:

**File**: `${CORTEX_PATH}/shared/.claude/skills/_registry.md`

Add an entry:
```markdown
### <skill-name>
- **Description**: <description>
- **Path**: `shared/.claude/skills/<skill-name>/`
- **Invocation**: user / model / both
- **Added**: <date>
```

### 5. Commit to Cortex

```bash
cd ${CORTEX_PATH}
git add shared/.claude/skills/<skill-name>/
git add shared/.claude/skills/_registry.md
git commit -m "feat(skills): add <skill-name> skill"
git push origin ${CORTEX_BRANCH:-main}
```

### 6. Confirm

Tell the user:
- Skill `/<skill-name>` created successfully
- Available in all future worker sessions (seeded from Cortex on startup)
- Can be tested immediately with `/<skill-name> <args>`
- Location: `${CORTEX_PATH}/shared/.claude/skills/<skill-name>/SKILL.md`

## Important Notes

- Keep SKILL.md under 500 lines — move bulk content to supporting files
- Skill descriptions are loaded into context budget (~2% of context window)
- Keep descriptions short and specific to avoid context waste
- Skills in Cortex `shared/` are seeded to ALL worker sessions automatically
- Workspace-local skills (`.claude/skills/`) take precedence over Cortex skills
