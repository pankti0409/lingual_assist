import { createLink, type LinkComponent } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "confirm" | "danger" | "ghost-light";
export type ButtonSize = "md" | "lg";

interface Common {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconEnd?: ReactNode;
}

export const buttonClass = (variant: ButtonVariant = "primary", size: ButtonSize = "md", extra = "") =>
  `btn btn--${variant} btn--${size} ${extra}`.trim();

export interface ButtonProps extends Common, ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, icon, iconEnd, loading, className = "", children, disabled, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Loader2 className="btn__spin" aria-hidden size={20} /> : icon && <span className="btn__icon" aria-hidden>{icon}</span>}
      <span className="btn__label">{children}</span>
      {iconEnd && <span className="btn__icon" aria-hidden>{iconEnd}</span>}
    </button>
  );
});

interface AnchorButtonProps extends Common, AnchorHTMLAttributes<HTMLAnchorElement> {}

const AnchorButton = forwardRef<HTMLAnchorElement, AnchorButtonProps>(function AnchorButton(
  { variant, size, icon, iconEnd, className = "", children, ...rest },
  ref,
) {
  return (
    <a ref={ref} className={buttonClass(variant, size, className)} {...rest}>
      {icon && <span className="btn__icon" aria-hidden>{icon}</span>}
      <span className="btn__label">{children}</span>
      {iconEnd && <span className="btn__icon" aria-hidden>{iconEnd}</span>}
    </a>
  );
});

/** A TanStack Router <Link> styled as a button (typed `to`). */
export const ButtonLink: LinkComponent<typeof AnchorButton> = createLink(AnchorButton);
