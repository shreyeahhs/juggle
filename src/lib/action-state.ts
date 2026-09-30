/**
 * Shared shape for Server Action results.
 *
 * Kept out of the `"use server"` module because such files may only export
 * async functions, so constants and types live here so client components can
 * import them too.
 */
export interface ActionState {
  status: "idle" | "success" | "error";
  message?: string;
  /** Field the error belongs to, for inline validation messages. */
  field?: string;
  /** Gateway key plaintext, returned exactly once right after creation. */
  token?: string;
}

export const idleState: ActionState = { status: "idle" };

export const actionOk = (message?: string, extra: Partial<ActionState> = {}): ActionState => ({ status: "success", message, ...extra });

export const actionError = (message: string, field?: string): ActionState => ({ status: "error", message, field });
