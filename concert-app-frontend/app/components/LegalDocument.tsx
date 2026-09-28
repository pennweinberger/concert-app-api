import Link from "next/link";

// Shared chrome and typography for the public legal pages (/terms,
// /privacy). Both documents are long-form reading rather than app UI, so
// they get a slightly larger body size and generous line height — but the
// page shell, palette and display face are the ones every other page uses.
//
// The copy is supplied as data rather than written inline as JSX. Legal
// text must be reproduced exactly, and passing it through JSX text nodes
// invites silent mangling of quotes and apostrophes by escaping rules and
// formatters. Strings in an array render verbatim.

const CREAM = "#f4f1ea";
const BODY = "#cfccc4";
const MUTED = "#8f8f8f";

export type LegalListItem =
  | string
  /** A list item that begins with a link, e.g. a named service provider. */
  | { linkLabel: string; href: string; trailing: string };

export type LegalBlock =
  | { kind: "h2"; text: string }
  | { kind: "h3"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: LegalListItem[] }
  /** Postal address, one line per array entry. */
  | { kind: "address"; lines: string[] }
  /** e.g. prefix "Email: " followed by a mailto link. */
  | { kind: "email"; prefix: string; address: string };

export default function LegalDocument({
  title,
  effectiveDate,
  blocks,
}: {
  title: string;
  effectiveDate: string;
  blocks: LegalBlock[];
}) {
  return (
    <main
      style={{
        background: "#0a0a0a",
        minHeight: "100vh",
        color: CREAM,
        padding: "24px",
      }}
    >
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <Link
            href="/"
            style={{
              color: CREAM,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            ← Back to feed
          </Link>
        </div>

        <h1
          style={{
            fontSize: "30px",
            lineHeight: 1.2,
            marginBottom: "8px",
            fontFamily: "var(--font-display), sans-serif",
            fontWeight: 600,
          }}
        >
          {title}
        </h1>
        <p style={{ color: MUTED, fontSize: "14px", marginBottom: "36px" }}>
          {effectiveDate}
        </p>

        <div style={{ fontSize: "16px", lineHeight: 1.7, color: BODY }}>
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>

        <div
          style={{
            marginTop: "48px",
            paddingTop: "20px",
            borderTop: "1px solid #222",
            fontSize: "14px",
          }}
        >
          <Link
            href="/"
            style={{
              color: MUTED,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            ← Back to feed
          </Link>
        </div>
      </div>
    </main>
  );
}

function Block({ block }: { block: LegalBlock }) {
  switch (block.kind) {
    case "h2":
      return (
        <h2
          style={{
            fontSize: "20px",
            lineHeight: 1.35,
            fontWeight: 600,
            color: CREAM,
            margin: "36px 0 12px",
          }}
        >
          {block.text}
        </h2>
      );
    case "h3":
      return (
        <h3
          style={{
            fontSize: "16px",
            fontWeight: 600,
            color: CREAM,
            margin: "24px 0 8px",
          }}
        >
          {block.text}
        </h3>
      );
    case "p":
      return <p style={{ margin: "0 0 14px" }}>{block.text}</p>;
    case "ul":
      return (
        <ul
          style={{
            margin: "0 0 14px",
            paddingLeft: "22px",
            listStyle: "disc",
          }}
        >
          {block.items.map((item, i) => (
            <li key={i} style={{ margin: "0 0 8px" }}>
              {typeof item === "string" ? (
                item
              ) : (
                <>
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: CREAM,
                      textDecoration: "underline",
                      textUnderlineOffset: "3px",
                    }}
                  >
                    {item.linkLabel}
                  </a>
                  {item.trailing}
                </>
              )}
            </li>
          ))}
        </ul>
      );
    case "address":
      return (
        <p style={{ margin: "0 0 14px" }}>
          {block.lines.map((line, i) => (
            <span key={i}>
              {line}
              {i < block.lines.length - 1 ? <br /> : null}
            </span>
          ))}
        </p>
      );
    case "email":
      return (
        <p style={{ margin: "0 0 14px" }}>
          {block.prefix}
          <a
            href={`mailto:${block.address}`}
            style={{
              color: CREAM,
              textDecoration: "underline",
              textUnderlineOffset: "3px",
            }}
          >
            {block.address}
          </a>
        </p>
      );
  }
}
