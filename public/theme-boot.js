(() => {
  const root = document.documentElement;
  const preference = root.dataset.themePreference || "system";
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.colorMode = preference === "system" ? (prefersDark ? "dark" : "light") : preference;
  const themeColor = getComputedStyle(root).getPropertyValue("--bg").trim();
  document.querySelector("meta[name='theme-color']")?.setAttribute("content", themeColor);
})();
