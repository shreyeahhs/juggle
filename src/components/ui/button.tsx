import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

/*
 * The primary action is ink, not amber. Amber means "a key is working" in this
 * interface, so spending it on a button would make the one colour that carries
 * meaning into decoration. An inverted ink fill is both louder and honest.
 */
const VARIANTS: Record<Variant, string> = {
  primary: "border-transparent bg-ink text-canvas hover:bg-ink-muted",
  secondary: "border-line-strong bg-surface text-ink hover:border-ink-subtle hover:bg-surface-muted",
  ghost: "border-transparent bg-transparent text-ink-muted hover:bg-surface-muted hover:text-ink",
  danger: "border-line-strong bg-transparent text-fail-ink hover:border-fail/40 hover:bg-fail-wash",
};

const SIZES: Record<Size, string> = {
  sm: "h-7.5 gap-1.5 px-2.5 text-[12.5px]",
  md: "h-9 gap-2 px-3.5 text-[13.5px]",
  lg: "h-11 gap-2 px-5 text-[14.5px]",
};

export const buttonStyles = (variant: Variant = "primary", size: Size = "md", className?: string) =>
  cn(
    "inline-flex items-center justify-center rounded-sharp border font-medium whitespace-nowrap select-none",
    "transition-[background-color,border-color,color,translate] duration-150 ease-out-expo",
    // A press should feel like a press, at a scale you feel rather than watch.
    "active:translate-y-px disabled:pointer-events-none disabled:opacity-50",
    VARIANTS[variant],
    SIZES[size],
    className,
  );

interface ButtonProps<T extends ElementType> {
  as?: T;
  variant?: Variant;
  size?: Size;
  children?: ReactNode;
}

export function Button<T extends ElementType = "button">({
  as,
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonProps<T> & Omit<ComponentPropsWithoutRef<T>, keyof ButtonProps<T>>) {
  const Component = (as ?? "button") as ElementType;
  return <Component className={buttonStyles(variant, size, className)} {...props} />;
}
