import { cn } from "@/lib/utils";

/**
 * Form primitives in the house style (spec §5): underline-only inputs, no boxes or
 * shadows, small uppercase labels. Deliberately not shadcn's bordered card look.
 */

export function Field({
  label,
  htmlFor,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      <label htmlFor={htmlFor} className="label text-ink-subtle">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1 text-meta text-ink-subtle">{hint}</p>}
      {error && <p className="mt-1 text-meta text-signal-danger">{error}</p>}
    </div>
  );
}

const controlStyles =
  "mt-2 w-full border-b border-line-strong bg-transparent pb-2 text-ink outline-none placeholder:text-ink-subtle focus:border-ink";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return <input {...props} className={cn(controlStyles, className)} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select {...props} className={cn(controlStyles, "appearance-none", className)}>
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(controlStyles, "resize-y", className)} />;
}

export function Fieldset({
  legend,
  description,
  children,
}: {
  legend: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="border-t border-line pt-6">
      <legend className="label sr-only">{legend}</legend>
      <p className="label text-ink">{legend}</p>
      {description && <p className="mt-1 text-meta text-ink-muted">{description}</p>}
      <div className="mt-5 grid gap-5 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

/** Multi-select rendered as toggle chips — faster on a phone than a native multiple select. */
export function ChipToggle({
  name,
  value,
  label,
  defaultChecked,
}: {
  name: string;
  value: string;
  label: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="cursor-pointer">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        className="peer sr-only"
      />
      <span className="label inline-block border border-line-strong px-3 py-1.5 text-ink-muted transition-colors peer-checked:border-ink peer-checked:bg-ink peer-checked:text-canvas peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink">
        {label}
      </span>
    </label>
  );
}
