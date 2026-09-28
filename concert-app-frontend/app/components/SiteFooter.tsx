import Link from "next/link";

// The site's only footer: two legal links, nothing else.
//
// Rendered once from the root layout, after {children}. Every page's
// <main> is minHeight 100vh, so this sits just past the fold and scrolls
// into view rather than competing with page content. Deliberately not a
// navigation system — the masthead and per-page back links remain the way
// around the site.
//
// A server component with no client JavaScript.
export default function SiteFooter() {
  return (
    <footer
      style={{
        background: "#0a0a0a",
        borderTop: "1px solid #1c1c1c",
        padding: "20px 24px",
        display: "flex",
        justifyContent: "center",
        gap: "16px",
        fontSize: "13px",
        color: "#8f8f8f",
      }}
    >
      <Link
        href="/terms"
        style={{ color: "#8f8f8f", textDecoration: "none" }}
      >
        Terms
      </Link>
      <span aria-hidden="true">·</span>
      <Link
        href="/privacy"
        style={{ color: "#8f8f8f", textDecoration: "none" }}
      >
        Privacy
      </Link>
    </footer>
  );
}
