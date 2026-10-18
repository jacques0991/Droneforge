import asyncio, json
from playwright.async_api import async_playwright
async def main():
    jobs=json.load(open('jobs.json'))
    fg=open('assets/icon-foreground.svg').read()
    async with async_playwright() as p:
        b=await p.chromium.launch()
        for j in jobs:
            pg=await b.new_page(viewport={"width":j["w"],"height":j["h"]})
            if j.get("splash"):
                m=min(j["w"],j["h"])*0.62
                html=f'<html><body style="margin:0;background:radial-gradient(circle at 50% 45%,#16243a,#0a0f18 70%);width:{j["w"]}px;height:{j["h"]}px;display:grid;place-items:center"><div style="width:{m}px;height:{m}px">{fg.replace("<svg ","<svg style=\"width:100%;height:100%\" ",1)}</div></body></html>'
                await pg.set_content(html); await pg.screenshot(path=j["out"])
            else:
                svg=open(j["src"]).read(); bg=j.get("bg","transparent")
                await pg.set_content(f'<html><body style="margin:0;background:{bg}">{svg.replace("<svg ",f"<svg style=\"width:{j["w"]}px;height:{j["h"]}px;display:block\" ",1)}</body></html>')
                await pg.screenshot(path=j["out"], omit_background=(bg=="transparent"))
            await pg.close()
        await b.close()
asyncio.run(main())
