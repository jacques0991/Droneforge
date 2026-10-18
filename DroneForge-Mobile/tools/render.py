# Rendu SVG/HTML -> PNG avec Chromium (Playwright)
import asyncio, sys, json
from playwright.async_api import async_playwright
async def main(jobs):
    async with async_playwright() as p:
        b = await p.chromium.launch()
        for j in jobs:
            pg = await b.new_page(viewport={"width": j["w"], "height": j["h"]}, device_scale_factor=1)
            svg = open(j["src"]).read()
            bgc = j.get("bg", "transparent")
            await pg.set_content(f'<html><body style="margin:0;background:{bgc}"><div style="width:{j["w"]}px;height:{j["h"]}px">{svg.replace("<svg ", f"<svg style=\"width:100%;height:100%;display:block\" ",1)}</div></body></html>')
            await pg.screenshot(path=j["out"], omit_background=(bgc == "transparent"))
            await pg.close()
        await b.close()
asyncio.run(main(json.load(open(sys.argv[1]))))
