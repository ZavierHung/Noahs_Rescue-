"use client";
import type { Bag, Resource } from "@/lib/expedition";
import type { SVGProps } from "react";

export const RESOURCE_KEYS: Resource[] = [
  "wood",
  "metal",
  "electricity",
  "seed",
];
export const RESOURCE_LABELS: Record<Resource, string> = {
  wood: "木头",
  metal: "金属",
  electricity: "电力",
  seed: "种子",
};
export const emptyBag = (): Bag => ({
  wood: 0,
  metal: 0,
  electricity: 0,
  seed: 0,
});

export function ResourceIcon({ resource }: { resource: Resource }) {
  return (
    <span
      className={`resource-icon resource-${resource}`}
      role="img"
      aria-label={RESOURCE_LABELS[resource]}
      title={RESOURCE_LABELS[resource]}
    >
      <ResourceSvg resource={resource} />
      <span className="resource-sr-only" aria-hidden="true">
        {RESOURCE_LABELS[resource]}
      </span>
    </span>
  );
}
export function ResourceSvg({
  resource,
  ...props
}: { resource: Resource } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {resource === "wood" ? (
        <>
          <path
            d="m7 13 15-7 5 12-15 7Z"
            fill="currentColor"
            fillOpacity=".15"
          />
          <ellipse
            cx="10"
            cy="19"
            rx="5"
            ry="7"
            transform="rotate(-23 10 19)"
          />
          <ellipse
            cx="10"
            cy="19"
            rx="2"
            ry="3"
            transform="rotate(-23 10 19)"
          />
          <path d="m15 12 9-4m-7 8 9-4m-7 8 8-4" />
        </>
      ) : resource === "metal" ? (
        <>
          <path
            d="m9 9 15 1 5 12-20 3-6-6Z"
            fill="currentColor"
            fillOpacity=".2"
          />
          <path d="m9 9 5 10 15 3M3 19h11l-5 6M14 19l10-9" />
        </>
      ) : resource === "electricity" ? (
        <path
          d="m18 3-12 16h9l-1 10 12-17h-9Z"
          fill="currentColor"
          fillOpacity=".8"
        />
      ) : (
        <>
          <path
            d="M16 28V14m0 5C6 21 3 15 4 8c8-1 13 3 12 11Zm0-5C15 6 21 3 28 4c0 7-5 11-12 10Z"
            fill="currentColor"
            fillOpacity=".18"
          />
          <path d="m8 12 8 7m0-5 8-6" />
        </>
      )}
    </svg>
  );
}
export function ResourceAmount({
  resource,
  amount,
}: {
  resource: Resource;
  amount: number;
}) {
  return (
    <span
      className="resource-amount"
      aria-label={`${RESOURCE_LABELS[resource]} ${amount}`}
    >
      <ResourceIcon resource={resource} /> <b>{amount}</b>
    </span>
  );
}
export function ResourceBag({
  value,
  hideZero = false,
}: {
  value: Bag;
  hideZero?: boolean;
}) {
  const shown = RESOURCE_KEYS.filter((r) => !hideZero || value[r] > 0);
  return (
    <span className="resource-bag">
      {shown.length ? (
        shown.map((r) => (
          <ResourceAmount key={r} resource={r} amount={value[r]} />
        ))
      ) : (
        <span>无</span>
      )}
    </span>
  );
}
export function ResourceFields({
  value,
  onChange,
  label,
  max,
  disabled = false,
}: {
  value: Bag;
  onChange: (v: Bag) => void;
  label: string;
  max?: Bag;
  disabled?: boolean;
}) {
  return (
    <fieldset className="resource-fields" disabled={disabled}>
      <legend>{label}</legend>
      {RESOURCE_KEYS.map((r) => (
        <label key={r}>
          <ResourceIcon resource={r} />
          <input
            aria-label={`${label}${RESOURCE_LABELS[r]}`}
            type="number"
            min="0"
            max={max?.[r] ?? 999}
            step="1"
            value={value[r]}
            onChange={(e) =>
              onChange({
                ...value,
                [r]: Math.max(
                  0,
                  Math.min(
                    max?.[r] ?? 999,
                    Math.trunc(Number(e.target.value)) || 0,
                  ),
                ),
              })
            }
          />
          {max && <small>持有 {max[r]}</small>}
        </label>
      ))}
    </fieldset>
  );
}
