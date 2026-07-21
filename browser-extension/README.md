# Okini Quick Add

Chromium Manifest V3 extension for adding the current HTTP(S) tab to Okini with one toolbar click.

## Install

1. Configure `EXTENSION_API_TOKEN` on the Worker as described in the project README and deploy the dashboard.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**, choose **Load unpacked**, and select this `browser-extension` directory.
4. Enter the dashboard URL and matching API token in the settings page, then run **Connection test**.

The optional default tags are created automatically when they do not exist. The extension requests access only to the configured dashboard origin. The token is stored only on the local browser profile with `chrome.storage.local`; use a dedicated random value and rotate it if the browser profile is no longer trusted.
