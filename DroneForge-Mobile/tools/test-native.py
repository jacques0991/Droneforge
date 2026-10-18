import asyncio
from playwright.async_api import async_playwright
MOCK = """
window.__log=[]; window.__back=null;
Object.defineProperty(window,'DFNative',{configurable:true,get(){return window.__mock},set(v){/* le vrai pont ne s'installe pas en test */}});
window.__mock={isNative:true,platform:'android',
 saveAndShare:async(n,t)=>{__log.push('share:'+n+':'+t.length)}, copy:async t=>{__log.push('copy:'+t.length)},
 onBack:h=>{window.__back=h}, onPause:f=>{window.__pause=f}, onResume:f=>{}, hideSplash:()=>{__log.push('splash')}, tap:()=>{}};
"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader"])
        ctx = await b.new_context(viewport={"width":412,"height":800}, is_mobile=True, has_touch=True)
        await ctx.add_init_script(MOCK)
        pg = await ctx.new_page(); errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file:///home/claude/dfm/www/index.html"); await pg.wait_for_timeout(1500)
        r = lambda: pg.evaluate("[!!document.querySelector('.modal'), location.hash, window.__back ? 'ok':'none']")
        print("démarrage (présentation ouverte) :", await r())
        print("retour ->", await pg.evaluate("__back()"), await r())
        await pg.tap("#tabbtn-simulation"); await pg.tap("#tabbtn-lab"); await pg.wait_for_timeout(200)
        print("onglets visités :", await r())
        print("retour ->", await pg.evaluate("__back()"), await r())
        print("retour ->", await pg.evaluate("__back()"), await r())
        print("retour (rien à fermer) ->", await pg.evaluate("__back()"), "=> l'app passe en arrière-plan")
        await pg.tap("#btn-menu"); await pg.tap("text=Exporter le projet"); await pg.wait_for_timeout(200)
        await pg.tap(".modal >> text=Télécharger"); await pg.wait_for_timeout(300)
        await pg.evaluate("__pause && __pause()")
        print("journal natif :", await pg.evaluate("__log"))
        print("erreurs :", errs)
        await b.close()
asyncio.run(main())
