import { LocalNotifications } from '@capacitor/local-notifications';
import { getSetting, putSetting } from '../storage/settings';
import { isNative } from './platform';

// Rappel quotidien de révision (notification locale, sans serveur).

export interface ReminderSettings {
  enabled: boolean;
  hour: number;
  minute: number;
}

export const DEFAULT_REMINDER: ReminderSettings = { enabled: false, hour: 20, minute: 0 };
const KEY = 'reminder';
const NOTIFICATION_ID = 1;

export function normalizeReminder(raw: unknown): ReminderSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ReminderSettings, unknown>>;
  const int = (v: unknown, max: number, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback);
  return { enabled: r.enabled === true, hour: int(r.hour, 23, DEFAULT_REMINDER.hour), minute: int(r.minute, 59, DEFAULT_REMINDER.minute) };
}

export async function loadReminder(): Promise<ReminderSettings> {
  return normalizeReminder(await getSetting(KEY));
}

export type ReminderStatus = 'scheduled' | 'disabled' | 'denied' | 'unsupported';

/** Programme (ou annule) la notification quotidienne. À rappeler à chaque démarrage. */
export async function applyReminder(settings: ReminderSettings, askPermission = false): Promise<ReminderStatus> {
  if (!isNative()) return 'unsupported';
  await LocalNotifications.cancel({ notifications: [{ id: NOTIFICATION_ID }] }).catch(() => undefined);
  if (!settings.enabled) return 'disabled';
  let permission = (await LocalNotifications.checkPermissions()).display;
  if (permission !== 'granted' && askPermission) permission = (await LocalNotifications.requestPermissions()).display;
  if (permission !== 'granted') return 'denied';
  await LocalNotifications.schedule({
    notifications: [{
      id: NOTIFICATION_ID,
      title: 'Liseuse',
      body: 'Quelques minutes de révision ? Revenir chaque jour, même brièvement, consolide ce que tu as lu.',
      schedule: { on: { hour: settings.hour, minute: settings.minute }, allowWhileIdle: true },
      smallIcon: 'ic_stat_notify',
    }],
  });
  return 'scheduled';
}

export async function saveReminder(settings: ReminderSettings): Promise<ReminderStatus> {
  const normalized = normalizeReminder(settings);
  await putSetting(KEY, normalized);
  return applyReminder(normalized, true);
}
