import { defaultLocale, locales, messages, type Locale, type MessageKey } from "../../i18n/messages";

export class I18nController {
  locale: Locale;

  constructor() {
    this.locale = detectLocale();
  }

  t(key: MessageKey, vars: Record<string, string | number> = {}) {
    let value: string = messages[this.locale][key] ?? messages[defaultLocale][key];
    for (const [name, replacement] of Object.entries(vars)) {
      value = value.replaceAll(`{${name}}`, String(replacement));
    }
    return value;
  }

  apply(locale: Locale) {
    this.locale = locale;
    document.documentElement.lang = locale;
    document.documentElement.dataset.locale = locale;
    document.title = this.t("appTitle");
    document.querySelector<HTMLMetaElement>("meta[name='description']")?.setAttribute("content", this.t("metaDescription"));

    document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
      element.textContent = this.t(element.dataset.i18n as MessageKey);
    });
    document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-i18n-placeholder]").forEach((element) => {
      element.placeholder = this.t(element.dataset.i18nPlaceholder as MessageKey);
    });
    document.querySelectorAll<HTMLElement>("[data-i18n-aria-label]").forEach((element) => {
      element.setAttribute("aria-label", this.t(element.dataset.i18nAriaLabel as MessageKey));
    });
    document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((element) => {
      element.setAttribute("title", this.t(element.dataset.i18nTitle as MessageKey));
    });
  }

  nextLocale(): Locale {
    return this.locale === "ja" ? "en" : "ja";
  }
}

function detectLocale(): Locale {
  const value = document.documentElement.dataset.locale;
  if (value && (locales as readonly string[]).includes(value)) return value as Locale;
  return (navigator.language || defaultLocale).toLowerCase().startsWith("en") ? "en" : defaultLocale;
}
