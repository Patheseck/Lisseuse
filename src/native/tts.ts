import { TextToSpeech } from '@capacitor-community/text-to-speech';
import { speechLanguage } from '../core/language';
import { isNative } from './platform';

// Lecture à voix haute, paragraphe par paragraphe (pour pouvoir suivre et s'arrêter).

let session = 0;

export function ttsAvailable(): boolean {
  return isNative() || (typeof window !== 'undefined' && 'speechSynthesis' in window);
}

function speakWeb(text: string, lang: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.onend = () => resolve();
    u.onerror = (e) => (e.error === 'interrupted' || e.error === 'canceled' ? resolve() : reject(new Error(e.error)));
    window.speechSynthesis.speak(u);
  });
}

/**
 * Lit les textes dans l'ordre, dans la langue du livre. `onStart(i)` est appelé au début de
 * chacun. S'arrête avec stop().
 */
export async function speak(texts: string[], language: string | null | undefined, onStart: (index: number) => void, rate = 1): Promise<void> {
  const id = ++session;
  const lang = speechLanguage(language);
  for (let i = 0; i < texts.length; i++) {
    if (id !== session) return;
    const text = texts[i]!.trim();
    if (!text) continue;
    onStart(i);
    if (isNative()) await TextToSpeech.speak({ text, lang, rate, category: 'playback' });
    else await speakWeb(text, lang);
  }
}

export async function stop(): Promise<void> {
  session++;
  if (isNative()) await TextToSpeech.stop().catch(() => undefined);
  else if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
