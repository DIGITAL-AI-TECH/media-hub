---
name: trendson-baseline
description: "Calcula baseline de métricas para campanhas de influencer marketing TrendsOn dado avg_seg e n_creators. Opcionalmente compara com métricas reais."
argument-hint: "avg_seg=<seguidores> creators=<n> [mes=<1|2|3>] [alcance=X views=X engajamento=X taxa_eng=X curtidas=X compartilhamentos=X comentarios=X salvamentos=X]"
allowed-tools: Bash, Read, Write, Edit
---

# TrendsOn — Gerador de Baseline de Influencer Marketing

Calcule o baseline esperado de métricas para uma campanha TrendsOn usando o modelo preditivo calibrado com dados reais (Delícia + Doriana).

**Playbook completo**: `/cortex/knowledge/playbooks/trendson-baseline-influencer-marketing.md`

## Passo 1 — Coletar Inputs

Parse os argumentos:
- `avg_seg=76156` → converter para float em milhares (76.156)
- `creators=6`
- `mes=1` (opcional: mês da campanha para fator de maturidade)
- Métricas reais opcionais: `alcance=X views=X engajamento=X taxa_eng=X curtidas=X compartilhamentos=X comentarios=X salvamentos=X`

Se `avg_seg` ou `creators` ausentes, solicite antes de prosseguir.

## Passo 2 — Executar Cálculo via Bash/Python

```python
avg_seg_k = <avg_seg> / 1000  # converter para milhares
n = <creators>
mes = <mes ou None>
fator = {1: 0.55, 2: 1.00, 3: 1.45}.get(mes, 1.00) if mes else 1.00

per_c = {
    "alcance":           max(0, 61294 + 19.2   * avg_seg_k),
    "views":             max(0, 65451 + 101.7  * avg_seg_k),
    "engajamento":       max(0,  2295 +   5.5  * avg_seg_k),
    "taxa_eng":          max(0,  4.41 +   0.003* avg_seg_k),
    "curtidas":          max(0,  2542 -   7.9  * avg_seg_k),
    "compartilhamentos": max(0,  -287 +  10.6  * avg_seg_k),
    "comentarios":       max(0,    22 +   1.0  * avg_seg_k),
    "salvamentos":       max(0,    22 +   1.6  * avg_seg_k),
}
total = {k: (v * n * fator if k != "taxa_eng" else v) for k, v in per_c.items()}
```

## Passo 3 — Apresentar Resultado

Tabela com baseline por creator e total. Se métricas reais fornecidas, adicionar colunas Real + Variação + Status.

**Critério de status**:
- `🚀 ACIMA` → > +30%
- `✅ BOM` → +15% a +30%
- `✅ OK` → -15% a +15%
- `⚠️ ATENÇÃO` → -15% a -30%
- `🔴 ABAIXO` → < -30%

## Passo 4 — Diagnóstico Estratégico

3–5 linhas interpretando os resultados. Insights chave:
- Alcance abaixo + engajamento acima = audiência menor mas mais ativa (sinal de qualidade)
- Views/Alcance > 1,5x = alto replay
- Compartilhamentos abaixo = conteúdo conecta mas sem gatilho de compartilhamento
- Taxa Eng > 6% = excelente (média histórica: 4,4–5%)
- Fator de maturidade: mês 1 = ×0,55 | mês 2 = ×1,00 | mês 3+ = ×1,45

## Passo 5 — Sync

Salvar resultado no Cortex se cliente identificado e fazer sync.
