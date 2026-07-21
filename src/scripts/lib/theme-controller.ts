import { colorModes, type ColorMode } from "../../config/preferences";
import type { MessageKey } from "../../i18n/messages";

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

export class ThemeController {
  readonly media = window.matchMedia("(prefers-color-scheme: dark)");

  constructor(
    private readonly button: HTMLButtonElement,
    private readonly t: Translate
  ) {}

  current(): ColorMode {
    const value = document.documentElement.dataset.themePreference;
    return colorModes.includes(value as ColorMode) ? (value as ColorMode) : "system";
  }

  apply(mode: ColorMode) {
    const resolved = mode === "system" ? (this.media.matches ? "dark" : "light") : mode;
    document.documentElement.dataset.themePreference = mode;
    document.documentElement.dataset.colorMode = resolved;
    const label = mode === "system" ? this.t("colorModeAuto") : mode === "light" ? this.t("colorModeLight") : this.t("colorModeDark");
    this.button.textContent = label;
    this.button.setAttribute("aria-label", this.t("colorModeLabel", { mode: label }));
    this.updateBrowserChrome(mode, resolved);
  }

  next(): ColorMode {
    const currentIndex = colorModes.indexOf(this.current());
    return colorModes[(currentIndex + 1) % colorModes.length];
  }

  updateBrowserChrome(mode: ColorMode, resolved: Exclude<ColorMode, "system">) {
    const lightTheme = document.querySelector<HTMLMetaElement>("meta[data-theme-color='light']");
    const darkTheme = document.querySelector<HTMLMetaElement>("meta[data-theme-color='dark']");
    const colorSchemeMeta = document.querySelector<HTMLMetaElement>("meta[name='color-scheme']");
    if (lightTheme && darkTheme) {
      lightTheme.media = mode === "system" ? "(prefers-color-scheme: light)" : resolved === "light" ? "all" : "not all";
      darkTheme.media = mode === "system" ? "(prefers-color-scheme: dark)" : resolved === "dark" ? "all" : "not all";
      document.documentElement.style.backgroundColor = (resolved === "dark" ? darkTheme : lightTheme).content;
    }
    if (colorSchemeMeta) colorSchemeMeta.content = mode === "system" ? "light dark" : resolved;
  }
}
