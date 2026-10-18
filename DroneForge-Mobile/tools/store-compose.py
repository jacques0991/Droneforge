import asyncio, base64
from playwright.async_api import async_playwright
FONT = open('www/css/fonts.css').read().replace('url(../fonts/', 'url(file:///home/claude/dfm/www/fonts/')
def b64(p): return 'data:image/png;base64,' + base64.b64encode(open(p,'rb').read()).decode()
SHOTS = [
 ('1-moteur', 'Concevez votre moteur', 'Poussée, courant, température et autonomie calculés en direct'),
 ('2-vol', 'Faites-le voler', 'Simulation à 6 degrés de liberté, avec vent, rafales et batterie'),
 ('3-ia', 'Entraînez une IA', 'Un réseau de neurones apprend à piloter, sur votre téléphone'),
 ('4-carte', 'Explorez l\'électronique', 'Contrôleur de vol et ESC en 3D, bus et alimentation vérifiés'),
 ('5-fiabilite', 'Mesurez la fiabilité', '6 scénarios de test, score sur 100 et export vers votre drone'),
 ('6-production', 'Passez à la production', 'Nomenclature, coûts en FCFA, euros ou dollars, temps d\'assemblage'),
]
FRAME = """<html><head><style>{font}
*{{box-sizing:border-box}} body{{margin:0;width:1080px;height:1920px;background:radial-gradient(120% 70% at 50% 0%,#1a2a44 0%,#0a0f18 60%);font-family:Inter,sans-serif;color:#dfe7f1;overflow:hidden;position:relative}}
.cap{{position:absolute;top:96px;left:80px;right:80px}}
.cap h1{{margin:0;font-size:76px;line-height:1.05;font-weight:800;letter-spacing:-.025em}}
.cap h1 b{{color:#ff8a3d;font-weight:800}}
.cap p{{margin:22px 0 0;font-size:36px;line-height:1.35;color:#8fa3bd;font-weight:500;max-width:880px}}
.phone{{position:absolute;left:118px;top:420px;width:844px;height:1500px;border-radius:56px 56px 0 0;border:10px solid #2b3c56;border-bottom:0;overflow:hidden;box-shadow:0 40px 120px rgba(0,0,0,.6);background:#0a0f18}}
.phone img{{width:100%;display:block}}
</style></head><body><div class="cap"><h1>{title}</h1><p>{sub}</p></div><div class="phone"><img src="{img}"></div></body></html>"""
FEATURE = """<html><head><style>{font}
*{{box-sizing:border-box}} body{{margin:0;width:1024px;height:500px;background:radial-gradient(90% 120% at 75% 30%,#1a2a44 0%,#0a0f18 65%);font-family:Inter,sans-serif;color:#dfe7f1;overflow:hidden;position:relative}}
.grid{{position:absolute;inset:0;background-image:linear-gradient(#1f2c41 1px,transparent 1px),linear-gradient(90deg,#1f2c41 1px,transparent 1px);background-size:48px 48px;opacity:.45;mask-image:radial-gradient(70% 90% at 75% 50%,#000,transparent)}}
.t{{position:absolute;left:56px;top:110px;width:430px}}
.logo{{display:flex;align-items:center;gap:16px}}
.logo i{{width:60px;height:60px;border-radius:14px;background:#ff8a3d;color:#1c0e04;display:grid;place-items:center;font:800 24px 'JetBrains Mono',monospace;font-style:normal}}
.logo span{{font-size:52px;font-weight:800;letter-spacing:-.02em}}
p{{margin:24px 0 0;font-size:25px;line-height:1.35;color:#9fb1c8;font-weight:500}}
p b{{color:#ff8a3d;font-weight:700}}
.ph{{position:absolute;right:56px;top:48px;width:236px;height:470px;border-radius:30px 30px 0 0;border:6px solid #2b3c56;border-bottom:0;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.6)}}
.ph2{{right:312px;top:96px;width:200px;height:420px;opacity:.9}}
.ph img{{width:100%;display:block}}
</style></head><body><div class="grid"></div>
<div class="ph ph2"><img src="{img2}"></div><div class="ph"><img src="{img1}"></div>
<div class="t"><div class="logo"><i>DF</i><span>DroneForge</span></div><p>Concevez, simulez et entraînez l'<b>IA</b> de votre drone, directement sur votre téléphone.</p></div></body></html>"""
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch()
        pg = await b.new_page(viewport={'width':1080,'height':1920})
        for i,(f,t,s) in enumerate(SHOTS):
            title = t.replace('IA', '<b>IA</b>') if 'IA' in t else t
            await pg.set_content(FRAME.format(font=FONT, title=title, sub=s, img=b64(f'store/raw/{f}.png')))
            await pg.wait_for_timeout(300)
            await pg.screenshot(path=f'store/capture-{i+1}.png')
        pg2 = await b.new_page(viewport={'width':1024,'height':500})
        await pg2.set_content(FEATURE.format(font=FONT, img1=b64('store/raw/2-vol.png'), img2=b64('store/raw/1-moteur.png')))
        await pg2.wait_for_timeout(300)
        await pg2.screenshot(path='store/image-presentation-1024x500.png')
        await b.close()
asyncio.run(main())
