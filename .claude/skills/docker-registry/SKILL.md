---
name: docker-registry
description: "Guia operacional do Docker Registry privado da Digital AI (registry.digital-ai.tech). Use para deploy de imagens, integração de projetos ao CI/CD, rotação de credenciais, diagnóstico, garbage collection e migração do OCIR."
argument-hint: "<operação>: setup-node | integrate-project | push-manual | list-images | garbage-collect | rotate-credentials | migrate-from-ocir | diagnose | deploy"
allowed-tools: Read, Bash, Glob, Grep
---

# Docker Registry — Guia Operacional

Você é um especialista em operações do Docker Registry privado da Digital AI.
Ao ser invocado, leia o contexto completo do registry e guie o usuário na operação solicitada.

## Passo 1 — Carregar contexto

Leia **obrigatoriamente** os três documentos abaixo antes de qualquer ação:

```
/cortex/knowledge/docker-registry/usage-guide.md
/cortex/knowledge/docker-registry/rules.md
/cortex/knowledge/playbooks/docker-registry-r2.md
```

## Passo 2 — Identificar operação

Se o usuário não especificou uma operação, apresente o menu:

```
Operações disponíveis:
  setup-node          → Configurar docker login em um nó Swarm
  integrate-project   → Adicionar GitHub Actions + secrets a novo projeto
  push-manual         → Push manual de imagem para o registry
  list-images         → Listar repositórios e tags disponíveis
  garbage-collect     → Executar garbage collection (liberar espaço no R2)
  rotate-credentials  → Rotação completa de credenciais (htpasswd ou R2)
  migrate-from-ocir   → Migrar projeto do Oracle OCIR para registry privado
  diagnose            → Diagnosticar problemas de push/pull/acesso
  deploy              → Fazer deploy de service usando imagem do registry
```

## Passo 3 — Executar operação

### `setup-node`
Configurar autenticação Docker em um nó do Swarm:

```bash
# Executar no nó via SSH
docker login registry.digital-ai.tech -u USUARIO -p SENHA

# Verificar que ficou salvo
cat ~/.docker/config.json | grep registry.digital-ai.tech
```

- Repetir em **todos os 4 nós** (manager + 3 workers)
- Após login, o nó pode fazer pull de qualquer imagem privada do registry

---

### `integrate-project`
Adicionar um repositório GitHub ao pipeline de CI/CD do registry:

**1. Copiar template de workflow:**
```
/cortex/knowledge/playbooks/docker-registry-r2.md → seção "Fase 5 — GitHub Actions"
```

**2. Adicionar GitHub Secrets no repositório:**
```
Settings → Secrets and variables → Actions

REGISTRY_HOST      = registry.digital-ai.tech
REGISTRY_USER      = USUARIO
REGISTRY_PASSWORD  = SENHA
SWARM_HOST         = vmi1215893.contaboserver.net
SWARM_SSH_USER     = root
SWARM_SSH_KEY      = <chave privada SSH completa>
STACK_NAME         = <nome do stack no Swarm>
SERVICE_NAME       = <nome do service dentro do stack>
```

**3. Atualizar `docker-stack.yml` do projeto:**
```yaml
# Substituir imagem OCIR por:
image: registry.digital-ai.tech/{nome-do-repositorio}:latest
```

**4. Convenção de nomenclatura (obrigatório):**
```
registry.digital-ai.tech/{repo-github}:{tag}

Exemplos:
  registry.digital-ai.tech/claude-code-server:latest
  registry.digital-ai.tech/n8n-worker:v2.1.0
  registry.digital-ai.tech/transcription-service:abc1234
```

---

### `push-manual`
Push manual de imagem (desenvolvimento ou hotfix):

```bash
# Login
docker login registry.digital-ai.tech -u USUARIO -p SENHA

# Build
docker build -t registry.digital-ai.tech/{projeto}:latest .

# Push
docker push registry.digital-ai.tech/{projeto}:latest

# (Opcional) Tag com versão semântica
docker tag registry.digital-ai.tech/{projeto}:latest \
           registry.digital-ai.tech/{projeto}:v1.2.3
docker push registry.digital-ai.tech/{projeto}:v1.2.3
```

---

### `list-images`
Listar conteúdo do registry:

```bash
# Listar todos os repositórios
curl -su USUARIO:SENHA \
  https://registry.digital-ai.tech/v2/_catalog | jq .

# Listar tags de um projeto específico
curl -su USUARIO:SENHA \
  https://registry.digital-ai.tech/v2/{projeto}/tags/list | jq .

# Health check rápido (401 = registry up e requerendo auth)
curl -s -o /dev/null -w "%{http_code}" \
  https://registry.digital-ai.tech/v2/
```

---

### `garbage-collect`
Liberar espaço no R2 removendo layers órfãs:

```bash
# Garbage collection padrão
docker exec $(docker ps -qf name=registry_registry) \
  /bin/registry garbage-collect /etc/docker/registry/config.yml

# Com remoção de manifests sem tag
docker exec $(docker ps -qf name=registry_registry) \
  /bin/registry garbage-collect --delete-untagged \
  /etc/docker/registry/config.yml
```

- Executar mensalmente ou quando R2 aproximar de **8 GB**
- Monitorar uso: Dashboard Cloudflare → R2 → bucket `docker-registry`
- Não remove imagens com tag ativa — apenas blobs órfãos

---

### `rotate-credentials`
Consultar `/cortex/knowledge/docker-registry/rules.md` → seção "Procedimento de rotação de credenciais" para o passo a passo completo.

Resumo dos dois cenários:
- **Rotação htpasswd** (senha do registry): 7 passos, ~5 min de downtime
- **Rotação R2** (API token Cloudflare): 5 passos, sem downtime

⚠️ Docker Secrets não podem ser editados — apenas `rm` + `create`. Planejar janela de manutenção.

---

### `migrate-from-ocir`
Migrar projeto do Oracle OCIR (`sa-saopaulo-1.ocir.io`) para o registry privado:

Consultar `/cortex/knowledge/playbooks/docker-registry-r2.md` → seção "Fase 7 — Migração do OCIR".

Resumo (4 passos por projeto):
1. Adicionar GitHub Secrets do novo registry no repositório
2. Atualizar `.github/workflows/ci.yml` — trocar login OCIR por login do registry privado
3. Atualizar `docker-stack.yml` — trocar imagem `sa-saopaulo-1.ocir.io/...` por `registry.digital-ai.tech/...`
4. Validar por 48h antes de remover secrets OCIR

Manter OCIR ativo durante toda a migração gradual.

---

### `diagnose`
Diagnóstico de problemas comuns:

| Sintoma | Causa provável | Verificação |
|---------|----------------|-------------|
| `unauthorized` no pull | `docker login` não feito no nó | `ssh root@<nó> "cat ~/.docker/config.json \| grep registry"` |
| `InvalidPart` no push | `CHUNKSIZE` não configurado | Verificar env do container registry |
| Cert TLS inválido | Cloudflare proxy (laranja) ativo | Dashboard CF → DNS → `registry.digital-ai.tech` → DNS Only |
| Registry não inicia | Docker Secrets faltando | `docker secret ls \| grep registry_` |
| Pull trava em "Preparing" | `--with-registry-auth` esquecido no service update | Refazer: `docker service update --with-registry-auth ...` |

Logs do registry:
```bash
docker service logs registry_registry --tail 50 --no-trunc
docker service ps registry_registry --no-trunc
```

---

### `deploy`
Fazer deploy ou atualizar service usando imagem do registry:

```bash
# Atualizar service existente com nova imagem
docker service update \
  --image registry.digital-ai.tech/{projeto}:latest \
  --with-registry-auth \
  {stack}_{service}

# Monitorar convergência
docker service ps {stack}_{service}

# Ver logs após update
docker service logs {stack}_{service} --tail 30 -f
```

⚠️ **Sempre incluir `--with-registry-auth`** em `service update` e `stack deploy` — sem isso workers não conseguem fazer pull.

---

## Referências

- Playbook completo: `/cortex/knowledge/playbooks/docker-registry-r2.md`
- Guia de uso: `/cortex/knowledge/docker-registry/usage-guide.md`
- Regras e políticas: `/cortex/knowledge/docker-registry/rules.md`
- PRD do projeto: `/cortex/projects/docker-registry/prd.md`

## Infra de referência

| Item | Valor |
|------|-------|
| Registry URL | `registry.digital-ai.tech` |
| Servidor manager | `vmi1215893.contaboserver.net` |
| Nós Swarm | 4 (1 manager + 3 workers) |
| Storage backend | Cloudflare R2 — bucket `docker-registry` |
| Stack name | `registry` |
| Service name | `registry_registry` |
| DNS | Cloudflare — modo **DNS Only** (nunca proxied) |
