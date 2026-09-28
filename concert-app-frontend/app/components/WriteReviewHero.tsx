import Link from "next/link";

/**
 * The feed's opening statement and primary "write a review" call to action.
 *
 * This is the app's one saturated accent: the magenta "+" disc is the only
 * place --accent appears as a fill at full strength. The masthead's Write
 * Review button is suppressed on the feed so the action isn't offered twice.
 */
export default function WriteReviewHero() {
  return (
    <section
      className="container"
      style={{
        padding: "clamp(56px, 9vw, 112px) var(--gutter) clamp(48px, 8vw, 104px)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: "20px",
      }}
    >
      <h1 className="display">How was the show?</h1>
      <p className="lede" style={{ maxWidth: "600px", textWrap: "balance" }}>
        Rate it, write it, and see what everyone else in the room thought.
      </p>
      <Link
        href="/review/new"
        className="btn btn-primary btn-lg"
        style={{
          marginTop: "12px",
          paddingLeft: "12px",
          gap: "12px",
          boxShadow: "0 12px 30px -12px rgba(29,29,31,0.45)",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: "34px",
            height: "34px",
            borderRadius: "50%",
            background: "var(--accent)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#fff"
            strokeWidth="2.6"
            strokeLinecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
        </span>
        Write Review
      </Link>
    </section>
  );
}
