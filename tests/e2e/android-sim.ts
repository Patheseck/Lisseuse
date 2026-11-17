import type { Page } from '@playwright/test';

// L'app Android est simulée dans le navigateur : pont de Capacitor (window.androidBridge et
// window.Capacitor, comme les injecte la WebView), modules natifs, un Google Drive en mémoire à la
// place du sélecteur de documents d'Android (BackupFilePlugin.java) et des fichiers « dans le
// téléphone » pour la recherche (StorageScanPlugin.java). Le reste est le vrai code.

export const DRIVE = 'com.google.android.apps.docs.storage';

export interface FakeAndroid {
  files: Map<string, string>;
  granted: Set<string>;
  /** Fichiers que le sélecteur « choisira » ensuite (pour « Restaurer une sauvegarde de Google Drive »). */
  picks: string[];
  /** Fichiers existants touchés dans le sélecteur d'enregistrement (« Remplacer ? » → oui), au lieu d'en créer un. */
  overwrites: string[];
  calls: string[];
  /** Mémoire du téléphone : autorisation « Accès à tous les fichiers », et fichiers (chemin → contenu). */
  storage: { granted: boolean; grantOnRequest: boolean; files: Map<string, { content: string; modified: number }> };
  fire(plugin: string, event: string, data: unknown): void;
}

/** Fichier posé dans la mémoire du téléphone simulé. */
export interface PhoneFile {
  path: string;
  content: string;
  modified?: number;
}

declare global {
  interface Window {
    __android: FakeAndroid;
  }
}

/** Simule l'app Android dans la page (à appeler avant page.goto). */
export async function simulateAndroid(page: Page, drive: Record<string, string> = {}, picks: string[] = [], overwrites: string[] = [], phone: { files?: PhoneFile[]; grantOnRequest?: boolean } = {}): Promise<void> {
  await page.addInitScript(({ drive, picks, overwrites, phoneFiles, grantOnRequest, DRIVE }) => {
    const methods: Record<string, string[]> = {
      App: ['addListener', 'removeListener', 'removeAllListeners', 'getLaunchUrl', 'minimizeApp', 'getInfo', 'getState', 'exitApp'],
      SystemBars: ['setStyle', 'show', 'hide', 'setAnimation'],
      ReaderNative: ['setCustomSelection', 'setImmersive', 'setKeepAwake', 'setVolumeKeys', 'setWindowBackground', 'addListener', 'removeListener'],
      LocalNotifications: ['schedule', 'cancel', 'checkPermissions', 'requestPermissions', 'getPending', 'createChannel', 'addListener', 'removeListener'],
      Filesystem: ['writeFile', 'readFile', 'deleteFile', 'stat', 'getUri', 'mkdir'],
      BackupFile: ['create', 'open', 'info', 'write', 'release'],
      StorageScan: ['status', 'request', 'scan'],
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
    const info = (uri: string) => ({ uri, provider: DRIVE, name: names.get(uri), size: new TextEncoder().encode(files.get(uri) ?? '').length, readable: granted.has(uri), writable: granted.has(uri), exists: files.has(uri) });
    const handlers: Record<string, (o: Record<string, string>) => unknown> = {
      'Filesystem.writeFile': ({ path, data }) => {
        cache.set(path!, data!);
        return { uri: `file:///data/user/0/com.patheseck.liseuse/cache/${path}` };
      },
      'Filesystem.deleteFile': ({ path }) => cache.delete(path!) && {},
      'BackupFile.create': ({ fileName }) => {
        const existing = android.overwrites.shift();
        if (existing) {
          granted.add(existing);
          return info(existing);
        }
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
      'StorageScan.status': () => ({ granted: android.storage.granted }),
      'StorageScan.request': () => {
        if (android.storage.grantOnRequest) android.storage.granted = true;
        return { granted: android.storage.granted };
      },
      'StorageScan.scan': (o) => {
        if (!android.storage.granted) throw fail('Liseuse n’a pas l’autorisation de parcourir les fichiers du téléphone.', 'DENIED');
        const { extensions, namePattern } = o as unknown as { extensions: string[]; namePattern?: string };
        const pattern = namePattern ? new RegExp(namePattern, 'i') : null;
        const found = [...android.storage.files].filter(([path]) => {
          const name = path.split('/').pop()!;
          return extensions.includes(name.split('.').pop()!.toLowerCase()) && (!pattern || pattern.test(name));
        });
        return {
          truncated: false,
          files: found.map(([path, f]) => {
            const parts = path.replace('/storage/emulated/0/', '').split('/');
            return { path, name: parts.pop(), size: new TextEncoder().encode(f.content).length, modified: f.modified, folder: parts.join('/'), volume: 'interne' };
          }),
        };
      },
    };
    const android: FakeAndroid = {
      files,
      granted,
      picks,
      overwrites,
      calls: [],
      storage: { granted: false, grantOnRequest, files: new Map(phoneFiles.map((f) => [f.path, { content: f.content, modified: f.modified ?? Date.parse('2026-11-01T10:00:00Z') }])) },
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
      // Comme dans la WebView : les adresses content:// et file:// sont servies par l'app elle-même.
      convertFileSrc: (path: string) => (path.startsWith('content://') ? `${location.origin}/_capacitor_content_/${path.slice('content://'.length)}` : path.startsWith('file://') ? `${location.origin}/_capacitor_file_${path.slice('file://'.length)}` : path),
    };
  }, { drive, picks, overwrites, phoneFiles: phone.files ?? [], grantOnRequest: phone.grantOnRequest ?? true, DRIVE });
  await page.route('**/_capacitor_content_/**', async (route) => {
    const uri = `content://${new URL(route.request().url()).pathname.replace('/_capacitor_content_/', '')}`;
    const text = await page.evaluate((u) => (window.__android.granted.has(u) ? window.__android.files.get(u) ?? null : null), uri);
    await (text === null ? route.fulfill({ status: 404 }) : route.fulfill({ status: 200, contentType: 'application/octet-stream', body: text }));
  });
  await page.route('**/_capacitor_file_/**', async (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.replace('/_capacitor_file_', ''));
    const text = await page.evaluate((p) => (window.__android.storage.granted ? window.__android.storage.files.get(p)?.content ?? null : null), path);
    await (text === null ? route.fulfill({ status: 404 }) : route.fulfill({ status: 200, contentType: 'application/octet-stream', body: text }));
  });
}

export const driveFiles = (page: Page) => page.evaluate(() => Object.fromEntries(window.__android.files));
export const writes = (page: Page) => page.evaluate(() => window.__android.calls.filter((c) => c === 'BackupFile.write').length);
/** L'app passe en arrière-plan (accueil, autre app, écran éteint). */
export const leaveApp = (page: Page) => page.evaluate(() => window.__android.fire('App', 'appStateChange', { isActive: false }));
