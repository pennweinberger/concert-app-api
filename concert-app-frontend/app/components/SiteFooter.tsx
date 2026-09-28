import Link from "next/link";

// The site's only footer: copyright and two legal links, nothing else.
//
// Rendered once from the root layout, after {children}. Pages grow to
// fill the viewport (.page / .band), so this sits at the bottom of short
// pages rather than floating mid-screen. Deliberately not a
// navigation system — the masthead and per-page back links remain the way
// around the site.
//
// A server component with no client JavaScript.
export default function SiteFooter() {
  return (
    <footer
      style={{
        background: "var(--surface)",
        borderTop: "1px solid var(--line)",
        fontSize: "13px",
        color: "var(--muted)",
      }}
    >
      <div
        className="container"
        style={{
          padding: "28px var(--gutter)",
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "space-between",
          gap: "12px 24px",
        }}
      >
        <span>© {new Date().getFullYear()} Afterset</span>
        <nav aria-label="Legal" style={{ display: "flex", gap: "22px" }}>
          <Link href="/terms" className="link-quiet">
            Terms
          </Link>
          <Link href="/privacy" className="link-quiet">
            Privacy
          </Link>
        </nav>
      </div>
    </footer>
  );
}
