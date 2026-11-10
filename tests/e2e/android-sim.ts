import type { Page } from '@playwright/test';

// L'app Android est simulée dans le navigateur : pont de Capacitor (window.androidBridge et
// window.Capacitor, comme les injecte la WebView), modules natifs, et un Google Drive en mémoire
// à la place du sélecteur de documents d'Android (BackupFilePlugin.java). Le reste est le vrai code.

export const DRIVE = 'com.google.android.apps.docs.storage';

export interface FakeAndroid {
  files: Map<string, string>;
  granted: Set<string>;
  /** Fichiers que le sélecteur « choisira » ensuite (pour « Restaurer une sauvegarde de Google Drive »). */
  picks: string[];
  calls: string[];
  fire(plugin: string, event: string, data: unknown): void;
}

declare global {
  interface Window {
    __android: FakeAndroid;
  }
}

/** Simule l'app Android dans la page (à appeler avant page.goto). */
export async function simulateAndroid(page: Page, drive: Record<string, string> = {}, picks: string[] = []): Promise<void> {
  await page.addInitScript(({ drive, picks, DRIVE }) => {
    const methods: Record<string, string[]> = {
      App: ['addListener', 'removeListener', 'removeAllListeners', 'getLaunchUrl', 'minimizeApp', 'getInfo', 'getState', 'exitApp'],
      SystemBars: ['setStyle', 'show', 'hide', 'setAnimation'],
      ReaderNative: ['setCustomSelection', 'setImmersive', 'setKeepAwake', 'setVolumeKeys', 'setWindowBackground', 'addListener', 'removeListener'],
      LocalNotifications: ['schedule', 'cancel', 'checkPermissions', 'requestPermissions', 'getPending', 'createChannel', 'addListener', 'removeListener'],
      Filesystem: ['writeFile', 'readFile', 'deleteFile', 'stat', 'getUri', 'mkdir'],
      BackupFile: ['create', 'open', 'info', 'write', 'release'],
      Haptics: ['impact', 'vibrate'],
      Share: ['share', 'canShare'],
      Clipboard: ['write', 'read'],
      TextToSpeech: ['speak', 'stop', 'getSupportedVoices', 'getSupportedLanguages', 'isLanguageSupported', 'addListener', 'removeListener'],
    };
    const listeners = new Map<string, ((data: unknown) => void)[]>();
    const cache = new Map<string, string>();
    const files = new Map(Object.entries(drive));
    const names = new Map([...files.keys()].map((uri) => [uri, 'Liseuse - sauvegarde.json']));
    const granted = new Set<string>();
    let nextDoc = 100;
    const fail = (message: string, code: string) => Object.assign(new Error(message), { code });
    const info = (uri: string) => ({ uri, provider: DRIVE, name: names.get(uri), readable: granted.has(uri), writable: granted.has(uri), exists: files.has(uri) });
    const handlers: Record<string, (o: Record<string, string>) => unknown> = {
      'Filesystem.writeFile': ({ path, data }) => {
        cache.set(path!, data!);
        return { uri: `file:///data/user/0/com.patheseck.liseuse/cache/${path}` };
      },
      'Filesystem.deleteFile': ({ path }) => cache.delete(path!) && {},
      'BackupFile.create': ({ fileName }) => {
        const uri = `content://${DRIVE}/document/acc%3D1%3Bdoc%3D${nextDoc++}`;
        files.set(uri, '');
        names.set(uri, fileName!);
        granted.add(uri);
        return info(uri);
      },
      'BackupFile.open': () => {
        const uri = android.picks.shift();
        if (!uri) throw fail('Aucun fichier choisi.', 'CANCELLED');
        granted.add(uri);
        return info(uri);
      },
      'BackupFile.info': ({ uri }) => info(uri!),
      'BackupFile.write': ({ uri, from }) => {
        if (!files.has(uri!)) throw fail('Le fichier de sauvegarde est introuvable (supprimé ou déplacé).', 'NOT_FOUND');
        if (!granted.has(uri!)) throw fail('Liseuse n’a plus le droit d’écrire dans ce fichier.', 'ACCESS_LOST');
        const text = cache.get(from!.split('/cache/')[1]!)!;
        files.set(uri!, text);
        return { ...info(uri!), written: new TextEncoder().encode(text).length };
      },
      'BackupFile.release': ({ uri }) => granted.delete(uri!) && {},
    };
    const android: FakeAndroid = {
      files,
      granted,
      picks,
      calls: [],
      fire: (plugin, event, data) => (listeners.get(`${plugin}.${event}`) ?? []).forEach((cb) => cb(data)),
    };
    window.__android = android;
    (window as unknown as { androidBridge: object }).androidBridge = { postMessage() {} };
    (window as unknown as { Capacitor: object }).Capacitor = {
      PluginHeaders: Object.entries(methods).map(([name, list]) => ({ name, methods: list.map((m) => ({ name: m, rtype: m === 'addListener' ? 'callback' : 'promise' })) })),
      nativeCallback(plugin: string, method: string, options: { eventName?: string }, callback: (data: unknown) => void) {
        if (method === 'addListener') listeners.set(`${plugin}.${options.eventName}`, [...(listeners.get(`${plugin}.${options.eventName}`) ?? []), callback]);
        return String(Math.random());
      },
      async nativePromise(plugin: string, method: string, options: Record<string, string> = {}) {
        android.calls.push(`${plugin}.${method}`);
        return handlers[`${plugin}.${method}`]?.(options) ?? {};
      },
      // Comme dans la WebView : les adresses content:// sont servies par l'app elle-même.
      convertFileSrc: (path: string) => (path.startsWith('content://') ? `${location.origin}/_capacitor_content_/${path.slice('content://'.length)}` : path),
    };
  }, { drive, picks, DRIVE });
  await page.route('**/_capacitor_content_/**', async (route) => {
    const uri = `content://${new URL(route.request().url()).pathname.replace('/_capacitor_content_/', '')}`;
    const text = await page.evaluate((u) => (window.__android.granted.has(u) ? window.__android.files.get(u) ?? null : null), uri);
    await (text === null ? route.fulfill({ status: 404 }) : route.fulfill({ status: 200, contentType: 'application/octet-stream', body: text }));
  });
}

export const driveFiles = (page: Page) => page.evaluate(() => Object.fromEntries(window.__android.files));
export const writes = (page: Page) => page.evaluate(() => window.__android.calls.filter((c) => c === 'BackupFile.write').length);
/** L'app passe en arrière-plan (accueil, autre app, écran éteint). */
export const leaveApp = (page: Page) => page.evaluate(() => window.__android.fire('App', 'appStateChange', { isActive: false }));
