import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { isNative } from './platform';

// Lecture à voix haute, paragraphe par paragraphe (pour pouvoir suivre et s'arrêter).

let session = 0;

export function ttsAvailable(): boolean {
  return isNative() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

function speakWeb(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'fr-FR';
    u.onend = () => resolve();
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error(e.error)));
    window.speechSynthesis.speak(u);
  });
}

/** Lit les textes dans l'ordre. `onStart(i)` est appelé au début de chacun. S'arrête avec stop(). */
export async function speak(texts: string[], onStart: (index: number) => void, rate = 1): Promise<void> {
  const id = ++session;
  for (let i = 0; i < texts.length; i++) {
    if (id !== session) return;
    const text = texts[i]!.trim();
    if (!text) continue;
    onStart(i);
    if (isNative()) await TextToSpeech.speak({ text, lang: 'fr-FR', rate, category: 'playback' });
    else await speakWeb(text);
  }
}

export async function stop(): Promise<void> {
  session++;
  if (isNative()) await TextToSpeech.stop().catch(() => undefined);
  else if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
