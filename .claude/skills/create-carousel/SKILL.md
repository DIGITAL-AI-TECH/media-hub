---
name: create-carousel
description: Gera carrossel Instagram completo (HTML + PNGs 1080x1350) a partir de identidade visual e conteudo. Agnostica de marca — identidade passada como parametro.
argument-hint: "<slug> <brand_json> <slides_json>"
allowed-tools: Read,Write,Edit,Bash,Glob
context: fork
---

# create-carousel — Gerador de Carrossel Instagram

Quando acionada, gera um carrossel Instagram completo: HTML com todos os slides + exportacao como PNGs 1080x1350px via Playwright.

## Input esperado (argumentos)

O usuario passa:
1. **slug** — identificador do carrossel (ex: `tech-ai-2026-03-28`)
2. **brand** — JSON com identidade visual:
   ```json
   {
     "name": "tech_newz_ai",
     "handle": "@tech_newz_ai",
     "primary_color": "#00C2FF",
     "dark_bg": "#0A0E1A",
     "light_bg": "#F0F6FF",
     "heading_font": "Space Grotesk",
     "body_font": "Space Grotesk",
     "tone": "direto, atual, inteligente"
   }
   ```
3. **slides** — JSON array com conteudo de cada slide:
   ```json
   [
     {"type": "hero", "headline": "...", "subtitle": "...", "tag": "..."},
     {"type": "content", "headline": "...", "body": "...", "tag": "..."},
     {"type": "cta", "headline": "...", "subtitle": "...", "cta_text": "Seguir"}
   ]
   ```

## O que fazer

1. **Ler** `/cortex/knowledge/prompts/instagram-carousel-generator.md` para o sistema completo de design
2. **Gerar** o HTML do carrossel aplicando a brand identity e o conteudo dos slides
3. **Salvar** HTML em `/cortex/files/carousels/<slug>/carousel.html`
4. **Exportar** cada slide como PNG via Playwright:
   ```bash
   cd /cortex/files/carousels/<slug>
   python3 export_slides.py
   ```
5. **Salvar** PNGs em `/cortex/files/carousels/<slug>/slides/slide_1.png` ... `slide_N.png`
6. **Reportar** paths dos PNGs gerados

## Script de exportacao (export_slides.py)

Gerar junto com o HTML:

```python
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

INPUT_HTML = Path("carousel.html")
OUTPUT_DIR = Path("slides")
OUTPUT_DIR.mkdir(exist_ok=True)

VIEW_W, VIEW_H = 420, 525
SCALE = 1080 / 420

async def export_slides():
    async with async_playwright() as p:
        browser = await p.chromium.launch()
        page = await browser.new_page(
            viewport={"width": VIEW_W, "height": VIEW_H},
            device_scale_factor=SCALE,
        )
        html_content = INPUT_HTML.read_text(encoding="utf-8")
        await page.set_content(html_content, wait_until="networkidle")
        await page.wait_for_timeout(3000)
        await page.evaluate("""() => {
            document.querySelectorAll('.ig-header,.ig-dots,.ig-actions,.ig-caption')
                .forEach(el => el.style.display='none');
            const frame = document.querySelector('.ig-frame');
            frame.style.cssText = 'width:420px;height:525px;max-width:none;border-radius:0;box-shadow:none;overflow:hidden;margin:0;';
            const viewport = document.querySelector('.carousel-viewport');
            viewport.style.cssText = 'width:420px;height:525px;aspect-ratio:unset;overflow:hidden;cursor:default;';
            document.body.style.cssText = 'padding:0;margin:0;display:block;overflow:hidden;';
        }""")
        await page.wait_for_timeout(500)
        slides = await page.evaluate("() => document.querySelectorAll('.slide').length")
        for i in range(slides):
            await page.evaluate("""(idx) => {
                const track = document.querySelector('.carousel-track');
                track.style.transition = 'none';
                track.style.transform = 'translateX(' + (-idx * 420) + 'px)';
            }""", i)
            await page.wait_for_timeout(400)
            await page.screenshot(
                path=str(OUTPUT_DIR / f"slide_{i+1}.png"),
                clip={"x": 0, "y": 0, "width": VIEW_W, "height": VIEW_H}
            )
        await browser.close()
        print(f"Exported {slides} slides to {OUTPUT_DIR}/")

asyncio.run(export_slides())
```

## Regras

- HTML gerado deve ser 100% self-contained (fontes via Google Fonts CDN, sem assets externos alem de fontes)
- ig-frame width: SEMPRE 420px (nunca alterar)
- Slides: minimo 5, maximo 10
- Ultimo slide: sem swipe arrow, progress bar 100%, CTA claro
- Alternancia light/dark entre slides
- Salvar SEMPRE em `/cortex/files/carousels/<slug>/`
