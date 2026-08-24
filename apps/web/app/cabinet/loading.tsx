export default function CabinetLoading() {
  return (
    <main
      aria-busy="true"
      style={{
        background: "linear-gradient(180deg, #0f0d18 0%, #120f1d 100%)",
        minHeight: "100vh",
        padding: "1.25rem"
      }}
    >
      <div
        style={{
          display: "grid",
          gap: "1rem",
          margin: "0 auto",
          maxWidth: "1200px"
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            borderRadius: "1.2rem",
            display: "flex",
            gap: "1rem",
            justifyContent: "space-between",
            padding: "1rem 1.1rem"
          }}
        >
          <div style={{ display: "grid", gap: "0.55rem", width: "42%" }}>
            <div style={bar(220, 18)} />
            <div style={bar(340, 12, 0.7)} />
          </div>
          <div style={{ display: "flex", gap: "0.75rem" }}>
            <div style={pill(140)} />
            <div style={pill(44)} />
            <div style={pill(96)} />
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))"
          }}
        >
          <div style={card()} />
          <div style={card()} />
          <div style={card()} />
        </div>

        <div
          style={{
            display: "grid",
            gap: "1rem",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))"
          }}
        >
          <div style={panel(260)} />
          <div style={panel(260)} />
        </div>
      </div>
    </main>
  );
}

function bar(width: number, height: number, opacity = 1) {
  return {
    background: `rgba(255, 255, 255, ${0.16 * opacity})`,
    borderRadius: "999px",
    height: `${height}px`,
    width: `${width}px`
  };
}

function pill(width: number) {
  return {
    background: "rgba(255, 255, 255, 0.08)",
    borderRadius: "999px",
    height: "2.5rem",
    width: `${width}px`
  };
}

function card() {
  return {
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "1.2rem",
    minHeight: "8rem"
  };
}

function panel(height: number) {
  return {
    background: "rgba(255, 255, 255, 0.04)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: "1.2rem",
    minHeight: `${height}px`
  };
}
