---
description: Inicializa novo projeto com estrutura Spec-Driven completa (.specify/, templates, scripts) ou projeto em branco. Funciona em qualquer instancia Cortex sem dependencia de repositorios externos.
---

## User Input

```text
$ARGUMENTS
```

## Outline

### Step 1 - Capturar parametros

Se `$ARGUMENTS` estiver vazio, perguntar ao usuario:
1. **Nome do projeto** (kebab-case, ex: `meu-projeto`)
2. **Tipo de inicializacao:**
   - `[1] Scaffold completo` - Spec-Driven Development com todos os templates, scripts e estrutura pre-configurada
   - `[2] Projeto em branco` - Apenas CLAUDE.md e estrutura minima

Se argumentos fornecidos, parse como: `<nome> [full|blank]`

### Step 2 - Verificar workspace

Verificar se `.specify/` ou `CLAUDE.md` ja existem em `/workspace`.
Se sim, perguntar confirmacao antes de continuar.

### Step 3A - Scaffold Completo

Criar a seguinte estrutura em `/workspace`:

#### `.specify/templates/`

Copiar templates de `$CORTEX_PATH/shared/.claude/templates/specify/` se existirem.
Se nao existirem, criar inline os 6 templates padrao:

- **constitution-template.md** - constituicao (versao, principios, escopo, stack)
- **spec-template.md** - spec de feature (user stories, requisitos P1/P2/P3, criterios de aceite)
- **tasks-template.md** - tasks (fases, paralelas com [P], dependencias)
- **plan-template.md** - plano tecnico (componentes, APIs, data model)
- **agent-file-template.md** - template para agente customizado
- **checklist-template.md** - checklist de validacao

#### `.specify/scripts/bash/`

Copiar de `$CORTEX_PATH/shared/.specify/scripts/bash/` para `.specify/scripts/bash/` com chmod +x:
- common.sh, create-new-feature.sh, setup-plan.sh, check-prerequisites.sh, update-agent-context.sh

Se os scripts nao existirem no Cortex, criar inline os 3 essenciais (common.sh, create-new-feature.sh, setup-plan.sh).

#### `CLAUDE.md` (somente se nao existir)

Template com: Project Overview, Stack, Architecture, Development Workflow.
Substituir `<NOME_DO_PROJETO>` pelo nome real.

### Step 3B - Projeto em Branco

Criar apenas CLAUDE.md basico e sugerir proximos passos.

### Step 4 - Oferecer inicializacao no Cortex

Perguntar se deseja rodar `/cortex.init` agora.

### Step 5 - Reportar resultado

Listar arquivos criados e sugerir: `/speckit.constitution` -> `/speckit.specify` -> `/cortex.sync`

## Notas

- Templates canonicos em `$CORTEX_PATH/shared/.claude/templates/specify/`
- Funciona em todas as instancias Cortex sem dependencia de GitHub privado
- Agentes core ja sao seedados automaticamente via setupEnvironment - nao duplicar
