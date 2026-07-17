import { defaultLocale, locales, type Locale } from "../i18n/messages";

export const colorModes = ["system", "light", "dark"] as const;
export type ColorMode = (typeof colorModes)[number];

export type Preferences = {
  locale: Locale;
  colorMode: ColorMode;
};

export const defaultPreferences: Preferences = {
  locale: defaultLocale,
  colorMode: "system"
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (locales as readonly string[]).includes(value);
}

export function isColorMode(value: unknown): value is ColorMode {
  return typeof value === "string" && (colorModes as readonly string[]).includes(value);
}

export function normalizePreferences(input: Partial<Record<keyof Preferences, unknown>>): Preferences {
  return {
    locale: isLocale(input.locale) ? input.locale : defaultPreferences.locale,
    colorMode: isColorMode(input.colorMode) ? input.colorMode : defaultPreferences.colorMode
  };
}
