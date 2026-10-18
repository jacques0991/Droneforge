// Assemble l'application web hors ligne dans www/ (aucune ressource réseau).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = p => path.join(root, 'src', p);
const www = p => path.join(root, 'www', p);
fs.rmSync(www(''), { recursive: true, force: true });
for (const d of ['', 'js', 'css', 'fonts', 'vendor']) fs.mkdirSync(www(d), { recursive: true });

// Bibliothèques 3D embarquées
fs.copyFileSync(path.join(root, 'node_modules/three/build/three.min.js'), www('vendor/three.min.js'));
fs.copyFileSync(path.join(root, 'node_modules/three/examples/js/controls/OrbitControls.js'), www('vendor/OrbitControls.js'));
fs.copyFileSync(path.join(root, 'node_modules/three/LICENSE'), www('vendor/three-LICENSE.txt'));

// Polices embarquées (latin + latin étendu)
const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const LATIN_EXT = 'U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF';
let fontCss = '';
const fam = [['Inter', 'inter', 'inter', [400, 500, 600, 700, 800]], ['JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono', [400, 500, 600, 700]]];
for (const [name, pkg, pre, weights] of fam) {
  for (const w of weights) for (const [sub, range] of [['latin', LATIN], ['latin-ext', LATIN_EXT]]) {
    const f = `${pre}-${sub}-${w}-normal.woff2`;
    fs.copyFileSync(path.join(root, `node_modules/@fontsource/${pkg}/files/${f}`), www('fonts/' + f));
    fontCss += `@font-face{font-family:'${name}';font-style:normal;font-display:swap;font-weight:${w};src:url(../fonts/${f}) format('woff2');unicode-range:${range}}\n`;
  }
  const lic = path.join(root, `node_modules/@fontsource/${pkg}/LICENSE`);
  if (fs.existsSync(lic)) fs.copyFileSync(lic, www(`fonts/${pkg}-LICENSE.txt`));
}
fs.writeFileSync(www('css/fonts.css'), fontCss);
fs.copyFileSync(src('style.css'), www('css/style.css'));
for (const f of ['core.js', 'lab.js', 'app.js']) fs.copyFileSync(src(f), www('js/' + f));

// Pont natif
await build({ entryPoints: [src('native.js')], bundle: true, format: 'iife', target: 'es2020', minify: true, outfile: www('js/native.js'), logLevel: 'warning' });

const body = fs.readFileSync(src('body.html'), 'utf8');
const html = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
<meta name="theme-color" content="#0a0f18">
<meta name="color-scheme" content="dark">
<meta http-equiv="Content-Security-Policy" content="default-src 'self' capacitor: https://localhost http://localhost; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' capacitor: https://localhost http://localhost; worker-src 'self' blob:">
<title>DroneForge</title>
<link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="css/fonts.css">
<link rel="stylesheet" href="css/style.css">
</head>
<body>
${body}
<script src="vendor/three.min.js"></script>
<script src="vendor/OrbitControls.js"></script>
<script src="js/native.js"></script>
<script src="js/core.js"></script>
<script src="js/lab.js"></script>
<script src="js/app.js"></script>
</body>
</html>
`;
fs.writeFileSync(www('index.html'), html);
fs.copyFileSync(path.join(root, 'assets/icon.svg'), www('icon.svg'));
console.log('www/ prêt :', fs.readdirSync(www('')).join(', '));
