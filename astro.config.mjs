import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  output: "server",
  session: {
    cookie: {
      name: "bookmark-session",
      sameSite: "lax",
      secure: true
    }
  },
  adapter: cloudflare()
});
