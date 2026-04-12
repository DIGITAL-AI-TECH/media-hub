---
name: browser-automation
description: Automatiza navegação em browser remoto (Adspower + CDP tunnel) via browser-use v0.12 + OpenAI. Use para scraping, coleta de dados, warmup de perfis, automação de formulários em sites que exigem login.
argument-hint: "<wss_url> <task_description>"
allowed-tools: Read, Write, Edit, Bash, WebFetch
---

# Browser Automation via CDP + browser-use

Automatiza um browser Chrome real (rodando no Adspower) via CDP WebSocket tunnel (cloudflared) usando um agente OpenAI para executar tarefas em linguagem natural.

## Arquitetura

```
Adspower (Chrome local)
    ↓ CDP WebSocket
cloudflared tunnel (WSS público)
    ↓
BrowserSession (browser-use v0.12)
    ↓ screenshots + DOM
Agent (gpt-4.1-mini)
    ↓ ações: click, scroll, type, navigate
Browser real executa no perfil já logado
```

## Pré-requisitos

### 1. Instalar dependências
```bash
pip install browser-use --break-system-packages
# NÃO instalar langchain-openai — usar o ChatOpenAI nativo do browser-use
```

### 2. Variável de ambiente
```
OPENAI_API_KEY=sk-proj-...
```

### 3. Obter WSS do tunnel ativo

No Adspower:
1. Abra o perfil desejado (Chrome abre)
2. Adspower expõe CDP localmente — verificar porta em Settings > API
3. Crie tunnel cloudflared:
   ```bash
   cloudflared tunnel --url http://localhost:PORTA_CDP
   ```
4. URL retornada: `https://NOME.trycloudflare.com`
5. WSS final: `wss://NOME.trycloudflare.com/devtools/browser/UUID`
   - UUID: pegar via `curl http://localhost:PORTA_CDP/json/version`

### Verificar se tunnel está ativo
```bash
curl -s --max-time 5 "https://NOME.trycloudflare.com/json"
# Deve retornar JSON — se retornar 502, tunnel morto
```

## Código Base (copiar e adaptar)

```python
import asyncio, os

WSS = "wss://SEU-TUNNEL.trycloudflare.com/devtools/browser/UUID"

TASK = """
Descreva a tarefa em linguagem natural.
Ex: Acesse https://site.com, extraia todos os títulos e retorne como lista JSON.
Ao terminar: reporte "CONCLUÍDO: <resumo do que foi feito>"
"""

async def run():
    from browser_use.browser.session import BrowserSession
    from browser_use.agent.service import Agent
    from browser_use.llm.openai.chat import ChatOpenAI  # NÃO usar langchain!

    browser_session = BrowserSession(cdp_url=WSS, keep_alive=True)
    llm = ChatOpenAI(
        model="gpt-4.1-mini",
        api_key=os.environ["OPENAI_API_KEY"],
        temperature=0.3
    )
    agent = Agent(task=TASK, llm=llm, browser_session=browser_session)
    result = await agent.run()
    print(result)

asyncio.run(run())
```

### Execução segura (evitar typo na API key)
```bash
OPENAI_API_KEY=$(grep OPENAI_API_KEY .env | cut -d= -f2) \
  PATH="$PATH:/home/claude/.local/bin" \
  python3 meu_script.py
```

## Imports: Correto vs Errado

| | Import |
|---|---|
| ✅ CORRETO v0.12 | `from browser_use.browser.session import BrowserSession` |
| ✅ CORRETO v0.12 | `from browser_use.agent.service import Agent` |
| ✅ CORRETO v0.12 | `from browser_use.llm.openai.chat import ChatOpenAI` |
| ❌ ERRADO (v0.11-) | `from browser_use import Agent` |
| ❌ ERRADO | `from browser_use.browser.browser import Browser, BrowserConfig` |
| ❌ ERRADO | `from langchain_openai import ChatOpenAI` |

## Casos de Uso

### Coleta de dados de perfil Instagram
```python
TASK = """
Acesse https://www.instagram.com/PERFIL/.
Extraia e retorne JSON com:
- nome_exibicao, bio, seguidores, seguindo, total_posts
- urls dos últimos 6 posts visíveis
Retorne APENAS o JSON.
"""
```

### Warmup de perfil Instagram
```python
TASK = """
Você está logado no Instagram.
1. Vá para https://www.instagram.com/
2. Curta 10 posts de tecnologia/IA
3. Deixe 5 comentários curtos em português
4. Salve 3 posts interessantes
Reporte ao final: "CONCLUÍDO: X likes, Y comentários, Z salvamentos"
"""
```

### Scraping de preços em e-commerce
```python
TASK = """
Acesse https://loja.com/categoria.
Role a página e colete nome + preço de todos os produtos visíveis.
Retorne JSON: [{"nome": "...", "preco": "..."}]
"""
```

### Extração de dados de portal com login
```python
# O perfil Adspower já está logado — o agente usa a sessão existente
TASK = """
Acesse https://portal.com/relatorios.
Clique em "Relatório Mensal", aguarde carregar.
Extraia todos os valores da tabela de métricas.
Retorne JSON estruturado com os dados.
"""
```

## Gotchas Críticos (aprendidos na prática)

### 1. HTTP 502 no WSS = tunnel morto
**Causa**: Adspower fechou, cloudflared parou ou sessão expirou.
**Fix**: Fechar e reabrir o perfil no Adspower → gerar novo tunnel.

### 2. HTTP 429 de sites (rate limiting)
**Causa**: Muitas requisições no mesmo perfil/IP em pouco tempo.
**Fix**: Aguardar 1-2 horas. Para Instagram: evitar loops de cliques.

### 3. Agente preso em tela intermediária
**Sintoma**: Agent fica em loop clicando o elemento errado (ex: "Remover perfis" ao invés de "Continuar").
**Causa**: O browser abriu em uma tela de confirmação antes da tela desejada.
**Fix**: Antes de passar o WSS para o agente, abrir o browser manualmente e navegar até a tela correta (ex: feed do Instagram).

### 4. Screenshot timeout 15s
**Sintoma**: `TimeoutError: ScreenshotWatchdog timed out after 15.0s`
**É normal**: Acontece quando o browser está carregando páginas pesadas. O agente continua operando mesmo com esse warning.

### 5. Loop detection
**Sintoma**: Loop detection nudge injected (repetition=5, stagnation=5)
**Causa**: Agente executando a mesma ação sem progresso.
**Fix**: Melhorar o TASK com instruções mais específicas sobre como lidar com telas específicas.

### 6. ModuleNotFoundError
```
ModuleNotFoundError: No module named 'browser_use.browser.browser'
```
**Fix**: Atualizar imports para API v0.12 (ver seção Imports acima).

### 7. AttributeError provider
```
AttributeError: 'ChatOpenAI' object has no attribute 'provider'
```
**Fix**: Trocar `from langchain_openai import ChatOpenAI` por `from browser_use.llm.openai.chat import ChatOpenAI`.

## Como Criar Script para Novo Caso de Uso

1. Copie o Código Base acima
2. Substitua `WSS` pela URL do tunnel ativo
3. Escreva o `TASK` em português descrevendo exatamente o que o agente deve fazer
4. Inclua no TASK: ações obrigatórias em ordem + regras + como reportar conclusão
5. Rode com a execução segura (lendo API key do .env)
6. Monitore os logs — o agente reporta cada passo com `Step N:`

## Custo Estimado

- Modelo: `gpt-4.1-mini`
- Custo por sessão de 15-20 steps: ~$0.002-0.005
- Use `gpt-4o` para tarefas que exigem raciocínio visual mais complexo (~10x mais caro)
