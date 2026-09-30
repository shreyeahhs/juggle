import { isProviderId, type ProviderAdapter, type ProviderId } from "./types";

export type ModelResolution =
  | { ok: true; adapter: ProviderAdapter; model: string }
  | { ok: false; code: "model_not_supported"; message: string };

/**
 * Holds the enabled provider adapters and maps `model` strings to them.
 *
 * Accepted forms:
 *   - `gemini/gemini-3.8-flash`  explicit provider prefix (always unambiguous)
 *   - `gemini-3.8-flash`          matched by an adapter's `supportsModel`
 *   - `models/gemini-3.8-flash`   Gemini-style resource name
 */
export class ProviderRegistry {
  private readonly adapters = new Map<ProviderId, ProviderAdapter>();

  constructor(adapters: readonly ProviderAdapter[]) {
    for (const adapter of adapters) this.adapters.set(adapter.id, adapter);
  }

  get(id: string): ProviderAdapter | undefined {
    return isProviderId(id) ? this.adapters.get(id) : undefined;
  }

  list(): ProviderAdapter[] {
    return [...this.adapters.values()];
  }

  resolveModel(model: string): ModelResolution {
    const slash = model.indexOf("/");
    if (slash > 0) {
      const prefix = model.slice(0, slash).toLowerCase();
      const adapter = this.get(prefix);
      if (adapter) return { ok: true, adapter, model: model.slice(slash + 1) };
    }
    for (const adapter of this.adapters.values()) {
      if (adapter.supportsModel(model)) return { ok: true, adapter, model };
    }
    const supported = this.list()
      .map((adapter) => adapter.id)
      .join(", ");
    return {
      ok: false,
      code: "model_not_supported",
      message: `No configured provider serves model "${model.slice(0, 100)}". Use a provider-prefixed name such as "gemini/gemini-3.8-flash". Supported providers: ${supported}.`,
    };
  }
}
