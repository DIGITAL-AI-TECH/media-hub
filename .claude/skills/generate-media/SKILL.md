---
name: generate-media
description: Gera imagens e vídeos ultra-realísticos via Runware.ai (face reference, NSFW, 400k+ modelos CivitAI), Grok Aurora (xAI), Sora (OpenAI) ou Nano Banana Pro (Google). Guia o prompt com a fórmula de 6 fatores, escolhe modelo e método correto por caso de uso, e entrega código Python pronto para execução.
argument-hint: "[plataforma: runware|grok|sora|nano-banana] [tipo: image|video] [face-reference: sim/nao] [nsfw: sim/nao] [prompt ou descrição da cena]"
allowed-tools: Read, Write, Bash, WebSearch
---

# Skill: generate-media

Você é um especialista em geração de mídia com IA ultra-realística. Quando esta skill é invocada, siga este fluxo:

## Fluxo de Execução

### 1. Identificar intenção e rotear para plataforma correta

Use esta árvore de decisão:

```
É vídeo?
  SIM →
    Precisa de face reference?
      SIM → Veo 3.1 via Gemini API + config.reference_images
              fast $1.20/8s | full $3.20/8s
      NÃO → Grok ($0.05/s) | Sora ($0.10/s) | Veo fast ($0.15/s)
  NÃO (imagem) →
    Precisa de face reference?
      SIM →
        Conteúdo SFW/moda/praia? → Nano Banana google:4@1 via Runware ($0.039) ⭐
        Lingerie/sensual?         → Juggernaut XL + IP-Adapter → xAI enhance (~$0.027)
        Nudez explícita?          → Juggernaut XL + IP-Adapter → Runware img2img (~$0.007)
      NÃO →
        NSFW? → Runware CivitAI ($0.0045+)
        SFW?  → gpt-image-1 ($0.007) | Grok ($0.02) | Runware FLUX ($0.001)
```

Se o usuário não especificou, pergunte:
- **Tipo:** imagem ou vídeo?
- **Face reference?** (tem foto de rosto de referência?)
- **NSFW/adulto?**
- **Plataforma preferida** (se souber)
- **Descrição da cena**

Se o usuário forneceu os argumentos, prossiga direto para o passo 2.

### 2. Otimizar o prompt com a Fórmula de 6 Fatores

Transforme a descrição do usuário em um prompt ultra-realístico:

```
[Câmera/Lente] + [Sujeito detalhado] + [Ambiente/Contexto] +
[3 fontes de iluminação] + [Texturas/Imperfeições] + [Estilo/Referência]
```

**Exemplo de transformação:**

Entrada: `"uma mulher em um escritório"`

Saída otimizada:
```
Shot on Sony A7III, 85mm f/1.4, shallow depth of field. A Brazilian professional woman in her 30s, tailored navy blazer, confident expression, seated at a glass desk in a modern Manhattan office. Three-point lighting: soft key light from large windows on left, warm fill from practical desk lamp, cool rim light separating her from the blurred cityscape background. Natural skin texture with visible pores, subtle laugh lines — not airbrushed, unretouched. Eye catchlights sharp. Ultra-realistic 4K photography.
```

**10 Regras de Ouro (aplicar sempre):**
1. Frases completas > tags soltas
2. Sempre 3 fontes de iluminação nomeadas
3. Câmera e lente específicas (Sony A7III, Canon 85mm f/1.2, Leica Q3, Hasselblad)
4. Peça imperfeições: `natural skin pores, fine lines, not airbrushed`
5. Uma linguagem visual única — não misturar estilos
6. Se está 80% certo: edite, não regere
7. Texto na imagem: máximo 3 palavras
8. Resolução explícita no prompt E no parâmetro da API
9. Referências de personagem para consistência entre gerações
10. Física concreta: `wet asphalt reflecting neon`, `subsurface scattering on skin`

### 3. Gerar payload para a plataforma selecionada

---

## Plataforma: Runware.ai ⭐ (Recomendada para face reference e NSFW)

**Documentação completa:** `/cortex/knowledge/references/runware-api.md`
**API Key:** `RUNWARE_API_KEY` em `/cortex/secrets/org/media-apis.env`
**Base URL:** `https://api.runware.ai/v1`
**Auth:** `Authorization: Bearer $RUNWARE_API_KEY`
**Saldo atual:** ~$20 USD

### Decisão de método por caso de uso

| Caso de uso | Método | Modelo | Custo |
|---|---|---|---|
| **SFW com face ref (⭐ MELHOR)** | **Nano Banana** | `google:4@1` + `referenceImages` base64 | $0.039 |
| Foto real de pessoa, nova cena | **ACE++ portrait** | `runware:102@1` | $0.0122 |
| Retrato com controle de estilo | **PuLID** | `runware:101@1` | ~$0.005 |
| NSFW + face consistency (SDXL) | **IP-Adapter FaceID** | `civitai:133005@1759168` (Juggernaut XL) + `runware:55@3` | ~$0.0045 |
| Imagem rápida sem face ref | **FLUX Schnell** | `runware:100@1` | $0.0013 |
| Imagem alta qualidade sem face ref | **FLUX Dev** | `runware:101@1` | $0.0045 |
| NSFW sem face ref | **CivitAI NSFW** | AIR com nsfwLevel 7+ | $0.0006+ |

### Nano Banana (`google:4@1`) — SFW com face reference ⭐

Modelo Google/Gemini nativo no Runware. Melhor qualidade e fidelidade facial para SFW.

**Regras:**
- Sempre enviar referência como **base64 data URI** — NUNCA URLs externas (Imgur/catbox retornam 429)
- Usar campo `referenceImages` (array de strings base64), **NÃO** `ipAdapters`
- Dimensões portrait: `832×1248` (NÃO 832×1216 — inválido neste modelo)

```python
import httpx, base64, uuid, requests

RUNWARE_KEY = "XveQIcoiTDLinjmydX6ozSsdb8cHEOpg"

def get_ref_b64(url: str) -> str:
    """Baixa imagem e converte para base64 data URI."""
    resp = httpx.get(url, headers={"User-Agent": "Mozilla/5.0"}, timeout=30)
    b64 = base64.b64encode(resp.content).decode()
    return f"data:image/jpeg;base64,{b64}"

def nano_banana(prompt: str, ref_b64: str) -> str:
    resp = requests.post(
        "https://api.runware.ai/v1",
        headers={"Authorization": f"Bearer {RUNWARE_KEY}"},
        json=[{
            "taskType": "imageInference",
            "taskUUID": str(uuid.uuid4()),
            "model": "google:4@1",
            "positivePrompt": prompt,
            "width": 832, "height": 1248,
            "numberResults": 1,
            "referenceImages": [ref_b64],   # base64, NÃO ipAdapters
            "outputType": "URL",
            "outputFormat": "JPEG",
        }],
        timeout=120,
    )
    return resp.json()["data"][0]["imageURL"]
```

**Limite de conteúdo confirmado (2026-03-10):**
- ✅ SFW, moda, praia, biquíni
- ❌ Lingerie ou nudez como `referenceImages` → `invalidProviderContent`

### NSFW — Como usar

- **NÃO incluir** `"safety": {"checkContent": true}` na requisição
- Selecionar modelo CivitAI com nsfwLevel 7+ via Model Search
- Prompt explícito funciona diretamente com FLUX Dev e modelos NSFW do CivitAI
- Verificar se conta tem NSFW habilitado em runware.ai/dashboard

### Código Python base (copiar e adaptar)

```python
import requests, uuid, base64, os

RUNWARE_API_KEY = "XveQIcoiTDLinjmydX6ozSsdb8cHEOpg"
BASE_URL = "https://api.runware.ai/v1"
HEADERS = {"Content-Type": "application/json", "Authorization": f"Bearer {RUNWARE_API_KEY}"}

def r(tasks):
    resp = requests.post(BASE_URL, headers=HEADERS, json=tasks, timeout=120)
    return resp.json()

def uid():
    return str(uuid.uuid4())

def upload_image(path_or_url):
    """Upload imagem (path local ou URL pública). Retorna imageUUID."""
    if path_or_url.startswith("http"):
        img_data = path_or_url
    else:
        with open(path_or_url, "rb") as f:
            img_data = base64.b64encode(f.read()).decode()
    result = r([{"taskType": "imageUpload", "taskUUID": uid(), "image": img_data}])
    return result["data"][0]["imageUUID"]
```

### ACE++ Portrait — Face reference (MELHOR para pessoa real)

```python
def generate_ace_portrait(ref_image_path, prompt, width=768, height=1344):
    """Gera imagem mantendo rosto da pessoa de referência. Modelo: FLUX Fill."""
    ref_uuid = upload_image(ref_image_path)
    result = r([{
        "taskType": "imageInference",
        "taskUUID": uid(),
        "positivePrompt": prompt,
        "negativePrompt": "blurry, bad anatomy, deformed, cartoon, anime",
        "model": "runware:102@1",  # FLUX Fill — OBRIGATÓRIO para ACE++
        "width": width,
        "height": height,
        "steps": 25,
        "referenceImages": [ref_uuid],
        "acePlusPlus": {"type": "portrait"},
        "outputType": "URL",
        "outputFormat": "WEBP",
        "numberResults": 1,
        "includeCost": True
        # Sem safety → sem filtro NSFW
    }])
    img = result["data"][0]
    print(f"URL: {img['imageURL']} | Custo: ${img['cost']}")
    return img["imageURL"]

# Exemplo uso Julia:
# url = generate_ace_portrait(
#     "/tmp/julia_reference.png",
#     "full body photo of a young woman in colorful bikini on tropical beach, golden hour, cinematic"
# )
```

### PuLID — Face reference (alternativa, mais rápido)

```python
def generate_pulid(ref_image_path, prompt, id_weight=1.0, width=1024, height=1024):
    """Face reference via PuLID. Modelo: FLUX Dev."""
    ref_uuid = upload_image(ref_image_path)
    result = r([{
        "taskType": "imageInference",
        "taskUUID": uid(),
        "positivePrompt": prompt,
        "model": "runware:101@1",  # FLUX Dev
        "width": width, "height": height,
        "steps": 20, "CFGScale": 3.5,
        "outputType": "URL", "outputFormat": "WEBP",
        "numberResults": 1, "includeCost": True,
        "puLID": {
            "inputImages": [ref_uuid],
            "idWeight": id_weight,
            "CFGStartStep": 3  # NÃO usar trueCFGScale junto!
        }
    }])
    img = result["data"][0]
    return img["imageURL"]
```

### Buscar modelos NSFW no CivitAI via Runware

```python
def search_nsfw_models(query="photorealistic woman", architecture="sdxl"):
    """Busca modelos NSFW disponíveis."""
    result = r([{
        "taskType": "modelSearch",
        "taskUUID": uid(),
        "query": query,
        "searchFilters": {"category": "checkpoint", "architecture": [architecture]},
        "first": 10
    }])
    for m in result.get("data", [{}])[0].get("models", {}).get("edges", []):
        node = m["node"]
        if node.get("nsfwLevel", 0) >= 7:
            print(f"NSFW: {node['name']} | AIR: {node['air']} | nsfw: {node['nsfwLevel']}")
```

### Gotchas críticos

- `taskUUID` DEVE ser UUID v4 válido: `str(uuid.uuid4())`
- ACE++ REQUER `model: runware:102@1` (FLUX Fill) — outros modelos falham
- PuLID: NÃO usar `trueCFGScale` e `CFGStartStep` juntos → erro `conflictPuLIDTrueCFG`
- ACE++ com `repaintingScale` REQUER `inputMasks`
- Dimensões: múltiplos de 64, entre 512 e 2048
- CFGScale: FLUX usa 1.0–5.0 (padrão 3.5), SD usa 5–12, SDXL usa 5–10
- URLs geradas têm TTL — **SEMPRE fazer upload para S3 após geração**

---

## S3 — Upload Obrigatório Após Geração

**TODA mídia gerada DEVE ser enviada ao S3 antes de compartilhar ou publicar no Instagram.**

### Path padrão Julia

```
uploads/media-cortex/creation/julia/{YYYY-MM-DD}/MIDIAS/<arquivo>
```

### URL pública (SEMPRE com região explícita)

```
https://s3.us-east-1.amazonaws.com/cdn.digital-ai.tech/{key}
```

> ⚠️ **NUNCA** usar `https://cdn.digital-ai.tech/` — CDN não configurado, retorna timeout.

### Upload via S3 MCP (Claude Code)

```python
import base64
from datetime import date

today = date.today().strftime("%Y-%m-%d")
filename = "julia-post.jpg"  # nome descritivo
key = f"uploads/media-cortex/creation/julia/{today}/MIDIAS/{filename}"

# Ler e converter arquivo
with open(f"/tmp/{filename}", "rb") as f:
    b64 = base64.b64encode(f.read()).decode()

# Chamar MCP
mcp__s3-mcp__upload_file(bucket="cdn.digital-ai.tech", key=key, fileContent=b64)

# URL pública resultante
s3_url = f"https://s3.us-east-1.amazonaws.com/cdn.digital-ai.tech/{key}"
```

### Fluxo completo obrigatório — Vídeo Julia

```
1. Gerar vídeo com Veo 3.1 fast → prompt SEMPRE com falas em português BR
   Exemplo de fala no prompt: 'ela diz com voz sonolenta: "Gente, que horas são?!"'

2. ⚠️ OBRIGATÓRIO: Passar pelo ElevenLabs S2S antes de qualquer uso
   - Extrair áudio do vídeo Veo com ffmpeg
   - Enviar para ElevenLabs S2S (modelo: eleven_multilingual_sts_v2)
   - Voice ID Julia: XIlxCKTRlwu5pwGFBlMO
   - Mesclar nova voz no vídeo original com ffmpeg
   → Resultado: vídeo com voz da Julia, não a voz genérica do Veo

3. Salvar em /tmp/ (imagem e vídeo)

4. Upload S3 → uploads/media-cortex/creation/julia/{data}/MIDIAS/<arquivo>

5. URL: https://s3.us-east-1.amazonaws.com/cdn.digital-ai.tech/{key}

6. Compartilhar URL com usuário para aprovação

7. Após aprovação → publicar via Instagram MCP (usar URL S3 como image_url / video_url)
```

> **Regra**: NUNCA entregar vídeo da Julia sem passar pelo ElevenLabs. A voz do Veo não é a dela.

---

## Plataforma: xAI Grok (Aurora)

## Credenciais

As chaves estão em `/cortex/secrets/org/media-apis.env`:

```bash
source /cortex/secrets/org/media-apis.env
# Exporta: OPENAI_API_KEY, GOOGLE_AI_API_KEY, XAI_API_KEY
```

| Plataforma | Variável | Arquivo |
|-----------|----------|---------|
| OpenAI (Sora + DALL-E 3) | `OPENAI_API_KEY` | `/cortex/secrets/org/media-apis.env` |
| Google (Nano Banana Pro) | `GOOGLE_AI_API_KEY` | `/cortex/secrets/org/media-apis.env` |
| xAI (Grok Aurora) | `XAI_API_KEY` | `/cortex/secrets/org/media-apis.env` |

## S3 — Imagens de Referência

Bucket de mídia: `cdn.digital-ai.tech`

> ⚠️ **RESTRIÇÃO:** Agentes só têm permissão de leitura/escrita em `/uploads/media-cortex/` dentro deste bucket. NUNCA acessar outros diretórios.

**Estrutura padrão:**
```
s3://cdn.digital-ai.tech/
  uploads/media-cortex/          ← diretório permitido
    references/<nome>/           ← imagens de referência por pessoa/projeto
      base.png                   ← foto base do rosto
    output/<nome>/               ← imagens geradas (salvar aqui)
```

**Como baixar imagem de referência via S3 MCP:**
```
mcp__s3-mcp__download_file(
  bucket="cdn.digital-ai.tech",
  key="uploads/media-cortex/references/<nome>/base.png"
)
→ salvar em /tmp/<nome>_ref.png
→ usar como input_reference na API
```

**Como salvar resultado no S3:**
```
mcp__s3-mcp__upload_file(
  bucket="cdn.digital-ai.tech",
  key="uploads/media-cortex/output/<nome>/<timestamp>.png",
  file_content=<base64>
)
```

---

## Plataforma: xAI Grok (Aurora)

**Base URL:** `https://api.x.ai/v1`
**Auth:** `Authorization: Bearer $XAI_API_KEY`

### Imagens

**Modelos e preços:**
| Modelo | Preço | Rate Limit | Uso |
|--------|-------|-----------|-----|
| `grok-imagine-image` | $0,02/img | 300 RPM | Econômico |
| `grok-imagine-image-pro` | $0,07/img | 30 RPM | Máxima qualidade |

**Parâmetros suportados:**
- `model` — obrigatório
- `prompt` — até 8.000 chars
- `n` — 1 a 10 imagens
- `aspect_ratio` — `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `2:1`, `1:2`, `3:2`, `2:3`, `20:9`, `auto`
- `resolution` — `1k` (1024px) ou `2k` (2048px)
- `response_format` — `url` (default) ou `b64_json`

> ⚠️ **GOTCHA:** NÃO usar `quality`, `size` ou `style` — são padrão OpenAI e não funcionam na xAI.

**Payload cURL:**
```bash
curl -X POST https://api.x.ai/v1/images/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-image",
    "prompt": "<PROMPT_OTIMIZADO>",
    "n": 1,
    "aspect_ratio": "16:9",
    "resolution": "2k"
  }'
```

**Python (xAI SDK):**
```python
import xai_sdk
client = xai_sdk.Client()  # lê XAI_API_KEY do env

response = client.image.sample(
    prompt="<PROMPT_OTIMIZADO>",
    model="grok-imagine-image-pro",
)
print(response.url)
```

**Python (OpenAI SDK compatível):**
```python
from openai import OpenAI
client = OpenAI(base_url="https://api.x.ai/v1", api_key="XAI_API_KEY")
response = client.images.generate(model="grok-imagine-image", prompt="<PROMPT>")
print(response.data[0].url)
```

### Vídeo (Grok)

**Modelo:** `grok-imagine-video` — $0,05/segundo — 720p — 15s máx — 24 FPS

```bash
curl -X POST https://api.x.ai/v1/videos/generations \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $XAI_API_KEY" \
  -d '{
    "model": "grok-imagine-video",
    "prompt": "<PROMPT_OTIMIZADO>",
    "duration": 8,
    "resolution": "720p"
  }'
```

**Custo estimado:** 6s = $0,30 | 8s = $0,40 | 15s = $0,75

**Capacidades extras:** edição multi-imagem (até 3 refs), `sample_batch()` para lotes, superior em texto/logos e cenas multi-pessoa.

---

## Plataforma: OpenAI Sora

**Base URL:** `https://api.openai.com/v1/`
**Auth:** `Authorization: Bearer $OPENAI_API_KEY`
**Pré-requisito:** mínimo $50 em créditos na conta OpenAI

> ⚠️ **API 100% assíncrona** — SEMPRE implementar polling ou webhook. Sem resposta síncrona.

### Modelos

| Modelo | Custo/s | Resolução máx | Melhor para |
|--------|---------|--------------|-------------|
| `sora-2` | $0,10/s | 1280×720 | Prototipagem, social |
| `sora-2-pro` | $0,30/s | 1280×720 | Produção |
| `sora-2-pro` | $0,50/s | 1792×1024 | Cinema/HD |

### Custo por vídeo

| Modelo | 4s | 8s | 12s |
|--------|-----|-----|------|
| Sora 2 (720p) | $0,40 | $0,80 | $1,20 |
| Sora 2 Pro (720p) | $1,20 | $2,40 | $3,60 |
| Sora 2 Pro (HD) | $2,00 | $4,00 | $6,00 |

### Parâmetros

| Parâmetro | Valores | Descrição |
|-----------|---------|-----------|
| `model` | `sora-2`, `sora-2-pro` | Modelo |
| `prompt` | string | Descrição do vídeo |
| `size` | `1280x720`, `720x1280`, `1792x1024` | Resolução |
| `seconds` | `"4"`, `"8"`, `"12"` | Duração |
| `input_reference` | file (JPEG/PNG/WebP) | Âncora do 1º frame |
| `remix_video_id` | video ID | Remixar vídeo existente |

### Python — Workflow completo com polling

```python
import os, time
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# 1. Criar job
video = client.videos.create(
    model="sora-2-pro",
    prompt="<PROMPT_OTIMIZADO>",
    size="1280x720",
    seconds="8"
)
print(f"Job iniciado: {video.id} | Status: {video.status}")

# 2. Polling
while video.status not in ["completed", "failed", "cancelled"]:
    print(f"Status: {video.status} | aguardando 20s...")
    time.sleep(20)
    video = client.videos.retrieve(video.id)

# 3. Download
if video.status == "completed":
    content = client.videos.download_content(video.id, variant="video")
    content.write_to_file("output.mp4")
    print("Salvo: output.mp4")
```

### Image-to-Video (Sora)

```python
video = client.videos.create(
    model="sora-2",
    prompt="The product in the image starts rotating slowly, studio lighting.",
    size="1280x720",
    seconds="8",
    input_reference=open("produto.png", "rb")
)
```

### Limitações importantes
- Max 2 jobs simultâneos
- Vídeos expiram em 24h
- Sem rostos de pessoas reais
- Não disponível no RU, Suíça e EEA
- Texto legível: adicionar via pós-produção (Premiere, DaVinci)

---

## Plataforma: Google Nano Banana Pro

> **Nota:** "Nano Banana Pro" é o nome oficial do produto Google (família Gemini 3).
> Model ID: `gemini-3-pro-image-preview`

**Endpoint Gemini API:** `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent`
**Auth:** header `x-goog-api-key: $GEMINI_API_KEY`

### Imagens

**Preços:**
| Resolução | Preço | Observação |
|-----------|-------|-----------|
| 1K / 2K | $0,134/img | API oficial |
| 4K | $0,24/img | Máxima qualidade |
| Free tier (AI Studio) | Grátis | ~50 req/dia |

**Aspect ratios:** `1:1`, `16:9`, `9:16`, `4:3`, `3:4`, `3:2`, `2:3`, `21:9`

### Python — Google GenAI SDK

```python
from google import genai
from google.genai import types

client = genai.Client(api_key="GEMINI_API_KEY")

response = client.models.generate_content(
    model="gemini-3-pro-image-preview",
    contents="<PROMPT_OTIMIZADO>",
    config=types.GenerateContentConfig(
        response_modalities=["IMAGE"],
        imagen_config=types.ImagenConfig(
            aspect_ratio="16:9",
            resolution="4K"
        )
    )
)

for part in response.candidates[0].content.parts:
    if part.inline_data:
        with open("output.png", "wb") as f:
            f.write(part.inline_data.data)
        print("Imagem salva: output.png")
```

### cURL — Gemini API direta

```bash
curl -s -X POST \
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image-preview:generateContent" \
  -H "x-goog-api-key: $GEMINI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "<PROMPT_OTIMIZADO>"}]}],
    "generationConfig": {
      "responseModalities": ["IMAGE"],
      "imagenConfig": {"aspectRatio": "16:9", "resolution": "4K"}
    }
  }'
```

### Vídeo — Veo 3.1 via Gemini API ⭐ (CONFIRMADO 2026-03-10)

**Chave:** `GOOGLE_AI_API_KEY` em `/cortex/secrets/org/media-apis.env`
**Recipe completo:** `/cortex/projects/julia-pipeline/recipes/veo31-img2video.md`

**Modelos disponíveis (Gemini API):**
| Modelo | Preço/vídeo 8s | Tempo geração | Áudio |
|--------|---------------|---------------|-------|
| `veo-3.1-generate-preview` | **$3.20** | ~30s | ✅ nativo |
| `veo-3.1-fast-generate-preview` | **$1.20** | ~30s | ✅ nativo |
| `veo-3.0-generate-001` | — | — | ✅ |
| `veo-2.0-generate-001` | — | — | ❌ |

> ⚠️ `veo-3.1-generate-001` NÃO EXISTE — usar `veo-3.1-generate-preview`

**Python — img2video com referência (workaround celebrity block):**

```python
import time, requests
from google import genai
from google.genai import types

GOOGLE_KEY = "AIzaSyAtAap1Ko8nCqo59QMP1TOf782IBYLnORA"
client = genai.Client(api_key=GOOGLE_KEY)

# Carregar imagem de referência local
with open("/tmp/ref.jpg", "rb") as f:
    img_bytes = f.read()

# CRÍTICO: usar config.reference_images, NÃO o parâmetro image=
# O parâmetro image= direto aciona filtro "celebrity likeness" (rai_media_filtered)
ref_image = types.VideoGenerationReferenceImage(
    image=types.Image(image_bytes=img_bytes, mime_type="image/jpeg"),
    reference_type=types.VideoGenerationReferenceType.ASSET,
    # NÃO existe campo reference_id
)

op = client.models.generate_videos(
    model="veo-3.1-fast-generate-preview",   # fast = $1.20/8s
    prompt="The woman in the image smiles and says 'Bom dia!' ...",
    config=types.GenerateVideosConfig(
        aspect_ratio="9:16",
        duration_seconds=8,       # int 4–8 inclusive
        number_of_videos=1,
        reference_images=[ref_image],
        # NÃO incluir: generate_audio (erro AttributeError — nativo no Veo 3+)
        # NÃO incluir: person_generation (erro 400 — não suportado na Gemini API)
    ),
)

# Polling
for _ in range(40):
    time.sleep(10)
    op = client.operations.get(op)
    if op.done:
        break

# Download
uri = op.result.generated_videos[0].video.uri
dl = requests.get(uri, headers={"x-goog-api-key": GOOGLE_KEY}, timeout=120)
with open("/tmp/video.mp4", "wb") as f:
    f.write(dl.content)

# Upload para WhatsApp (catbox NÃO funciona para vídeos — usar uguu.se)
r = requests.post("https://uguu.se/upload",
    files={"files[]": ("v.mp4", dl.content, "video/mp4")}, timeout=60)
video_url = r.json()["files"][0]["url"]   # https://d.uguu.se/XXXXX.mp4 (válido 24h)
```

**Gotchas críticos Veo:**
| Erro | Causa | Fix |
|------|-------|-----|
| `rai_media_filtered` | `image=` param direto | Usar `config.reference_images` ✅ |
| `AttributeError: generate_audio` | Só Vertex AI tem este param | Omitir — áudio é nativo |
| HTTP 400 `person_generation` | Não suportado via Gemini API | Omitir |
| Vídeo vazio no WhatsApp | catbox.moe bug silencioso | Usar uguu.se ✅ |

---

## Comparativo Final de Custo — Vídeo (atualizado 2026-03-10)

| Plataforma | Modelo | $/s | 8s | Áudio | Face ref | API |
|-----------|--------|-----|-----|-------|----------|-----|
| Grok | grok-imagine-video | $0,05 | $0,40 | ❌ | ❌ | xAI |
| Sora | sora-2 | $0,10 | $0,80 | ❌ | ⚠️ bloqueado | OpenAI |
| Google | **Veo 3.1 fast** ⭐ | $0,15 | **$1,20** | ✅ nativo | ✅ workaround | Gemini API |
| Sora | sora-2-pro | $0,30 | $2,40 | ❌ | ⚠️ bloqueado | OpenAI |
| Google | Veo 3.1 full | $0,40 | $3,20 | ✅ nativo | ✅ workaround | Gemini API |
| Sora | sora-2-pro HD | $0,50 | $4,00 | ❌ | ⚠️ bloqueado | OpenAI |

**Recomendação por objetivo:**
- **Face reference + áudio:** Veo 3.1 fast via Gemini API ⭐ ($1.20/8s, ~30s geração)
- **Prototipagem sem face ref:** Grok ($0.05/s)
- **Social media sem face ref:** Sora 2 ($0.10/s)
- **Máxima qualidade:** Veo 3.1 full ($3.20/8s)

> ⚠️ Sora img2video com rostos reais está bloqueado por política de conteúdo (testado 2026-03-10)

---

## Plataforma: ElevenLabs — Voice Replacement (Speech-to-Speech)

**Documentação completa:** `/cortex/knowledge/references/elevenlabs-api.md`
**Credenciais:** `/cortex/secrets/org/media-apis.env`
- `ELEVENLABS_API_KEY=sk_feea1f5f303786aa856f2956c91f3f6400fd86a2ab810a91`
- `ELEVENLABS_JULIA_VOICE_ID=XIlxCKTRlwu5pwGFBlMO`

> **Caso de uso principal:** substituir a voz genérica do Veo 3.1 pela voz da Julia, mantendo timing e emoção. **Confirmado funcionando em 2026-03-10.**

### Pipeline: Veo → ElevenLabs S2S → Vídeo final

```
Veo 3.1 → ffmpeg extrai áudio → ElevenLabs S2S → ffmpeg mescla → vídeo final com voz Julia
```

**Custo total:** Veo fast $1.20 + ElevenLabs S2S ~$0.001 = **~$1.20/vídeo**

### Setup — Instalar ffmpeg na sessão

ffmpeg não está no PATH do sistema. Usar o binário estático via `imageio-ffmpeg`:

```bash
pip install imageio-ffmpeg requests --break-system-packages -q
```

```python
import imageio_ffmpeg
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()  # path do binário estático
```

### Script Python completo (TESTADO ✅ 2026-03-10)

```python
import os, subprocess, requests
import imageio_ffmpeg

ELEVENLABS_KEY = "sk_feea1f5f303786aa856f2956c91f3f6400fd86a2ab810a91"
JULIA_VOICE_ID = "XIlxCKTRlwu5pwGFBlMO"
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()

def veo_to_julia_voice(veo_video_path: str, final_output: str) -> str:
    """
    Substitui voz do vídeo Veo pela voz da Julia via ElevenLabs S2S.
    Retorna path do vídeo final.
    """
    # 1. Extrair áudio do Veo
    subprocess.run([FFMPEG, "-y", "-i", veo_video_path,
        "-vn", "-acodec", "libmp3lame", "-q:a", "2", "/tmp/veo_audio.mp3"],
        capture_output=True, check=True)

    # 2. ElevenLabs Speech-to-Speech
    with open("/tmp/veo_audio.mp3", "rb") as f:
        audio_bytes = f.read()

    resp = requests.post(
        f"https://api.elevenlabs.io/v1/speech-to-speech/{JULIA_VOICE_ID}",
        headers={"xi-api-key": ELEVENLABS_KEY},
        data={
            "model_id": "eleven_multilingual_sts_v2",  # melhor modelo PT-BR
            "output_format": "mp3_44100_128",
            "remove_background_noise": "true",
        },
        files={"audio": ("audio.mp3", audio_bytes, "audio/mpeg")},
        timeout=120,
    )
    resp.raise_for_status()
    with open("/tmp/julia_voice.mp3", "wb") as f:
        f.write(resp.content)

    # 3. Mesclar nova voz no vídeo original
    subprocess.run([FFMPEG, "-y",
        "-i", veo_video_path, "-i", "/tmp/julia_voice.mp3",
        "-c:v", "copy", "-c:a", "aac",
        "-map", "0:v:0", "-map", "1:a:0",
        "-shortest", final_output],
        capture_output=True, check=True)

    return final_output

# Upload resultado para uguu.se
def upload_video(path: str) -> str:
    with open(path, "rb") as f:
        video_bytes = f.read()
    r = requests.post("https://uguu.se/upload",
        files={"files[]": ("julia.mp4", video_bytes, "video/mp4")}, timeout=60)
    return r.json()["files"][0]["url"]
```

### Gotchas críticos ElevenLabs S2S

- **PT-BR:** usar `eleven_multilingual_sts_v2` — é o melhor modelo para português (não o `sts_v2` English-only)
- **ffmpeg:** não disponível no PATH — usar `imageio_ffmpeg.get_ffmpeg_exe()` para o binário estático
- **`remove_background_noise: true`** — essencial quando Veo tem som ambiente
- **catbox NÃO funciona para vídeos** — sempre usar uguu.se para hospedar o vídeo final

---

## Documentação completa

- Runware: `/cortex/knowledge/references/runware-api.md`
- ElevenLabs: `/cortex/knowledge/references/elevenlabs-api.md`
- Recipe Veo img2video: `/cortex/projects/julia-pipeline/recipes/veo31-img2video.md`
