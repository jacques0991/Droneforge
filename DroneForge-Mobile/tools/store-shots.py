import asyncio, json
from playwright.async_api import async_playwright
pol=json.load(open('../df/pol190.json'))
m1=json.load(open('../df/model_ppo.json')); m1['name']='PPO · poursuite'; m1['id']='m_ppo1'
m2=json.load(open('../df/model_es.json')); m2['name']='ES · rejoindre un point'; m2['id']='m_es1'
for m in (m1,m2): m['stats']['timeMs']=m['stats'].get('timeMs') or 52000
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=["--use-gl=swiftshader","--enable-unsafe-swiftshader"])
        ctx = await b.new_context(viewport={"width":411,"height":731}, device_scale_factor=2.6276, is_mobile=True, has_touch=True)
        await ctx.add_init_script("""
          localStorage.setItem('droneforge.onboarded','1');
          if(!localStorage.getItem('seeded')){
            localStorage.setItem('seeded','1');
            localStorage.setItem('droneforge.policy.v2', JSON.stringify({weights:%s, stats:{updates:186, ok:1}}));
            localStorage.setItem('droneforge.lab.v1', JSON.stringify({models:[%s,%s], sel:'m_ppo1', evalOpts:{n:100,drone:'train',seed:2026}}));
          }""" % (json.dumps(pol), json.dumps(m1), json.dumps(m2)))
        pg = await ctx.new_page()
        errs=[]; pg.on("pageerror", lambda e: errs.append(str(e)))
        await pg.goto("file:///home/claude/dfm/www/index.html#motor"); await pg.wait_for_timeout(1800)
        await pg.screenshot(path="store/raw/1-moteur.png")
        await pg.tap("#tabbtn-simulation"); await pg.wait_for_timeout(300)
        await pg.tap("#tab-simulation >> text=Décoller"); await pg.wait_for_timeout(9000)
        await pg.screenshot(path="store/raw/2-vol.png")
        await pg.tap("#tabbtn-ai"); await pg.wait_for_timeout(1200)
        await pg.screenshot(path="store/raw/3-ia.png")
        await pg.tap("#tabbtn-motherboard"); await pg.wait_for_timeout(600)
        await pg.evaluate("document.querySelector('#side-panel').scrollTop=0")
        await pg.screenshot(path="store/raw/4-carte.png")
        await pg.tap("#tabbtn-lab"); await pg.wait_for_timeout(400)
        await pg.tap(".lab-card >> nth=0"); await pg.wait_for_timeout(300)
        await pg.tap(".lab-main > .seg button:has-text('Fiabilité')"); await pg.wait_for_timeout(600)
        await pg.evaluate("document.querySelector('.lab-score').scrollIntoView({block:'start'})"); await pg.wait_for_timeout(300)
        await pg.screenshot(path="store/raw/5-fiabilite.png")
        await pg.tap("#tabbtn-production"); await pg.wait_for_timeout(500)
        await pg.evaluate("const r=document.querySelector('#p-explode'); r.value=0.7; r.dispatchEvent(new Event('input'))"); await pg.wait_for_timeout(1200)
        await pg.evaluate("document.querySelector('#side-panel').scrollTop=0")
        await pg.screenshot(path="store/raw/6-production.png")
        print(errs)
        await b.close()
asyncio.run(main())
