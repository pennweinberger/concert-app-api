import Link from "next/link";

// Shared chrome and typography for the public legal pages (/terms,
// /privacy). Both documents are long-form reading rather than app UI, so
// they get a narrow column, a larger body size and generous line height —
// but the page shell, palette and type scale are the ones every other page
// uses.
//
// The copy is supplied as data rather than written inline as JSX. Legal
// text must be reproduced exactly, and passing it through JSX text nodes
// invites silent mangling of quotes and apostrophes by escaping rules and
// formatters. Strings in an array render verbatim.

function BackToFeed() {
  return (
    <Link
      href="/"
      className="link"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "2px",
        minHeight: "40px",
        fontSize: "15px",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15 5l-7 7 7 7" />
      </svg>
      Back to feed
    </Link>
  );
}

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
    <main className="page">
      <div
        className="container-sm"
        style={{ paddingTop: "20px", paddingBottom: "clamp(48px, 8vw, 96px)" }}
      >
        <BackToFeed />

        <header style={{ paddingTop: "16px", marginBottom: "40px" }}>
          <h1 className="h1">{title}</h1>
          <p className="meta" style={{ margin: "14px 0 0" }}>
            {effectiveDate}
          </p>
        </header>

        <div
          style={{ fontSize: "17px", lineHeight: 1.65, color: "var(--ink-2)" }}
        >
          {blocks.map((block, i) => (
            <Block key={i} block={block} />
          ))}
        </div>

        <div
          style={{
            marginTop: "56px",
            paddingTop: "16px",
            borderTop: "1px solid var(--line)",
          }}
        >
          <BackToFeed />
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
          className="h3"
          style={{ color: "var(--ink)", margin: "48px 0 14px" }}
        >
          {block.text}
        </h2>
      );
    case "h3":
      return (
        <h3
          style={{
            fontSize: "17px",
            lineHeight: 1.35,
            fontWeight: 600,
            letterSpacing: "-0.015em",
            color: "var(--ink)",
            margin: "28px 0 8px",
          }}
        >
          {block.text}
        </h3>
      );
    case "p":
      return <p style={{ margin: "0 0 16px" }}>{block.text}</p>;
    case "ul":
      return (
        <ul
          style={{
            margin: "0 0 16px",
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
                    className="link"
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
        <p style={{ margin: "0 0 16px" }}>
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
        <p style={{ margin: "0 0 16px" }}>
          {block.prefix}
          <a
            href={`mailto:${block.address}`}
            className="link"
          >
            {block.address}
          </a>
        </p>
      );
  }
}
