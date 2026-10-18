import asyncio
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader"])
        for (w,h,name) in [(915,412,'land'),(800,1280,'tablet'),(1440,900,'desktop')]:
            ctx = await b.new_context(viewport={"width":w,"height":h}, device_scale_factor=1, is_mobile=w<1000, has_touch=w<1000)
            pg = await ctx.new_page()
            errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
            await pg.add_init_script("localStorage.setItem('droneforge.onboarded','1')")
            await pg.goto("file:///home/claude/dfm/www/index.html#simulation"); await pg.wait_for_timeout(1500)
            await pg.screenshot(path=f"shots/v-{name}.png")
            print(name, errs, await pg.evaluate("[document.documentElement.scrollWidth, innerWidth]"))
            await ctx.close()
        await b.close()
asyncio.run(main())
