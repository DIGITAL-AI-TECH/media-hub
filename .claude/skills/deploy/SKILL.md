---
name: deploy
description: Configura CI/CD completo para novo projeto na Digital AI ou TrendsOn — Reusable Workflow, DNS Cloudflare automático, Docker Swarm. Use quando criar ou configurar deploy de qualquer projeto.
argument-hint: "[nome-do-projeto] [dominio] [digital-ai|trendson]"
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, WebFetch
---

# Deploy — Estrutura CI/CD Digital AI & TrendsOn

Guia completo para configurar o deploy automático de qualquer projeto.
Push para `master` → build → CNAME Cloudflare automático → deploy no Swarm → HTTPS via Traefik.

## Seleção de Domínio / Cluster

Ao usar esta skill, defina **qual domínio** o projeto vai usar:

| Parâmetro | Digital AI | TrendsOn |
|-----------|-----------|---------|
| **Domínio base** | `digital-ai.tech` | `trendsoninfluence.com` |
| **Servidor** | `vmi1215893.contaboserver.net` (185.213.26.130) | `34.233.220.133` (AWS EC2) |
| **DNS target** | CNAME → `vps.digital-ai.tech` | A record → `34.233.220.133` |
| **CF Secret: token** | `CF_API_TOKEN` | `CF_API_TOKEN_TRENDSON` |
| **CF Secret: zone** | `CF_ZONE_ID` | `CF_ZONE_ID_TRENDSON` |
| **Runner labels** | `[self-hosted, swarm]` | `[self-hosted, trendson]` |
| **Credenciais CF** | `/cortex/secrets/org/cloudflare.env` → `CF_API_TOKEN` | `/cortex/secrets/org/cloudflare.env` → `CF_API_TOKEN_TRENDSON` |

## Infra de Referência — Digital AI

| Item | Valor |
|------|-------|
| Servidor | `vmi1215893.contaboserver.net` (185.213.26.130) |
| Registry | `registry.digital-ai.tech` |
| Runner labels | `[self-hosted, swarm]` |
| Rede Swarm | `oraculusnet_v2` |
| Certresolver Traefik | `letsencryptresolver` |
| DNS CNAME target | `vps.digital-ai.tech` |
| Reusable Workflow | `DIGITAL-AI-TECH/workflows/.github/workflows/deploy-swarm.yml@main` |
| Playbook completo | `/cortex/knowledge/playbooks/cicd-reusable-workflow.md` |
| Branch padrão | `master` (não `main`) |
| Org GitHub | `DIGITAL-AI-TECH` (maiúsculas — case-sensitive) |

## Infra de Referência — TrendsOn

| Item | Valor |
|------|-------|
| Servidor | `34.233.220.133` (AWS EC2) |
| Registry | `registry.digital-ai.tech` (compartilhado) |
| Runner labels | `[self-hosted, trendson]` |
| Certresolver Traefik | `letsencryptresolver` |
| DNS target | A record direto para `34.233.220.133` |
| Branch padrão | `master` |
| Org GitHub | `DIGITAL-AI-TECH` |

---

## Dois Padrões de Workflow

### Padrão A — Serviço único (genérico)
Projeto com um Dockerfile → Reusable Workflow ou 3 jobs inline simples.

### Padrão B — Monorepo com múltiplos serviços (ex: transcription-service)
Múltiplos Dockerfiles → builds seletivos por serviço + first-deploy detection.
**Referência canônica:** `DIGITAL-AI-TECH/transcription-service/.github/workflows/docker-build-push.yml`

---

## Checklist de Onboarding — Novo Projeto

- [ ] Criar repositório em `DIGITAL-AI-TECH` com branch `master` como default
- [ ] Criar `deploy-config.yml` com domínios e stack name
- [ ] Criar `docker-stack.yml` com Traefik labels padrão
- [ ] Criar `.github/workflows/ci.yml` (ou `docker-build-push.yml`)
- [ ] Cadastrar Repository Secrets específicos no GitHub (incluindo `DISCORD_WEBHOOK_URL`)
- [ ] Confirmar Org Secrets configurados (ver seção abaixo)
- [ ] Push para `master` — deploy automático acontece

---

## Arquivo 1: `deploy-config.yml`

```yaml
# deploy-config.yml — metadados de deploy (não contém secrets)
stack_name: meu-app
service_name: api        # nome do service no docker-stack.yml

# Domínios — CI/CD cria CNAME automaticamente na Cloudflare
# OBRIGATÓRIO: proxied: false → DNS Only (senão Let's Encrypt quebra)
domains:
  - meu-app.digital-ai.tech

dockerfile: Dockerfile
run_tests: false
```

---

## Arquivo 2A: `docker-stack.yml` — Digital AI (`digital-ai.tech`)

```yaml
services:
  api:
    image: registry.digital-ai.tech/digital-ai/meu-app:latest
    networks:
      - oraculusnet_v2
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      labels:
        - "traefik.enable=true"
        - "traefik.http.routers.meu-app.rule=Host(`meu-app.digital-ai.tech`)"
        - "traefik.http.routers.meu-app.entrypoints=websecure"
        - "traefik.http.routers.meu-app.tls.certresolver=letsencryptresolver"
        - "traefik.http.routers.meu-app.service=meu-app"
        - "traefik.http.services.meu-app.loadbalancer.server.port=8000"
        - "traefik.docker.network=oraculusnet_v2"

networks:
  oraculusnet_v2:
    external: true
```

## Arquivo 2B: `docker-stack.yml` — TrendsOn (`trendsoninfluence.com`)

```yaml
services:
  api:
    image: registry.digital-ai.tech/digital-ai/meu-app:latest
    networks:
      - trendsonnet_v2
    deploy:
      replicas: 1
      restart_policy:
        condition: on-failure
      update_config:
        parallelism: 1
        delay: 10s
        order: start-first
      labels:
        - "traefik.enable=true"
        - "traefik.docker.network=trendsonnet_v2"                              # OBRIGATÓRIO — Traefik default é trendsonnet
        - "traefik.http.routers.meu-app.rule=Host(`meu-app.trendsoninfluence.com`)"
        - "traefik.http.routers.meu-app.entrypoints=websecure"
        - "traefik.http.routers.meu-app.tls.certresolver=letsencryptresolver"
        - "traefik.http.routers.meu-app.service=meu-app"
        - "traefik.http.services.meu-app.loadbalancer.server.port=8000"

networks:
  trendsonnet_v2:
    external: true
```

**Regras das labels Traefik:**
- `router name` = kebab-case do app (ex: `meu-app`) — deve ser único no Swarm
- `server.port` = porta interna do container (não a do host)
- `traefik.docker.network` obrigatório quando container está em múltiplas redes
- **TrendsOn**: `traefik.docker.network=trendsonnet_v2` é CRÍTICO — sem isso o Traefik usa `trendsonnet` como padrão e não encontra o container

---

## Arquivo 3: `.github/workflows/ci.yml` (Padrão A — serviço único)

```yaml
name: CI/CD

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  deploy:
    uses: DIGITAL-AI-TECH/workflows/.github/workflows/deploy-swarm.yml@main
    with:
      app_name: meu-app          # nome da imagem no registry
      stack_name: meu-app        # nome do stack no Swarm
      service_name: api          # nome do service dentro do stack
      # dns_target: vps.digital-ai.tech  # default, não precisa mudar
    secrets: inherit             # propaga Org Secrets automaticamente
```

**Para deploy no cluster TrendsOn**, adicionar os parâmetros de DNS e runner:

```yaml
name: CI/CD

on:
  push:
    branches: [master]
  workflow_dispatch:

jobs:
  build-push:
    runs-on: [self-hosted, trendson]     # runner do cluster TrendsOn
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: registry.digital-ai.tech
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}
      - uses: docker/build-push-action@v6
        with:
          context: .
          push: true
          tags: |
            registry.digital-ai.tech/digital-ai/meu-app:latest
            registry.digital-ai.tech/digital-ai/meu-app:${{ github.sha }}

  dns-sync:
    runs-on: ubuntu-latest
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - name: Sync DNS TrendsOn (registro tipo A)
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN_TRENDSON }}
          CF_ZONE_ID: ${{ secrets.CF_ZONE_ID_TRENDSON }}
        run: |
          python3 << 'EOF'
          import os, json, urllib.request
          cf_token = os.environ['CF_API_TOKEN']
          zone_id  = os.environ['CF_ZONE_ID']
          target   = '34.233.220.133'        # IP direto do cluster TrendsOn
          domains  = ['meu-app.trendsoninfluence.com']
          headers = {'Authorization': f'Bearer {cf_token}', 'Content-Type': 'application/json'}
          for domain in domains:
              url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records?name={domain}&type=A'
              req = urllib.request.Request(url, headers=headers)
              with urllib.request.urlopen(req) as resp:
                  data = json.loads(resp.read())
              payload = json.dumps({'type':'A','name':domain,'content':target,'proxied':False,'ttl':3600}).encode()
              records = data.get('result', [])
              if records:
                  url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{records[0]["id"]}'
                  req = urllib.request.Request(url, data=payload, headers=headers, method='PUT')
                  print(f'Atualizando A: {domain} → {target}')
              else:
                  url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records'
                  req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
                  print(f'Criando A: {domain} → {target}')
              with urllib.request.urlopen(req) as resp:
                  result = json.loads(resp.read())
              print(f'  {"✓" if result.get("success") else "✗"} {domain}')
          EOF

  deploy:
    needs: [build-push, dns-sync]
    runs-on: [self-hosted, trendson]     # runner do cluster TrendsOn
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: registry.digital-ai.tech
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}
      - name: Deploy no Swarm TrendsOn
        run: |
          STACK="meu-app"
          STACK_EXISTS=$(docker stack ls --format '{{.Name}}' | grep -qx "${STACK}" && echo "true" || echo "false")
          if [ "$STACK_EXISTS" = "false" ] || [ "${{ github.event_name }}" = "workflow_dispatch" ]; then
            docker stack deploy -c docker-stack.yml "${STACK}" --with-registry-auth
          else
            docker service update \
              --image registry.digital-ai.tech/digital-ai/meu-app:${{ github.sha }} \
              --with-registry-auth \
              "${STACK}_api"
          fi
      - name: Notificar Discord
        if: always()
        env:
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK_URL }}
          RUN_STATUS: ${{ job.status }}
        run: |
          COLOR=$([ "$RUN_STATUS" = "success" ] && echo 3066993 || echo 15158332)
          ICON=$([ "$RUN_STATUS" = "success" ] && echo "✅" || echo "❌")
          PAYLOAD=$(jq -n --arg title "$ICON Deploy $RUN_STATUS — meu-app (TrendsOn)" --argjson color $COLOR \
            --arg commit "${{ github.sha }}" --arg actor "${{ github.actor }}" \
            '{embeds:[{title:$title,color:$color,fields:[{name:"Commit",value:$commit,inline:true},{name:"Actor",value:$actor,inline:true}]}]}')
          curl -s -X POST "$DISCORD_WEBHOOK" -H "Content-Type: application/json" -d "$PAYLOAD"
```

---

## Arquivo 3B: `docker-build-push.yml` (Padrão B — monorepo multi-serviço)

Para projetos com múltiplos serviços no mesmo repo (builds seletivos, first-deploy detection).

```yaml
name: Build, Push & Deploy

on:
  push:
    branches: [master]
  workflow_dispatch:

env:
  REGISTRY: registry.digital-ai.tech
  REPO_PREFIX: nome-do-projeto   # prefixo das imagens: registry/nome-do-projeto/servico:tag
  STACK: nome-do-stack           # nome do stack no Swarm

jobs:
  # ─── Detectar quais serviços mudaram ──────────────────────────────────────
  changes:
    runs-on: ubuntu-latest
    outputs:
      servico-a: ${{ steps.filter.outputs.servico-a }}
      servico-b: ${{ steps.filter.outputs.servico-b }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            servico-a:
              - 'services/servico-a/**'
            servico-b:
              - 'services/servico-b/**'

  # ─── Build seletivo por serviço ────────────────────────────────────────────
  build-servico-a:
    needs: [changes]
    runs-on: [self-hosted, swarm]
    if: needs.changes.outputs.servico-a == 'true' && github.event_name == 'push'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}
      - uses: docker/build-push-action@v6
        with:
          context: services/servico-a/
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ env.REPO_PREFIX }}/servico-a:latest
            ${{ env.REGISTRY }}/${{ env.REPO_PREFIX }}/servico-a:${{ github.sha }}
          cache-from: type=gha,scope=servico-a
          cache-to: type=gha,mode=max,scope=servico-a

  # ─── DNS Sync ─────────────────────────────────────────────────────────────
  # continue-on-error: true — falha de CF não bloqueia deploy (DNS pode já estar ok)
  dns-sync:
    runs-on: ubuntu-latest
    if: github.event_name == 'push'
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - name: Sync DNS no Cloudflare
        env:
          CF_API_TOKEN: ${{ secrets.CF_API_TOKEN }}
          CF_ZONE_ID: ${{ secrets.CF_ZONE_ID }}
        run: |
          python3 << 'EOF'
          import os, json, urllib.request
          with open('deploy-config.yml') as f:
              content = f.read()
          domains = []
          in_domains = False
          for line in content.split('\n'):
              stripped = line.strip()
              if stripped == 'domains:':
                  in_domains = True
              elif in_domains:
                  if stripped.startswith('- '):
                      domains.append(stripped[2:])
                  elif stripped and not line.startswith(' '):
                      break
          cf_token = os.environ['CF_API_TOKEN']
          zone_id  = os.environ['CF_ZONE_ID']
          target   = 'vps.digital-ai.tech'
          headers = {'Authorization': f'Bearer {cf_token}', 'Content-Type': 'application/json'}
          for domain in domains:
              url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records?name={domain}&type=CNAME'
              req = urllib.request.Request(url, headers=headers)
              with urllib.request.urlopen(req) as resp:
                  data = json.loads(resp.read())
              payload = json.dumps({'type':'CNAME','name':domain,'content':target,'proxied':False,'ttl':3600}).encode()
              records = data.get('result', [])
              if records:
                  url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records/{records[0]["id"]}'
                  req = urllib.request.Request(url, data=payload, headers=headers, method='PUT')
                  print(f'Atualizando CNAME: {domain} → {target}')
              else:
                  url = f'https://api.cloudflare.com/client/v4/zones/{zone_id}/dns_records'
                  req = urllib.request.Request(url, data=payload, headers=headers, method='POST')
                  print(f'Criando CNAME: {domain} → {target}')
              with urllib.request.urlopen(req) as resp:
                  result = json.loads(resp.read())
              if result.get('success'):
                  print(f'  ✓ {domain} OK')
              else:
                  print(f'  ✗ {domain} FALHOU: {result.get("errors")}')
                  raise SystemExit(1)
          EOF
```

> **TrendsOn:** Para projetos em `trendsoninfluence.com`, usar `CF_API_TOKEN_TRENDSON` e `CF_ZONE_ID_TRENDSON` nas env vars do step. O `target` deve ser `34.233.220.133` e o tipo do record deve ser `A` (não CNAME).

```yaml
  # ─── Deploy ────────────────────────────────────────────────────────────────
  deploy:
    needs: [changes, build-servico-a, build-servico-b, dns-sync]
    runs-on: [self-hosted, swarm]
    if: >
      always() &&
      !contains(needs.*.result, 'failure') &&
      !contains(needs.*.result, 'cancelled')
    env:
      # Todos os env vars do docker-stack.yml passados como secrets
      MINHA_VAR: ${{ secrets.MINHA_VAR }}
      # ... todos os outros secrets
      DISCORD_WEBHOOK_URL: ${{ secrets.DISCORD_WEBHOOK_URL }}   # obrigatório para notificação
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ secrets.REGISTRY_USER }}
          password: ${{ secrets.REGISTRY_PASSWORD }}

      - name: Deploy no Swarm
        run: |
          set -e
          STACK="${{ env.STACK }}"
          SHA="${{ github.sha }}"
          EVENT="${{ github.event_name }}"
          REGISTRY="${{ env.REGISTRY }}"
          REPO_PREFIX="${{ env.REPO_PREFIX }}"

          update_service() {
            local svc="$1" image="$2"
            echo "==> Verificando: $image"
            if docker pull "$image" > /dev/null 2>&1; then
              docker service update --image "$image" --with-registry-auth "${STACK}_${svc}"
              echo "==> ${svc}: atualizado."
            else
              echo "==> ${svc}: sem imagem nova. Pulando."
            fi
          }

          # Detecta se é primeiro deploy ou atualização incremental
          STACK_EXISTS=$(docker stack ls --format '{{.Name}}' | grep -qx "${STACK}" && echo "true" || echo "false")

          if [ "$STACK_EXISTS" = "false" ] || [ "$EVENT" = "workflow_dispatch" ]; then
            # Primeiro deploy ou redeploy manual → sobe tudo com :latest
            echo "==> $( [ "$STACK_EXISTS" = "false" ] && echo "PRIMEIRO DEPLOY" || echo "REDEPLOY MANUAL" )"
            export VERSION=latest
            docker stack deploy -c docker-stack.yml "${STACK}" --with-registry-auth
            echo "==> Stack '${STACK}' deployado."
          else
            # Deploy incremental → só atualiza serviços com imagem nova no SHA
            echo "==> DEPLOY INCREMENTAL — commit: ${SHA:0:7}"
            update_service "servico-a" "${REGISTRY}/${REPO_PREFIX}/servico-a:${SHA}"
            update_service "servico-b" "${REGISTRY}/${REPO_PREFIX}/servico-b:${SHA}"
          fi

          docker stack ps "${STACK}" --filter "desired-state=running" \
            --format "table {{.Name}}\t{{.Image}}\t{{.CurrentState}}"

      # ─── Notificação Discord (OBRIGATÓRIO em todo deploy) ─────────────────
      # ATENÇÃO: usar jq para construir o JSON — evita erro 50109 por caracteres
      # especiais ou newlines no commit message (Co-Authored-By, etc.)
      - name: Notificar Discord
        if: always()
        env:
          DISCORD_WEBHOOK: ${{ secrets.DISCORD_WEBHOOK_URL }}
          RUN_STATUS: ${{ job.status }}
          COMMIT_SHA: ${{ github.sha }}
          COMMIT_MSG: ${{ github.event.head_commit.message }}
          ACTOR: ${{ github.actor }}
          EVENT: ${{ github.event_name }}
        run: |
          if [ "$RUN_STATUS" = "success" ]; then
            COLOR=3066993; STATUS_ICON="✅"; STATUS_TEXT="Deploy concluído"
          else
            COLOR=15158332; STATUS_ICON="❌"; STATUS_TEXT="Deploy falhou"
          fi

          SHORT_SHA="${COMMIT_SHA:0:7}"
          # head -1: apenas a primeira linha do commit message (evita newlines no JSON)
          MSG=$(echo "${COMMIT_MSG:-redeploy manual}" | head -1)

          # jq constrói o JSON com escaping correto (aspas, newlines, chars especiais)
          PAYLOAD=$(jq -n \
            --arg title "${STATUS_ICON} ${STATUS_TEXT} — ${{ env.STACK }}" \
            --argjson color "$COLOR" \
            --arg commit "\`${SHORT_SHA}\`" \
            --arg trigger "$EVENT" \
            --arg actor "$ACTOR" \
            --arg msg "$MSG" \
            '{embeds:[{title:$title,color:$color,fields:[
              {name:"Commit",value:$commit,inline:true},
              {name:"Trigger",value:$trigger,inline:true},
              {name:"Actor",value:$actor,inline:true},
              {name:"Mensagem",value:$msg,inline:false}
            ]}]}')

          curl -s -X POST "$DISCORD_WEBHOOK" \
            -H "Content-Type: application/json" \
            -d "$PAYLOAD"
```

---

## Projetos com Build Customizado (ex: PayloadCMS/Next.js)

Quando o Dockerfile precisa de ARGs especiais em tempo de build (ex: PayloadCMS/Next.js que requer Postgres durante `next build`), usar jobs inline.

**Referência:** `DIGITAL-AI-TECH/pibi/.github/workflows/deploy.yml`

Padrão do job `build-push` customizado:
```yaml
- name: Iniciar Postgres de build
  run: |
    docker stop pibi-build-db 2>/dev/null || true
    docker rm pibi-build-db 2>/dev/null || true
    docker run -d --name pibi-build-db \
      -e POSTGRES_DB=app -e POSTGRES_USER=app \
      -e POSTGRES_PASSWORD=buildonly \
      -p 5433:5432 postgres:16-alpine
    for i in $(seq 1 15); do
      docker exec pibi-build-db pg_isready -U app && break || sleep 2
    done

- name: Build & Push
  run: |
    docker build \
      --network host \
      --build-arg DATABASE_URI=postgresql://app:buildonly@localhost:5433/app \
      --build-arg PAYLOAD_SECRET=build-time-placeholder-do-not-use-in-prod \
      -t registry.digital-ai.tech/digital-ai/meu-app:latest \
      -t registry.digital-ai.tech/digital-ai/meu-app:${{ github.sha }} .
    docker push registry.digital-ai.tech/digital-ai/meu-app:latest
    docker push registry.digital-ai.tech/digital-ai/meu-app:${{ github.sha }}
```

O step `dns-sync`, job `deploy` e step `Notificar Discord` são sempre iguais — copiar do padrão B.

---

## GitHub Secrets

### Org Secrets (configurados uma vez, herdados por todos os projetos)

| Secret | Descrição | Onde configurar |
|--------|-----------|----------------|
| `CF_API_TOKEN` | Token API Cloudflare com permissão `Zone:DNS:Edit` | [github.com/organizations/DIGITAL-AI-TECH/settings/secrets/actions](https://github.com/organizations/DIGITAL-AI-TECH/settings/secrets/actions) |
| `CF_ZONE_ID` | Zone ID do domínio `digital-ai.tech` na Cloudflare | Idem |
| `REGISTRY_USER` | `digital-ai` | Idem |
| `REGISTRY_PASSWORD` | Ver `/cortex/secrets/docker-registry.env` | Idem |

**Como obter CF_ZONE_ID:** Cloudflare dashboard → `digital-ai.tech` → Overview → barra lateral direita → caixa "API" → Zone ID

**Como obter CF_API_TOKEN:** Cloudflare → perfil → API Tokens → Create Token → template "Edit zone DNS" → Zone: `digital-ai.tech` → criar

> ⚠️ **Status atual (2026-03-11):** `CF_API_TOKEN` e `CF_ZONE_ID` têm visibility "all" no org mas os valores podem estar vazios. Se dns-sync falhar, adicionar `continue-on-error: true` no job — o DNS pode já estar configurado corretamente.

### Org Secrets Adicionais — TrendsOn

| Secret | Descrição | Valor |
|--------|-----------|-------|
| `CF_API_TOKEN_TRENDSON` | Token API Cloudflare para zona `trendsoninfluence.com` | Ver `/cortex/secrets/org/cloudflare.env` |
| `CF_ZONE_ID_TRENDSON` | Zone ID do domínio `trendsoninfluence.com` | `a4842cee6de93dd3f892258b11f4b40d` |
| `CF_ACCOUNT_ID_TRENDSON` | Account ID Cloudflare da conta TrendsOn | `1f2d1c78cb24552be14a76a90624f879` |

### Repo Secrets (por projeto)

Cadastrar em `https://github.com/DIGITAL-AI-TECH/<repo>/settings/secrets/actions`:
- DB passwords, API keys, app secrets específicos
- **`DISCORD_WEBHOOK_URL`** — obrigatório para notificações de deploy (Discord webhook da sala do projeto)
- Ex: `PIBI_DB_PASSWORD`, `PIBI_PAYLOAD_SECRET`, `PIBI_S3_ACCESS_KEY`...

### Configurar Secrets via Script Python (GitHib API + PyNaCl)

Para projetos com muitos secrets (ex: 30+), usar script automatizado:
```bash
pip install pynacl -q

python3 << 'EOF'
import json, base64, urllib.request
from nacl import encoding, public

GITHUB_PAT = "..."   # ler de /cortex/secrets/github.env
REPO = "DIGITAL-AI-TECH/nome-do-repo"

url = f"https://api.github.com/repos/{REPO}/actions/secrets/public-key"
req = urllib.request.Request(url, headers={"Authorization": f"Bearer {GITHUB_PAT}", "Accept": "application/vnd.github+json"})
with urllib.request.urlopen(req) as resp:
    pk_data = json.loads(resp.read())

pk = public.PublicKey(pk_data["key"].encode(), encoding.Base64Encoder())
box = public.SealedBox(pk)

def set_secret(name, value):
    encrypted = base64.b64encode(box.encrypt(value.encode())).decode()
    payload = json.dumps({"encrypted_value": encrypted, "key_id": pk_data["key_id"]}).encode()
    url = f"https://api.github.com/repos/{REPO}/actions/secrets/{name}"
    req = urllib.request.Request(url, data=payload,
        headers={"Authorization": f"Bearer {GITHUB_PAT}", "Accept": "application/vnd.github+json",
                 "Content-Type": "application/json"}, method="PUT")
    with urllib.request.urlopen(req) as resp:
        print(f"  {name}: HTTP {resp.status}")

secrets = {
    "MINHA_VAR": "valor",
    # ...
}
for name, value in secrets.items():
    set_secret(name, value)
EOF
```

---

## Fluxo Automático (após setup)

```
git push main
  │
  ├── 1. build-push (self-hosted runner ~2-3min)
  │      docker build -t registry.digital-ai.tech/digital-ai/<app>:<sha>
  │      docker push :latest + :<sha>
  │
  ├── 2. dns-sync (ubuntu-latest ~30s)
  │      GET Cloudflare API → CNAME existe?
  │      Não → POST: <dominio> CNAME → vps.digital-ai.tech (DNS Only, TTL 1)
  │      Sim, correto → skip
  │      Sim, errado → PATCH
  │      sleep 15s (propagação)
  │
  └── 3. deploy (self-hosted runner ~1min)
         Stack existe? → docker service update --image :<sha>
         Stack novo? → docker stack deploy -c docker-stack.yml <stack>
         Health check polling 5s × 120s timeout
         Traefik lê labels → ACME challenge → Let's Encrypt emite cert
         ✅ https://<dominio>.digital-ai.tech disponível
```

**Tempo total: 3-7 minutos**

---

## Gotchas Críticos

### ❌ Cloudflare Proxy (laranja) + Let's Encrypt = cert NÃO emitido
O step de DNS sync sempre cria records com `proxied: false` (DNS Only, ícone cinza).
Com proxy ativo, Traefik não completa o ACME challenge HTTP-01.
**Ativar proxy apenas manualmente, após o primeiro cert emitido.**

### ❌ A record para IP direto — não fazer
Usar sempre CNAME → `vps.digital-ai.tech`. Se o IP do servidor mudar, atualiza apenas o A record de `vps.digital-ai.tech` — todos os subdomínios seguem.

### ℹ️ TrendsOn — DNS tipo A obrigatório (não CNAME)
No cluster TrendsOn não existe alias `vps.trendsoninfluence.com`. O DNS sync deve criar registro tipo `A` apontando direto para `34.233.220.133`. O script Python no step `dns-sync` deve usar `'type':'A'` e não `'type':'CNAME'`.

### ❌ `secrets: inherit` ausente no ci.yml
Sem `secrets: inherit`, Org Secrets não são propagados para o Reusable Workflow.

### ❌ Primeiro deploy sem env vars
No primeiro deploy, o stack não existe — `docker stack deploy` precisa de todas as env vars do app no mesmo job. Garantir que o job `deploy` tenha o bloco `env:` com todas as vars.

### ❌ Router name duplicado no Traefik
Cada serviço precisa de um router name único no Swarm. Usar sempre o nome do app: `traefik.http.routers.<app-name>`.

### ❌ Notificação Discord falhando com "invalid JSON" (código 50109)
`github.event.head_commit.message` pode conter quebras de linha (mensagens multi-linha com `Co-Authored-By`, etc). Usar `head -1` para pegar só a primeira linha E usar `jq` para construir o JSON — nunca concatenar variáveis brutas em string JSON.
```bash
MSG=$(echo "${COMMIT_MSG:-redeploy manual}" | head -1)
PAYLOAD=$(jq -n --arg title "..." --argjson color 3066993 --arg msg "$MSG" '{embeds:[...]}')
curl -s -X POST "$DISCORD_WEBHOOK" -H "Content-Type: application/json" -d "$PAYLOAD"
```

### ❌ Branch padrão `main` vs `master`
Novos repos GitHub criam branch `master` no primeiro push, mas o repo pode ter branch default configurada como `main`. Verificar e corrigir via GitHub API se necessário:
```bash
curl -X PATCH "https://api.github.com/repos/DIGITAL-AI-TECH/<repo>" \
  -H "Authorization: Bearer $GITHUB_PAT" \
  -d '{"default_branch":"master"}'
```

### ❌ Builds seletivos (dorny/paths-filter) não detectam mudanças no workflow_dispatch
Em `workflow_dispatch`, o `paths-filter` não tem diff para comparar → todos os outputs são `false` → todos os builds são skipped. No job `deploy`, a detecção de primeiro deploy (`STACK_EXISTS=false`) garante que o `docker stack deploy` com `VERSION=latest` ainda execute corretamente.

### ❌ docker stack deploy precisa das imagens :latest no registry
No primeiro deploy, `VERSION=latest` → `docker-stack.yml` usa `image: registry/app/servico:${VERSION:-latest}`. As imagens `:latest` devem existir no registry (buildar pelo menos uma vez antes via push de código).

### ❌ voice-ai-core build context — usar raiz do repo, não o diretório do serviço
Quando o Dockerfile referencia arquivos da raiz do monorepo (ex: `COPY agents.yaml /app/`), o build context deve ser `.` (raiz), não o diretório do serviço. No workflow:
```yaml
- uses: docker/build-push-action@v6
  with:
    context: .                              # raiz do repo
    file: services/voice-ai-core/Dockerfile # path do Dockerfile
```

### ℹ️ `workflow_call` não suporta build args dinâmicos
O Reusable Workflow faz `docker build -f Dockerfile .` sem ARGs extras.
Para projetos com ARGs especiais de build, usar ci.yml inline (ver seção acima).

### ℹ️ CF_API_TOKEN 409 Conflict — normal quando visibility="all"
`PUT /orgs/DIGITAL-AI-TECH/actions/secrets/CF_API_TOKEN/repositories/{id}` retorna 409 quando o secret já tem `visibility: all`. Significa que todos os repos já têm acesso — não é erro. O 409 confirma que o secret está em modo "all".

---

## Disparar Deploy Manual

Via GitHub UI: repositório → Actions → Deploy → Run workflow → Branch: main

Via API:
```bash
curl -X POST \
  -H "Authorization: token $GITHUB_PAT" \
  "https://api.github.com/repos/DIGITAL-AI-TECH/<repo>/actions/workflows/deploy.yml/dispatches" \
  -d '{"ref":"main"}'
```

---

## Projetos que usam esta arquitetura

| Projeto | Repo | Domínio | Tipo | Cluster |
|---------|------|---------|------|---------|
| pibi | DIGITAL-AI-TECH/pibi | pibi.digital-ai.tech | Build customizado (PayloadCMS + Next.js) | Digital AI |
| voy | DIGITAL-AI-TECH/voy | voy.trendsoninfluence.com | Padrão A (serviço único) | TrendsOn |
