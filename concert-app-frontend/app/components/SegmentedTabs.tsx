"use client";

/**
 * Pill segmented control, replacing the underline tabs on the feed.
 * Generic over the option value so the artist page's Top/Recent can adopt
 * it unchanged when that page gets the same treatment.
 *
 * Keeps the tablist/tab roles and aria-selected the underline tabs had.
 */

export default function SegmentedTabs<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  /** Accessible name for the group, e.g. "Feed scope". */
  label: string;
}) {
  return (
    <div role="tablist" aria-label={label} className="segmented">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            role="tab"
            aria-selected={active}
            className="segmented-option"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
