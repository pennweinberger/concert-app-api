export default function Home() {
  return (
    <main style={{ padding: "40px", fontFamily: "Arial, sans-serif" }}>
      <h1>Concert App</h1>
      <p>Search concerts. Review shows. Discover the best live music.</p>

      <div style={{ marginTop: "30px" }}>
        <input
          placeholder="Search artist..."
          style={{
            padding: "12px",
            width: "300px",
            fontSize: "16px",
            marginRight: "10px",
          }}
        />
        <button
          style={{
            padding: "12px 18px",
            fontSize: "16px",
            cursor: "pointer",
          }}
        >
          Search
        </button>
      </div>
    </main>
  );
}