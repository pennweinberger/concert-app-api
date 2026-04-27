"use client";

import { useEffect, useState } from "react";

export default function Home() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [message, setMessage] = useState("");
  const [showId, setShowId] = useState("");
  const [reviewText, setReviewText] = useState("");
  const [rating, setRating] = useState(5);
  const [feed, setFeed] = useState<any[]>([]);

  async function loadFeed() {
    const res = await fetch("http://localhost:3001/feed");
    const data = await res.json();
    setFeed(data.items || []);
  }

  useEffect(() => {
    loadFeed();
  }, []);

  async function searchShows() {
    const res = await fetch(
      `http://localhost:3001/shows/search?q=${encodeURIComponent(query)}`
    );
    const data = await res.json();
    setResults(data.items || []);
  }

  async function confirmShow(show: any) {
    const res = await fetch("http://localhost:3001/shows/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(show),
    });

    const data = await res.json();
    setShowId(data.showId);
    setMessage("Show confirmed");
  }

  async function submitReview() {
    await fetch("http://localhost:3001/reviews", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        showId,
        ratingOverall: rating,
        reviewTextRaw: reviewText,
      }),
    });

    setMessage("Review submitted");
    setReviewText("");
    loadFeed();
  }

  return (
    <main
      style={{
        background: "#0f0f0f",
        minHeight: "100vh",
        color: "white",
        padding: "24px",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ maxWidth: "700px", margin: "0 auto" }}>
        <h1 style={{ fontSize: "34px", marginBottom: "8px" }}>Encore</h1>
        <p style={{ color: "#aaa", marginBottom: "30px" }}>
          Review concerts. Discover the best live shows.
        </p>

        <div
          style={{
            display: "flex",
            gap: "10px",
            marginBottom: "24px",
          }}
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search artist..."
            style={{
              flex: 1,
              padding: "14px",
              borderRadius: "12px",
              border: "1px solid #333",
              background: "#1a1a1a",
              color: "white",
            }}
          />

          <button
            onClick={searchShows}
            style={{
              padding: "14px 18px",
              borderRadius: "12px",
              border: "none",
              background: "white",
              color: "black",
              fontWeight: "bold",
              cursor: "pointer",
            }}
          >
            Search
          </button>
        </div>

        {message && (
          <div
            style={{
              background: "#1f1f1f",
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "20px",
              color: "#7dff9b",
            }}
          >
            {message}
          </div>
        )}

        {results.map((show, index) => (
          <div
            key={index}
            style={{
              background: "#1a1a1a",
              padding: "18px",
              borderRadius: "16px",
              marginBottom: "14px",
            }}
          >
            <div style={{ fontWeight: "bold", fontSize: "18px" }}>
              {show.artist}
            </div>
            <div style={{ color: "#bbb", marginTop: "4px" }}>
              {show.venue} • {show.city}
            </div>
            <div style={{ color: "#777", marginTop: "4px" }}>
              {show.localDate}
            </div>

            <button
              onClick={() => confirmShow(show)}
              style={{
                marginTop: "14px",
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "none",
                background: "#2d6cff",
                color: "white",
                cursor: "pointer",
              }}
            >
              Confirm Show
            </button>
          </div>
        ))}

        {showId && (
          <div
            style={{
              background: "#1a1a1a",
              padding: "18px",
              borderRadius: "16px",
              marginTop: "26px",
            }}
          >
            <h2 style={{ marginBottom: "12px" }}>Write Review</h2>

            <select
              value={rating}
              onChange={(e) => setRating(Number(e.target.value))}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                marginBottom: "12px",
              }}
            >
              <option value={5}>5 Stars</option>
              <option value={4}>4 Stars</option>
              <option value={3}>3 Stars</option>
              <option value={2}>2 Stars</option>
              <option value={1}>1 Star</option>
            </select>

            <textarea
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value)}
              placeholder="How was the show?"
              rows={5}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "10px",
                marginBottom: "12px",
              }}
            />

            <button
              onClick={submitReview}
              style={{
                width: "100%",
                padding: "12px",
                borderRadius: "12px",
                border: "none",
                background: "#22c55e",
                color: "white",
                cursor: "pointer",
              }}
            >
              Submit Review
            </button>
          </div>
        )}

        <div style={{ marginTop: "40px" }}>
          <h2 style={{ marginBottom: "14px" }}>Live Feed</h2>

          {feed.map((item, index) => (
            <div
              key={index}
              style={{
                background: "#1a1a1a",
                padding: "16px",
                borderRadius: "14px",
                marginBottom: "12px",
              }}
            >
              <div style={{ fontWeight: "bold" }}>
                {item.show.artist} • {item.ratingOverall}/5
              </div>
              <div style={{ color: "#aaa", fontSize: "14px", marginTop: "4px" }}>
                {item.show.venue}
              </div>
              <div style={{ marginTop: "8px" }}>{item.reviewTextRaw}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}