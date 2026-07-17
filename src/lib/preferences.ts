import { defaultPreferences, normalizePreferences, type Preferences } from "../config/preferences";

const preferencesKey = "preferences:global";

export async function readPreferences(kv: KVNamespace): Promise<Preferences> {
  const stored = await kv.get<Partial<Preferences>>(preferencesKey, "json");
  return normalizePreferences(stored ?? defaultPreferences);
}

export async function writePreferences(kv: KVNamespace, input: Partial<Record<keyof Preferences, unknown>>): Promise<Preferences> {
  const current = await readPreferences(kv);
  const preferences = normalizePreferences({ ...current, ...input });
  await kv.put(preferencesKey, JSON.stringify(preferences));
  return preferences;
}
