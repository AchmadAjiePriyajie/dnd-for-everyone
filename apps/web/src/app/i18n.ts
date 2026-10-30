import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '#shared/contracts';
import en from '../locales/en/common.json';
import id from '../locales/id/common.json';

export const LOCALES: readonly Locale[] = ['en', 'id'];
const STORAGE_KEY = 'dnd.locale';

const isLocale = (value: unknown): value is Locale => LOCALES.includes(value as Locale);

/**
 * Locale sebelum login: pilihan terakhir di browser ini, lalu bahasa browser
 * pertama yang didukung, lalu EN. Setelah login preferensi akun menang.
 */
export function detectInitialLocale(
  storage: Pick<Storage, 'getItem'> | undefined,
  languages: readonly string[] | undefined,
): Locale {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    stored = null;
  }
  if (isLocale(stored)) return stored;
  for (const language of languages ?? []) {
    const primary = language.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return 'en';
}

function browserStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export const i18n = i18next.createInstance();
void i18n.use(initReactI18next).init({
  resources: { en: { common: en }, id: { common: id } },
  lng: detectInitialLocale(browserStorage(), typeof navigator === 'undefined' ? [] : navigator.languages),
  fallbackLng: 'en',
  supportedLngs: [...LOCALES],
  ns: ['common'],
  defaultNS: 'common',
  initAsync: false,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});
syncDocument(i18n.language as Locale);

function syncDocument(locale: Locale): void {
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function currentLocale(): Locale {
  return isLocale(i18n.language) ? i18n.language : 'en';
}

/** Ganti bahasa UI saja; draft/state tidak disentuh dan komponen tidak di-remount. */
export function setLocale(locale: Locale): void {
  void i18n.changeLanguage(locale);
  syncDocument(locale);
  try {
    browserStorage()?.setItem(STORAGE_KEY, locale);
  } catch {
    // Storage diblokir: bahasa tetap berlaku untuk tab ini.
  }
}
