import { crossfadeFor, DEFAULT_VOLUME, DUCK_FACTOR, effectiveVolume, resumeOrder, shuffled, type ResumePoint } from '../core/ambiances';
import { logError } from '../core/errors';
import { listTracks, loadResumePoints, saveResumePoints, type AudioTrack } from '../storage/audio';

// Lecteur des ambiances : deux pistes qui se relaient pour enchaîner les morceaux en fondu,
// dans un ordre mélangé, en boucle. La musique s'arrête quand l'écran s'éteint ou que l'app
// passe en arrière-plan, et reprend au retour. Chaque ambiance retient où elle s'est arrêtée
// (morceau et seconde) : en revenant au livre, même après un redémarrage de l'app, elle reprend là.

export type PlayerState = 'stopped' | 'playing' | 'paused';

const FADE_IN_MS = 2500;
const FADE_OUT_MS = 1200;
const DUCK_MS = 400;
const TICK_MS = 50;
/** Fréquence d'enregistrement de la position pendant la lecture. */
const REMEMBER_MS = 5000;

interface Deck {
  el: HTMLAudioElement;
  url: string | null;
  track: AudioTrack | null;
  /** Gain du fondu (0 à 1) et sa cible ; `step` : variation par milliseconde. */
  fade: number;
  target: number;
  step: number;
}

export class AmbiancePlayer {
  private readonly decks: [Deck, Deck];
  private active: 0 | 1 = 0;
  private queue: AudioTrack[] = [];
  private position = 0;
  private ambianceId: string | null = null;
  private master = DEFAULT_VOLUME;
  private duck = 1;
  private duckTarget = 1;
  private state: PlayerState = 'stopped';
  private pausedByVisibility = false;
  private crossfading = false;
  private failures = 0;
  private timer: number | undefined;
  private lastTick = 0;
  private resumePoints: Record<string, ResumePoint> | null = null;
  private lastRemembered = 0;
  private readonly listeners = new Set<() => void>();
  /** Message de la dernière erreur de lecture (fichiers illisibles), pour l'interface. */
  lastError: string | null = null;

  constructor() {
    this.decks = [this.makeDeck(0), this.makeDeck(1)];
    document.addEventListener('visibilitychange', () => this.onVisibility());
  }

  get current(): string | null {
    return this.ambianceId;
  }

  get playing(): PlayerState {
    return this.state;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Joue une ambiance (sans effet si elle joue déjà). False si elle n'a aucun morceau. */
  async play(ambianceId: string): Promise<boolean> {
    if (this.ambianceId === ambianceId && this.state !== 'stopped') {
      if (this.state === 'paused') this.resume();
      return true;
    }
    const tracks = await listTracks(ambianceId);
    if (!tracks.length) {
      this.stop();
      return false;
    }
    this.resumePoints ??= await loadResumePoints().catch(() => ({}));
    const { queue, offset } = resumeOrder(tracks, this.resumePoints[ambianceId]);
    this.ambianceId = ambianceId;
    this.queue = queue;
    this.position = 0;
    this.failures = 0;
    this.lastError = null;
    this.state = 'playing';
    this.start(this.queue[0]!, FADE_IN_MS, offset);
    this.emit();
    return true;
  }

  /**
   * Morceaux de l'ambiance modifiés (ajout, retrait) : la liste est relue sans couper le
   * morceau en cours ; l'ambiance s'arrête si elle n'a plus aucun morceau.
   */
  async refresh(ambianceId: string): Promise<void> {
    if (this.ambianceId !== ambianceId) return;
    const tracks = await listTracks(ambianceId);
    if (!tracks.length) {
      this.stop();
      return;
    }
    this.queue = shuffled(tracks);
    this.position = -1; // le morceau suivant sera le premier de la nouvelle liste
  }

  /** Arrête en fondu et oublie l'ambiance en cours. */
  stop(fadeMs = FADE_OUT_MS): void {
    if (this.state === 'stopped' && !this.ambianceId) return;
    this.remember();
    this.state = 'stopped';
    this.ambianceId = null;
    this.pausedByVisibility = false;
    for (const deck of this.decks) this.fadeTo(deck, 0, fadeMs);
    this.emit();
  }

  /** Pause choisie (bouton) : l'ambiance reste celle du livre. */
  pause(): void {
    if (this.state !== 'playing') return;
    this.remember();
    this.state = 'paused';
    for (const deck of this.decks) this.fadeTo(deck, 0, 500);
    this.emit();
  }

  resume(): void {
    if (this.state !== 'paused' || !this.queue.length) return;
    this.state = 'playing';
    const deck = this.decks[this.active];
    void deck.el.play().catch((err: unknown) => this.onDeckError(deck, err));
    this.fadeTo(deck, 1, 800);
    this.emit();
  }

  setVolume(volume: number): void {
    this.master = Math.min(1, Math.max(0, volume));
    this.applyVolumes();
  }

  /** Atténue la musique pendant la lecture à voix haute. */
  setDucked(ducked: boolean): void {
    this.duckTarget = ducked ? DUCK_FACTOR : 1;
    this.ensureTicking();
  }

  // ---------- Pistes ----------

  private makeDeck(index: 0 | 1): Deck {
    const el = new Audio();
    el.preload = 'auto';
    const deck: Deck = { el, url: null, track: null, fade: 0, target: 0, step: 0 };
    el.addEventListener('timeupdate', () => {
      if (index !== this.active || this.state !== 'playing' || this.crossfading) return;
      if (performance.now() - this.lastRemembered > REMEMBER_MS) this.remember();
      const fade = crossfadeFor(el.duration);
      if (Number.isFinite(el.duration) && el.duration - el.currentTime <= fade) {
        this.crossfading = true;
        this.next(fade * 1000);
      }
    });
    el.addEventListener('ended', () => {
      if (index === this.active && this.state === 'playing' && !this.crossfading) this.next(300);
    });
    el.addEventListener('playing', () => {
      this.failures = 0;
    });
    el.addEventListener('error', () => this.onDeckError(deck, el.error));
    return deck;
  }

  /** Lance un morceau sur la piste libre, à partir de `offset` secondes, en fondu. */
  private start(track: AudioTrack, fadeMs: number, offset = 0): void {
    const previous = this.decks[this.active];
    const idle: 0 | 1 = this.active === 0 ? 1 : 0;
    const deck = this.decks[idle];
    this.release(deck);
    deck.url = URL.createObjectURL(track.blob);
    deck.track = track;
    deck.el.src = deck.url;
    if (offset > 0) {
      // Avant le chargement, la position demandée devient la position de départ ; on la
      // réapplique une fois la durée connue (au-delà de la fin, le morceau suivant enchaîne).
      deck.el.currentTime = offset;
      deck.el.addEventListener('loadedmetadata', () => {
        if (deck.track === track && Math.abs(deck.el.currentTime - offset) > 1) deck.el.currentTime = Math.min(offset, Math.max(0, deck.el.duration - 0.5));
      }, { once: true });
    }
    deck.fade = 0;
    this.applyVolume(deck);
    void deck.el.play().catch((err: unknown) => this.onDeckError(deck, err));
    this.active = idle;
    this.crossfading = false;
    this.fadeTo(deck, 1, fadeMs);
    if (previous.url) this.fadeTo(previous, 0, fadeMs);
  }

  /** Morceau suivant ; nouvel ordre mélangé à la fin de la liste (sans répéter le dernier). */
  private next(fadeMs: number): void {
    if (!this.queue.length) return;
    this.position++;
    if (this.position >= this.queue.length) {
      const last = this.queue.at(-1);
      this.queue = shuffled(this.queue);
      if (this.queue.length > 1 && this.queue[0] === last) this.queue.push(this.queue.shift()!);
      this.position = 0;
    }
    this.start(this.queue[this.position]!, fadeMs);
  }

  private onDeckError(deck: Deck, err: unknown): void {
    // Une piste qu'on éteint ou qu'on recharge peut signaler une interruption : sans gravité.
    if (deck !== this.decks[this.active] || this.state !== 'playing') return;
    if ((err as { name?: string } | null)?.name === 'AbortError') return;
    logError('ambiance', err ?? new Error('lecture audio impossible'));
    this.failures++;
    if (this.failures >= this.queue.length) {
      this.lastError = 'Ces morceaux ne peuvent pas être lus sur cet appareil (format non pris en charge ?).';
      this.stop(0);
      return;
    }
    this.next(300);
  }

  private release(deck: Deck): void {
    deck.el.pause();
    deck.el.removeAttribute('src');
    deck.el.load();
    if (deck.url) URL.revokeObjectURL(deck.url);
    deck.url = null;
    deck.track = null;
    deck.fade = 0;
    deck.target = 0;
  }

  // ---------- Fondus ----------

  private fadeTo(deck: Deck, target: number, ms: number): void {
    deck.target = target;
    deck.step = ms > 0 ? 1 / ms : Infinity;
    this.ensureTicking();
  }

  private ensureTicking(): void {
    if (this.timer !== undefined) return;
    this.lastTick = performance.now();
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  private tick(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    let busy = false;
    for (const deck of this.decks) {
      if (deck.fade !== deck.target) {
        const delta = deck.step * dt;
        deck.fade = deck.fade < deck.target ? Math.min(deck.target, deck.fade + delta) : Math.max(deck.target, deck.fade - delta);
        busy ||= deck.fade !== deck.target;
      }
      // Fondu de sortie terminé (ou piste déjà muette, par exemple arrêtée au tout début d'un
      // fondu d'entrée) : on libère la piste, sauf en pause où elle reste chargée. Sans cela,
      // elle continuerait de jouer en silence.
      if (deck.fade === 0 && deck.target === 0 && deck.url) {
        if (this.state === 'paused' && deck === this.decks[this.active]) {
          if (!deck.el.paused) deck.el.pause();
        } else {
          this.release(deck);
        }
      }
    }
    if (this.duck !== this.duckTarget) {
      const delta = (dt / DUCK_MS) * (1 - DUCK_FACTOR);
      this.duck = this.duck < this.duckTarget ? Math.min(this.duckTarget, this.duck + delta) : Math.max(this.duckTarget, this.duck - delta);
      busy ||= this.duck !== this.duckTarget;
    }
    this.applyVolumes();
    if (!busy) {
      window.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private applyVolume(deck: Deck): void {
    deck.el.volume = effectiveVolume(this.master, deck.fade, this.duck);
  }

  private applyVolumes(): void {
    for (const deck of this.decks) this.applyVolume(deck);
  }

  // ---------- Écran éteint, autre app ----------

  /** Enregistre où en est l'ambiance (Android peut fermer l'app pendant qu'elle est cachée). */
  private remember(): void {
    const deck = this.decks[this.active];
    if (!this.ambianceId || !deck.track || !Number.isFinite(deck.el.currentTime)) return;
    this.lastRemembered = performance.now();
    this.resumePoints = { ...(this.resumePoints ?? {}), [this.ambianceId]: { trackId: deck.track.id, time: deck.el.currentTime, at: Date.now() } };
    saveResumePoints(this.resumePoints).catch((err: unknown) => logError('ambiance', err));
  }

  private onVisibility(): void {
    if (document.visibilityState === 'hidden') {
      if (this.state !== 'playing') return;
      this.remember();
      this.pausedByVisibility = true;
      for (const deck of this.decks) deck.el.pause();
      return;
    }
    if (!this.pausedByVisibility) return;
    this.pausedByVisibility = false;
    if (this.state !== 'playing') return;
    const deck = this.decks[this.active];
    deck.fade = 0;
    this.applyVolume(deck);
    void deck.el.play().catch((err: unknown) => this.onDeckError(deck, err));
    this.fadeTo(deck, 1, 1000);
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

let instance: AmbiancePlayer | null = null;

/** Lecteur unique de l'app (il survit au changement d'écran pour finir ses fondus). */
export function ambiancePlayer(): AmbiancePlayer {
  instance ??= new AmbiancePlayer();
  return instance;
}
