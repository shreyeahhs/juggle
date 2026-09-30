"use client";

import { useSearchParams } from "next/navigation";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, Input } from "@/components/ui/field";
import { idleState } from "@/lib/action-state";
import { signInAction } from "@/server/actions/auth";

/** One password, from the environment. There are no accounts to create. */
export function SignInForm() {
  const [state, action, pending] = useActionState(signInAction, idleState);
  const next = useSearchParams().get("next") ?? "/dashboard";

  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      </Field>
      {state.status === "error" ? <FormMessage>{state.message}</FormMessage> : null}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
