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
    <div
      role="tablist"
      aria-label={label}
      style={{
        display: "flex",
        background: "rgba(255,255,255,0.07)",
        borderRadius: "20px",
        padding: "3px",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            role="tab"
            aria-selected={active}
            style={{
              background: active ? "rgba(255,255,255,0.11)" : "transparent",
              border: "none",
              borderRadius: "17px",
              padding: "6px 17px",
              cursor: "pointer",
              fontSize: "14px",
              fontFamily: "inherit",
              color: active ? "#f4f1ea" : "#8a8a8a",
              fontWeight: active ? 500 : 400,
              whiteSpace: "nowrap",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
