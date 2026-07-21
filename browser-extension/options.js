const defaults = {
  dashboardUrl: "https://b.halka.ee",
  apiToken: "",
  tagNames: "",
  favorite: false
};

const form = document.querySelector("#settingsForm");
const dashboardUrl = document.querySelector("#dashboardUrl");
const apiToken = document.querySelector("#apiToken");
const tagNames = document.querySelector("#tagNames");
const favorite = document.querySelector("#favorite");
const testButton = document.querySelector("#testButton");
const statusOutput = document.querySelector("#status");

restore().catch(showError);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const settings = readSettings();
    await ensureHostPermission(settings.dashboardUrl);
    await chrome.storage.local.set(settings);
    showStatus("設定を保存しました。", true);
  } catch (error) {
    showError(error);
  }
});

testButton.addEventListener("click", async () => {
  testButton.disabled = true;
  showStatus("接続しています…");
  try {
    const settings = readSettings();
    await ensureHostPermission(settings.dashboardUrl);
    const response = await fetch(`${settings.dashboardUrl}/api/extension/bookmarks`, {
      headers: { authorization: `Bearer ${settings.apiToken}` }
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || `接続できませんでした (${response.status})`);
    }
    await chrome.storage.local.set(settings);
    showStatus("接続できました。設定も保存しました。", true);
  } catch (error) {
    showError(error);
  } finally {
    testButton.disabled = false;
  }
});

async function restore() {
  const settings = { ...defaults, ...(await chrome.storage.local.get(defaults)) };
  dashboardUrl.value = settings.dashboardUrl;
  apiToken.value = settings.apiToken;
  tagNames.value = settings.tagNames;
  favorite.checked = settings.favorite;
}

function readSettings() {
  if (!form.reportValidity()) throw new Error("URLとAPIトークンを入力してください。");
  return {
    dashboardUrl: dashboardUrl.value.trim().replace(/\/+$/, ""),
    apiToken: apiToken.value.trim(),
    tagNames: tagNames.value.trim(),
    favorite: favorite.checked
  };
}

async function ensureHostPermission(url) {
  const origin = `${new URL(url).origin}/*`;
  const granted = await chrome.permissions.request({ origins: [origin] });
  if (!granted) throw new Error("ダッシュボードへのアクセス権限が必要です。");
}

function showStatus(message, success = false) {
  statusOutput.textContent = message;
  statusOutput.classList.toggle("success", success);
  statusOutput.classList.toggle("error", false);
}

function showError(error) {
  statusOutput.textContent = error instanceof Error ? error.message : String(error);
  statusOutput.classList.remove("success");
  statusOutput.classList.add("error");
}
