const defaults = {
  dashboardUrl: "https://b.halka.ee",
  apiToken: "",
  tagNames: "",
  favorite: false
};

chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.runtime.openOptionsPage();
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    await showBadge(tab.id, "…", "#d97706", 0);
    const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
    if (!settings.dashboardUrl || !settings.apiToken) {
      await chrome.runtime.openOptionsPage();
      throw new Error("Configure the dashboard URL and API token first.");
    }
    if (!tab.url || !/^https?:\/\//i.test(tab.url)) {
      throw new Error("Only HTTP and HTTPS pages can be added.");
    }

    const response = await fetch(`${settings.dashboardUrl.replace(/\/+$/, "")}/api/extension/bookmarks`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${settings.apiToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: tab.title || new URL(tab.url).hostname,
        url: tab.url,
        faviconUrl: tab.favIconUrl || "",
        favorite: Boolean(settings.favorite),
        tagNames: parseTagNames(settings.tagNames)
      })
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `Okini returned ${response.status}.`);
    }
    await showBadge(tab.id, "✓", "#15803d");
  } catch (error) {
    console.error(error);
    await showBadge(tab.id, "!", "#dc2626");
  }
});

function parseTagNames(value) {
  return [...new Set(String(value).split(/[,\n]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20);
}

async function showBadge(tabId, text, color, clearAfter = 1800) {
  if (tabId === undefined) return;
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color })
  ]);
  if (clearAfter > 0) {
    setTimeout(() => chrome.action.setBadgeText({ tabId, text: "" }).catch(() => {}), clearAfter);
  }
}
