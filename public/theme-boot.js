(() => {
  const root = document.documentElement;
  const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");

  function applyTheme() {
    const preference = root.dataset.themePreference || "system";
    const resolved = preference === "system" ? (colorScheme.matches ? "dark" : "light") : preference;
    const lightTheme = document.querySelector("meta[data-theme-color='light']");
    const darkTheme = document.querySelector("meta[data-theme-color='dark']");
    const colorSchemeMeta = document.querySelector("meta[name='color-scheme']");

    root.dataset.colorMode = resolved;
    if (lightTheme && darkTheme) {
      lightTheme.media = preference === "system" ? "(prefers-color-scheme: light)" : resolved === "light" ? "all" : "not all";
      darkTheme.media = preference === "system" ? "(prefers-color-scheme: dark)" : resolved === "dark" ? "all" : "not all";
      root.style.backgroundColor = (resolved === "dark" ? darkTheme : lightTheme).content;
    }
    if (colorSchemeMeta) colorSchemeMeta.content = preference === "system" ? "light dark" : resolved;
  }

  applyTheme();
  colorScheme.addEventListener("change", () => {
    if (root.dataset.themePreference === "system") applyTheme();
  });
})();
