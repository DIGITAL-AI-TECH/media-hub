---
name: user-manager
description: Gerencia usuários do Cortex com autenticação via Discord ID. Cria, lista, valida e remove usuários. Cada usuário é vinculado a um Discord ID — único mecanismo de autenticação aceito.
argument-hint: "create | validate <discord_id> | list | remove <slug>"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# User Manager — Gestão de Usuários com Auth Discord

Gerencia usuários do Claude Code Server da Digital AI. A autenticação é feita
exclusivamente via **Discord ID** — se o ID não estiver registrado, o acesso é negado.

## Protocolo de Autenticação Discord (OBRIGATÓRIO para todos os agentes)

Quando a sessão contém `Contexto Discord` com um `Discord ID` no system prompt:

1. Ler `/cortex/users/_registry.md`
2. Buscar coluna `Discord ID` que bata com o ID da sessão atual
3. **Não encontrado** → Responder IMEDIATAMENTE:
   > "Acesso não autorizado. Seu Discord ID não está registrado no sistema.
   > Contate um administrador para solicitar acesso."
   > **Encerrar sem executar nenhuma tarefa.**
4. **Encontrado** → Identificar `slug` e `role`, definir Session Context:
   - `User: <slug>` | `Role: admin | user`
5. **Role `user`** → Só executar tarefas dentro de `users/<slug>/` — recusar qualquer
   acesso a `clients/`, `projects/`, `secrets/org/`, `secrets/clients/`, etc.
6. **Role `admin`** → Acesso irrestrito a todo o Cortex

**Esta verificação é AUTOMÁTICA** — não espere o usuário pedir. Se há Discord ID na sessão,
valide antes de qualquer outra coisa.

---

## Sub-comandos

### `create` — Criar novo usuário

Dados necessários (perguntar ao usuário se não fornecidos como args):
- Nome completo
- Discord username (ex: `joaosilva`)
- Discord ID (número, ex: `987654321012345678`)
- Role: `admin` ou `user`
- Slug (opcional — gerar automaticamente: nome em lowercase sem espaços/acentos)

**Passos de execução:**

#### 1. Gerar slug se não fornecido
Slug = nome em lowercase, sem acentos, espaços viram hífen.
Ex: "João Silva" → `joao-silva`

#### 2. Verificar duplicidade
Ler `/cortex/users/_registry.md` — verificar se slug OU discord_id já existem.
Se sim: avisar e abortar.

#### 3. Criar `users/<slug>/profile.md`
```markdown
---
type: user-profile
slug: <slug>
name: <nome>
role: <admin|user>
discord_id: "<discord_id>"
discord_username: <discord_username>
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
tags: [user, <role>]
---

# <Nome>

**Role**: <role>
**Discord**: <discord_username> (ID: <discord_id>)

## Espaços Pessoais

| Recurso | Path |
|---------|------|
| Vault | `users/<slug>/vault/` |
| Espaço pessoal | `users/<slug>/personal/` |
| Secrets pessoais | `secrets/users/<slug>/` |

## Acesso

<Se admin>: Acesso irrestrito a todo o Cortex.
<Se user>: Acesso restrito ao próprio espaço em `users/<slug>/`.
```

#### 4. Criar estrutura de diretórios
```bash
mkdir -p /cortex/users/<slug>/vault/_pipeline/inbox
mkdir -p /cortex/users/<slug>/personal
mkdir -p /cortex/secrets/users/<slug>
```

Criar `/cortex/users/<slug>/vault/README.md`:
```markdown
# Vault — <Nome>
Vault pessoal de <Nome>. Usar inbox em `_pipeline/inbox/` para novas notas.
```

Criar `/cortex/users/<slug>/personal/README.md`:
```markdown
# Espaço Pessoal — <Nome>
Agenda, notas e arquivos pessoais de <Nome>.
```

Criar `/cortex/secrets/users/<slug>/README.md`:
```markdown
# Secrets Pessoais — <Nome>
Credenciais e tokens pessoais de <Nome>. Acesso exclusivo do próprio usuário (ou admin).
```

#### 5. Atualizar `users/_registry.md`
Adicionar nova linha na tabela (manter formato com discord_id):
```
| <slug> | <nome> | <role> | <discord_username> | <discord_id> | ativo |
```

#### 6. Commit + push
```bash
cd /cortex
git add users/<slug>/ secrets/users/<slug>/ users/_registry.md
git commit -m "cortex: add user <slug> (<role>)"
GITHUB_PAT=$(grep -o 'ghp_[A-Za-z0-9]*' /cortex/secrets/github.env 2>/dev/null | head -1)
REMOTE=$(git remote get-url origin | sed "s|https://|https://${GITHUB_PAT}@|")
git push "$REMOTE" main
```

#### 7. Confirmar ao admin
Reportar: slug criado, role, Discord ID registrado, paths criados.

---

### `validate <discord_id>` — Verificar acesso

Ler `/cortex/users/_registry.md`, buscar linha com `discord_id` fornecido.

**Retornar:**
```
✅ Usuário autorizado
- Nome: <nome>
- Slug: <slug>
- Role: <role>
- Status: ativo
```
ou:
```
❌ Discord ID <id> não encontrado no sistema.
Acesso não autorizado.
```

---

### `list` — Listar usuários

Ler `/cortex/users/_registry.md` e apresentar tabela formatada com todos os usuários ativos.
Incluir: Slug, Nome, Role, Discord Username, Status.
Não exibir Discord IDs completos para usuários com role `user` (segurança).

---

### `remove <slug>` — Remover usuário (admin only)

1. Verificar se quem pediu tem role `admin` — se não, recusar
2. Ler `/cortex/users/_registry.md`
3. Alterar status do slug para `inativo`
4. Adicionar campo `deactivated: <data>` no `users/<slug>/profile.md`
5. **NÃO apagar arquivos** — apenas desativar
6. Commit + push com mensagem: `cortex: deactivate user <slug>`

---

## Formato do `users/_registry.md`

A tabela deve SEMPRE ter estas colunas (atualizar se formato antigo):

```markdown
| Slug | Nome | Role | Discord User | Discord ID | Status |
|------|------|------|-------------|-----------|--------|
| matheus | Matheus Terra | admin | matheusterra | 271103075933093888 | ativo |
```

---

## Quando esta skill é invocada automaticamente

- Pedido de "criar usuário", "adicionar membro", "cadastrar no sistema"
- Pedido de "validar acesso", "verificar Discord", "tem permissão?"
- Pedido de "listar usuários", "quem tem acesso"
- Pedido de "remover usuário", "revogar acesso"
- **Automaticamente**: ao iniciar sessão com Discord ID no contexto — validar ANTES de qualquer tarefa
