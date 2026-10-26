import { errorMessage, logError } from '../core/errors';
import { activity, calibration, forecast, retention } from '../core/stats';
import { TARGET_RETENTION } from '../core/scheduler';
import { listAllCards, listReviews } from '../storage/cards';
import { listBooks } from '../storage/library';
import { loadReviewSettings, saveReviewSettings } from '../storage/settings';
import { clear, h } from './dom';
import { toast } from './feedback';
import { icon } from './icons';
import type { Navigate, Screen } from './screen';

const pct = (x: number) => `${Math.round(x * 100)} %`;
const CONFIDENCE_LABELS = { 1: 'Je ne sais pas', 2: 'J’hésite', 3: 'Je sais' } as const;
const NEW_PER_DAY = { min: 0, max: 100, step: 5 };

function card(title: string, testId: string, ...children: (Node | string | null)[]): HTMLElement {
  return h('section', { className: 'stat-card', 'data-testid': testId }, h('h2', {}, title), ...children);
}

/** Colonnes des 7 prochains jours : une seule série, valeur affichée sur aujourd'hui et le maximum. */
function forecastChart(days: number[], now: number): HTMLElement {
  const max = Math.max(1, ...days);
  const peak = days.indexOf(Math.max(...days));
  const label = (i: number) => (i === 0 ? 'auj.' : new Date(now + i * 86400000).toLocaleDateString('fr-FR', { weekday: 'short' }));
  const cols = days.map((n, i) =>
    h('div', { className: 'col', title: `${label(i)} : ${n} fiche${n > 1 ? 's' : ''}`, role: 'listitem', 'aria-label': `${label(i)} : ${n} fiches` },
      h('span', { className: 'col-value' }, n && (i === 0 || i === peak) ? String(n) : ''),
      h('span', { className: 'col-bar', style: `height:${Math.round((n / max) * 100)}%` }),
      h('span', { className: 'col-label' }, label(i)),
    ));
  return h('div', { className: 'cols', role: 'list', 'aria-label': 'Fiches à revoir par jour' }, ...cols);
}

export function statsScreen(navigate: Navigate): Screen {
  const body = h('div', { className: 'stats-column' });
  const el = h('div', { className: 'screen stats-screen' },
    h('header', { className: 'topbar' },
      h('button', { type: 'button', className: 'icon-btn', 'aria-label': 'Retour à la bibliothèque', 'data-testid': 'back', onclick: () => navigate({ name: 'library' }) }, icon('back')),
      h('h1', { className: 'topbar-title' }, 'Ma mémoire'),
    ),
    h('main', { className: 'scroll' }, body),
    h('div'),
  );

  async function render(): Promise<void> {
    const [books, allCards, reviews, settings] = await Promise.all([listBooks(), listAllCards(), listReviews(), loadReviewSettings()]);
    const now = Date.now();
    const known = new Set(books.map((b) => b.id));
    const cards = allCards.filter((c) => known.has(c.bookId));
    const reviewable = cards.filter((c) => c.kind !== 'highlight');
    const days = forecast(reviewable, now);
    const newCount = reviewable.filter((c) => c.srs?.state === 0).length;
    const ret = retention(reviews, now);
    const cal = calibration(reviews);
    const act = activity(reviews, now);

    clear(body);
    body.append(
      h('p', { className: 'muted stats-totals' }, `${books.length} livre${books.length > 1 ? 's' : ''} · ${reviewable.length} fiche${reviewable.length > 1 ? 's' : ''} · ${cards.length - reviewable.length} passage${cards.length - reviewable.length > 1 ? 's' : ''} surligné${cards.length - reviewable.length > 1 ? 's' : ''}`),

      card('À réviser', 'stat-due',
        h('p', { className: 'hero' }, h('strong', { 'data-testid': 'due-today' }, String(days[0])), ` aujourd’hui${newCount ? ` · ${newCount} nouvelle${newCount > 1 ? 's' : ''} en attente` : ''}`),
        forecastChart(days, now),
        h('p', { className: 'hint' }, 'Revenir un peu chaque jour vaut mieux que réviser longtemps de temps en temps.'),
      ),

      card('Rétention réelle', 'stat-retention',
        ret.rate === null
          ? h('p', { className: 'muted' }, 'Pas encore de révision espacée : reviens dans quelques jours.')
          : h('div', {},
            h('p', { className: 'hero' }, h('strong', { 'data-testid': 'retention-rate' }, pct(ret.rate)), ` des rappels réussis sur 30 jours (${ret.count})`),
            h('div', { className: 'meter', role: 'img', 'aria-label': `Rétention ${pct(ret.rate)}, cible ${pct(TARGET_RETENTION)}` },
              h('span', { className: 'meter-fill', style: `width:${ret.rate * 100}%` }),
              h('span', { className: 'meter-target', style: `left:${TARGET_RETENTION * 100}%` }),
            ),
            h('p', { className: 'hint' }, `L’app vise ${pct(TARGET_RETENTION)} : en dessous, révise plus régulièrement ; bien au-dessus, tu pourrais espacer davantage.`),
          ),
      ),

      card('Ta confiance est-elle fiable ?', 'stat-calibration',
        cal.every((r) => !r.count)
          ? h('p', { className: 'muted' }, 'Indique ta confiance avant chaque correction : cette mesure apparaîtra ici.')
          : h('div', {},
            h('div', { className: 'hbars' }, ...cal.map((r) => h('div', { className: 'hbar', title: r.count ? `${pct(r.rate!)} justes sur ${r.count} réponses` : 'Aucune réponse' },
              h('span', { className: 'hbar-label' }, CONFIDENCE_LABELS[r.confidence]),
              h('span', { className: 'hbar-track' }, h('span', { className: 'hbar-fill', style: `width:${(r.rate ?? 0) * 100}%` })),
              h('span', { className: 'hbar-value' }, r.count ? `${pct(r.rate!)} · ${r.count}` : '—'),
            ))),
            h('p', { className: 'hint', 'data-testid': 'calibration-advice' }, calibrationAdvice(cal)),
          ),
      ),

      card('Régularité', 'stat-activity',
        h('p', { className: 'hero' }, h('strong', { 'data-testid': 'active-days' }, String(act.count)), ' jour', act.count > 1 ? 's' : '', ' actif', act.count > 1 ? 's' : '', ' sur les 30 derniers'),
        h('div', { className: 'strip', role: 'img', 'aria-label': `${act.count} jours de révision sur 30` },
          ...act.active.map((on, i) => h('span', { className: on ? 'cell on' : 'cell', title: new Date(now - (29 - i) * 86400000).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }))),
      ),

      card('Réglages de révision', 'stat-settings', newPerDayControl(settings.newPerDay)),
    );
  }

  function newPerDayControl(initial: number): HTMLElement {
    let value = initial;
    const out = h('output', { className: 'setting-value', 'data-testid': 'new-per-day' }, String(value));
    const set = (v: number) => {
      value = Math.min(NEW_PER_DAY.max, Math.max(NEW_PER_DAY.min, v));
      out.textContent = String(value);
      saveReviewSettings({ newPerDay: value }).catch((err: unknown) => {
        logError('réglages', err);
        toast(`Réglage non enregistré : ${errorMessage(err)}`, 'error');
      });
    };
    return h('div', { className: 'setting' },
      h('span', { className: 'setting-label' }, 'Nouvelles fiches par jour (au plus)'),
      h('div', { className: 'stepper' },
        h('button', { type: 'button', className: 'btn', 'aria-label': 'Moins de nouvelles fiches', onclick: () => set(value - NEW_PER_DAY.step) }, '−'),
        out,
        h('button', { type: 'button', className: 'btn', 'aria-label': 'Plus de nouvelles fiches', onclick: () => set(value + NEW_PER_DAY.step) }, '+'),
      ),
      h('p', { className: 'hint' }, 'Chaque nouvelle fiche ajoute des révisions les jours suivants : mieux vaut un rythme tenable.'),
    );
  }

  render().catch((err: unknown) => {
    logError('tableau de bord', err);
    body.append(h('p', { className: 'error-box' }, `Le tableau de bord n’a pas pu être chargé : ${errorMessage(err)}`));
  });

  return { el, destroy: () => undefined };
}

export function calibrationAdvice(cal: ReturnType<typeof calibration>): string {
  const sure = cal[2]!;
  const unsure = cal[0]!;
  if (sure.count >= 5 && sure.rate !== null && sure.rate < 0.8) return 'Quand tu dis « je sais », tu te trompes encore assez souvent : essaie de vraiment rappeler la réponse avant de choisir.';
  if (unsure.count >= 5 && unsure.rate !== null && unsure.rate > 0.5) return 'Tu en sais plus que tu ne le crois : quand tu hésites, tente quand même une réponse.';
  if (sure.count >= 5) return 'Ta confiance est bien calibrée : quand tu dis « je sais », c’est généralement juste.';
  return 'Encore quelques révisions et cette mesure deviendra fiable.';
}
