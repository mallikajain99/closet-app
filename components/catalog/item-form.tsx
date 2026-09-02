"use client";

import { Category, ItemStatus, Season } from "@prisma/client";
import { useActionState, useEffect, useRef, useState } from "react";

import { PhotoInput } from "@/components/catalog/photo-input";
import { TagInput } from "@/components/catalog/tag-input";
import {
  ChipToggle,
  Field,
  Fieldset,
  Input,
  Select,
  Textarea,
} from "@/components/ui/field";
import type { ActionResult } from "@/app/(app)/catalog/actions";
import {
  CATEGORY_LABELS,
  FORMALITIES,
  SEASON_LABELS,
  SLEEVE_LENGTHS,
  STATUS_LABELS,
} from "@/lib/validation/item";

export type ItemFormValues = {
  id?: string;
  name?: string;
  category?: Category;
  subcategory?: string | null;
  brand?: string | null;
  size?: string | null;
  colors?: string[];
  seasons?: Season[];
  priceCents?: number | null;
  purchaseDate?: Date | null;
  sourceUrl?: string | null;
  status?: ItemStatus;
  conditionNote?: string | null;
  returnByDate?: Date | null;
  attributes?: Record<string, string>;
  tagNames?: string[];
  originalImageKey?: string | null;
};

function dateValue(date?: Date | null) {
  return date ? date.toISOString().slice(0, 10) : "";
}

/** Error keys come from the schema; a few don't match the input id they belong to. */
const FIELD_IDS: Record<string, string> = {
  priceCents: "price",
  tagNames: "colors",
};

/** Human labels for the error summary, so it reads as prose rather than field names. */
const FIELD_LABELS: Record<string, string> = {
  name: "Name",
  category: "Category",
  priceCents: "Purchase price",
  sourceUrl: "Where from",
  purchaseDate: "Purchase date",
  returnByDate: "Return by",
};

export function ItemForm({
  action,
  values = {},
  imageUrl,
  submitLabel,
  allTags,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  values?: ItemFormValues;
  imageUrl?: string | null;
  submitLabel: string;
  allTags: string[];
}) {
  const [result, formAction, pending] = useActionState(action, null);
  const errors = result?.ok === false ? (result.fieldErrors ?? {}) : {};
  const attributes = values.attributes ?? {};
  const summaryRef = useRef<HTMLDivElement>(null);

  /**
   * Move to the problem after a rejected submit.
   *
   * The submit button sits below a long form, so on a phone the offending field is
   * usually scrolled well off screen — without this the tap reads as "nothing happened".
   */
  useEffect(() => {
    if (result?.ok !== false) return;

    const firstKey = Object.keys(result.fieldErrors ?? {})[0];
    const target = firstKey ? document.getElementById(FIELD_IDS[firstKey] ?? firstKey) : null;

    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus({ preventScroll: true });
    } else {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [result]);

  return (
    <form
      action={formAction}
      // Our own validation is the single source of truth. With native validation on, the
      // browser silently blocks submission, the action never runs, and the server's
      // error messages never come back — which on mobile looks like a dead button.
      noValidate
      className="grid gap-10 lg:grid-cols-[320px_1fr]"
    >
      <div className="lg:sticky lg:top-8 lg:self-start">
        <PhotoInput initialKey={values.originalImageKey} initialUrl={imageUrl} />
      </div>

      <div className="grid gap-8">
        <Fieldset legend="The basics">
          <Field
            label="Name"
            htmlFor="name"
            error={errors.name?.[0]}
            required
            className="sm:col-span-2"
          >
            <Input
              id="name"
              name="name"
              required
              aria-invalid={Boolean(errors.name)}
              defaultValue={values.name ?? ""}
              placeholder="Black silk slip dress"
            />
          </Field>

          <Field label="Category" htmlFor="category" error={errors.category?.[0]} required>
            <Select
              id="category"
              name="category"
              defaultValue={values.category ?? ""}
              required
              aria-invalid={Boolean(errors.category)}
            >
              <option value="" disabled>
                Choose one
              </option>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Subcategory" htmlFor="subcategory" hint="Blouse, jeans, sneakers…">
            <Input id="subcategory" name="subcategory" defaultValue={values.subcategory ?? ""} />
          </Field>

          <Field label="Brand" htmlFor="brand">
            <Input id="brand" name="brand" defaultValue={values.brand ?? ""} />
          </Field>

          <Field label="Size" htmlFor="size">
            <Input id="size" name="size" defaultValue={values.size ?? ""} />
          </Field>
        </Fieldset>

        <Fieldset
          legend="Cost per wear"
          description="Price is what makes cost-per-wear work. You can add it later, but the item won't show a value until you do."
        >
          <Field label="Purchase price" htmlFor="price" error={errors.priceCents?.[0]}>
            <Input
              id="price"
              name="price"
              inputMode="decimal"
              placeholder="48.50"
              defaultValue={
                values.priceCents != null ? (values.priceCents / 100).toFixed(2) : ""
              }
            />
          </Field>

          <Field label="Purchase date" htmlFor="purchaseDate">
            <Input
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              defaultValue={dateValue(values.purchaseDate)}
            />
          </Field>

          <Field label="Where from" htmlFor="sourceUrl" error={errors.sourceUrl?.[0]}>
            <Input
              id="sourceUrl"
              name="sourceUrl"
              type="url"
              placeholder="https://…"
              defaultValue={values.sourceUrl ?? ""}
            />
          </Field>

          <Field
            label="Return by"
            htmlFor="returnByDate"
            hint="Flags the item while it can still go back."
          >
            <Input
              id="returnByDate"
              name="returnByDate"
              type="date"
              defaultValue={dateValue(values.returnByDate)}
            />
          </Field>
        </Fieldset>

        <Fieldset legend="Describe it" description="Everything here becomes a filter later.">
          <Field label="Colors" htmlFor="colors" hint="Comma separated." className="sm:col-span-2">
            <ColorsInput defaultValue={values.colors ?? []} />
          </Field>

          <Field label="Sleeve length" htmlFor="sleeveLength">
            <Select
              id="sleeveLength"
              name="sleeveLength"
              defaultValue={attributes.sleeveLength ?? ""}
            >
              <option value="">—</option>
              {SLEEVE_LENGTHS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Formality" htmlFor="formality">
            <Select id="formality" name="formality" defaultValue={attributes.formality ?? ""}>
              <option value="">—</option>
              {FORMALITIES.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Material" htmlFor="material">
            <Input id="material" name="material" defaultValue={attributes.material ?? ""} />
          </Field>

          <Field label="Pattern" htmlFor="pattern">
            <Input id="pattern" name="pattern" defaultValue={attributes.pattern ?? ""} />
          </Field>

          <Field label="Silhouette" htmlFor="silhouette">
            <Input id="silhouette" name="silhouette" defaultValue={attributes.silhouette ?? ""} />
          </Field>

          <div className="sm:col-span-2">
            <p className="label text-ink-subtle">Season</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(SEASON_LABELS).map(([value, label]) => (
                <ChipToggle
                  key={value}
                  name="seasons"
                  value={value}
                  label={label}
                  defaultChecked={values.seasons?.includes(value as Season)}
                />
              ))}
            </div>
          </div>
        </Fieldset>

        <Fieldset
          legend="Tags"
          description="The same tags label outfits, so an item shows which occasions it belongs to."
        >
          <div className="sm:col-span-2">
            <TagInput defaultValue={values.tagNames ?? []} suggestions={allTags} />
          </div>
        </Fieldset>

        <Fieldset legend="Condition">
          <Field label="Status" htmlFor="status">
            <Select id="status" name="status" defaultValue={values.status ?? "ACTIVE"}>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" htmlFor="conditionNote" hint="Needs a hem, missing a button…">
            <Textarea id="conditionNote" name="conditionNote" rows={2} defaultValue={values.conditionNote ?? ""} />
          </Field>
        </Fieldset>

        {result?.ok === false && (
          <div
            ref={summaryRef}
            role="alert"
            tabIndex={-1}
            className="border-l-2 border-signal-danger bg-surface-sunken py-3 pl-4"
          >
            <p className="text-ink">{result.message}</p>
            {Object.entries(result.fieldErrors ?? {}).length > 0 && (
              <ul className="mt-2 grid gap-1">
                {Object.entries(result.fieldErrors ?? {}).map(([field, messages]) => (
                  <li key={field} className="text-meta text-ink-muted">
                    <button
                      type="button"
                      onClick={() => {
                        const el = document.getElementById(FIELD_IDS[field] ?? field);
                        el?.scrollIntoView({ behavior: "smooth", block: "center" });
                        el?.focus({ preventScroll: true });
                      }}
                      className="underline underline-offset-4 hover:text-ink"
                    >
                      {FIELD_LABELS[field] ?? field}
                    </button>
                    {" — "}
                    {messages?.[0]}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="flex items-center gap-6 border-t border-line pt-6">
          <button
            type="submit"
            disabled={pending}
            className="label bg-ink px-8 py-3 text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Comma-separated text, submitted as repeated `colors` fields.
 *
 * The visible input is a single text box because typing "black, cream" is far quicker on
 * a phone than any chip-adding interaction; the split into discrete values happens here
 * so the server receives a clean array.
 */
function ColorsInput({ defaultValue }: { defaultValue: string[] }) {
  const [text, setText] = useState(defaultValue.join(", "));

  const colors = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  return (
    <>
      <Input
        id="colors"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="black, cream"
      />
      {colors.map((color, index) => (
        <input key={`${color}-${index}`} type="hidden" name="colors" value={color} />
      ))}
    </>
  );
}
