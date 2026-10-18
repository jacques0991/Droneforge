// Pont entre l'interface web et Android (Capacitor). Compilé dans www/native.js.
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Filesystem, Directory, Encoding } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { SplashScreen } from '@capacitor/splash-screen';
import { Clipboard } from '@capacitor/clipboard';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

const isNative = Capacitor.isNativePlatform();
const safeName = n => String(n || 'droneforge.txt').replace(/[^\w.\-]+/g, '_').slice(0, 120);

window.DFNative = {
  isNative,
  platform: Capacitor.getPlatform(),
  async saveAndShare(name, text) {
    const path = safeName(name);
    const r = await Filesystem.writeFile({ path, data: text, directory: Directory.Cache, encoding: Encoding.UTF8, recursive: true });
    await Share.share({ title: path, files: [r.uri], dialogTitle: 'Enregistrer ou partager ' + path });
  },
  async copy(text) { await Clipboard.write({ string: text }); },
  onBack(handler) {
    App.addListener('backButton', () => { let handled = false; try { handled = handler(); } catch (e) { handled = false; } if (!handled) App.minimizeApp(); });
  },
  onPause(fn) { App.addListener('pause', () => { try { fn(); } catch (e) { /* rien */ } }); },
  onResume(fn) { App.addListener('resume', () => { try { fn(); } catch (e) { /* rien */ } }); },
  hideSplash() { return SplashScreen.hide({ fadeOutDuration: 250 }).catch(() => {}); },
  tap() { if (isNative) Haptics.impact({ style: ImpactStyle.Light }).catch(() => {}); },
};
