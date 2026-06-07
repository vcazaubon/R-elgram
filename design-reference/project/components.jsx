/* ============================================================
   Réelgram — Shared components
   ============================================================ */

/* Status bar — faux iOS bar for the prototype; in a real installed PWA
   (window.__REELGRAM_PWA === true) it collapses to a safe-area spacer so the
   REAL device status bar shows through instead. */
function StatusBar({ dark = true }) {
  const [now] = React.useState(() => "9:41");
  if (window.__REELGRAM_PWA) {
    return <div style={{ height: "env(safe-area-inset-top, 0px)", flex: "0 0 auto" }} />;
  }
  return (
    <div className="statusbar" style={{ color: dark ? "var(--txt-0)" : "#0a0a0c" }}>
      <span>{now}</span>
      <div className="sb-right">
        <Icons.signal size={17} />
        <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><path d="M12 5.5c3 0 5.7 1.1 7.7 3l-1.5 1.5A8.7 8.7 0 0 0 12 8.5 8.7 8.7 0 0 0 5.8 10L4.3 8.5C6.3 6.6 9 5.5 12 5.5zm0 4.2c1.8 0 3.5.7 4.8 1.9l-1.5 1.5A5 5 0 0 0 12 11.7c-1.3 0-2.5.5-3.3 1.4L7.2 11.6A6.9 6.9 0 0 1 12 9.7zm0 4.1c.8 0 1.5.3 2 .9L12 16.7l-2-2a2.8 2.8 0 0 1 2-.9z" /></svg>
        <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <div style={{ width: 24, height: 12, borderRadius: 3.5, border: "1.4px solid currentColor", opacity: 0.55, position: "relative", padding: 1.5 }}>
            <div style={{ position: "absolute", inset: 1.5, width: "78%", background: "currentColor", borderRadius: 1.5 }} />
          </div>
          <div style={{ width: 1.6, height: 4, background: "currentColor", opacity: 0.45, borderRadius: 1 }} />
        </div>
      </div>
    </div>
  );
}

/* Placeholder thumbnail — gradient + diagonal stripes + play glyph */
function Thumb({ video, radius = "var(--r-lg)", showPlay = true, scrim = true, children, className = "", style = {} }) {
  const [g0, g1] = video.g;
  return (
    <div className={"thumb " + className} style={{
      position: "relative", width: "100%", height: "100%", borderRadius: radius, overflow: "hidden",
      background: `linear-gradient(150deg, ${g0}, ${g1})`, ...style,
    }}>
      {/* diagonal stripe texture */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.5,
        backgroundImage: "repeating-linear-gradient(135deg, rgba(255,255,255,0.05) 0 2px, transparent 2px 16px)",
      }} />
      {/* soft vignette */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(120% 90% at 30% 20%, rgba(255,255,255,0.16), transparent 55%)" }} />
      {scrim && <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, transparent 35%, rgba(0,0,0,0.55) 100%)" }} />}
      {showPlay && (
        <div style={{
          position: "absolute", inset: 0, display: "grid", placeItems: "center",
        }}>
          <div style={{
            width: 54, height: 54, borderRadius: "50%",
            background: "rgba(10,10,12,0.42)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)",
            border: "1px solid rgba(255,255,255,0.22)", display: "grid", placeItems: "center",
            boxShadow: "0 8px 24px -8px rgba(0,0,0,0.6)",
          }}>
            <Icons.play size={22} style={{ marginLeft: 2, color: "#fff" }} />
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

/* mono label badge that names what the placeholder represents */
function PlaceholderLabel({ text }) {
  return (
    <div style={{
      position: "absolute", left: 12, bottom: 12,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 10.5, letterSpacing: 0.3, color: "rgba(255,255,255,0.62)",
      background: "rgba(0,0,0,0.34)", border: "1px solid rgba(255,255,255,0.14)",
      padding: "3px 7px", borderRadius: 7, backdropFilter: "blur(4px)",
    }}>{text}</div>
  );
}

/* Library video card — immersive */
function VideoCard({ video, index, onOpen }) {
  const cat = catById(video.cat);
  return (
    <button className="rise" onClick={() => onOpen(video)} style={{
      display: "block", width: "100%", textAlign: "left", padding: 0,
      animationDelay: `${0.04 * index}s`,
    }}>
      <div style={{ position: "relative" }}>
        {/* category glow behind card */}
        <div style={{
          position: "absolute", inset: "8px 18px 0", borderRadius: 28, zIndex: 0,
          background: cat.hex, filter: "blur(34px)", opacity: 0.18,
        }} />
        <div style={{
          position: "relative", zIndex: 1, borderRadius: 26, overflow: "hidden",
          border: "1px solid var(--hairline)", boxShadow: "var(--shadow-card)",
          background: "var(--bg-2)",
        }}>
          <div style={{ position: "relative", aspectRatio: "16 / 11" }}>
            <Thumb video={video} radius="0" />
            {/* top row: category + source */}
            <div style={{ position: "absolute", top: 12, left: 12, right: 12, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 28, padding: "0 11px",
                borderRadius: 999, fontSize: 12.5, fontWeight: 600, color: "#fff",
                background: "rgba(10,10,12,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.16)",
              }}>
                <span className="cat-dot" style={{ background: cat.hex }} />{cat.label}
              </span>
              <span style={{
                width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center",
                background: "rgba(10,10,12,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
                border: "1px solid rgba(255,255,255,0.16)", color: "#fff",
              }}><Icons.insta size={16} /></span>
            </div>
            {/* duration */}
            <span style={{
              position: "absolute", bottom: 12, right: 12, height: 24, padding: "0 9px",
              display: "inline-flex", alignItems: "center", borderRadius: 7, fontSize: 12, fontWeight: 600,
              color: "#fff", background: "rgba(10,10,12,0.5)", backdropFilter: "blur(8px)",
              border: "1px solid rgba(255,255,255,0.12)", fontVariantNumeric: "tabular-nums",
            }}>{video.dur}</span>
          </div>
          {/* meta strip */}
          <div style={{ padding: "13px 15px 15px" }}>
            <div style={{ fontSize: 15.5, fontWeight: 600, lineHeight: 1.25, color: "var(--txt-0)", letterSpacing: "-0.01em" }}>{video.title}</div>
            <div style={{ marginTop: 5, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--txt-2)" }}>
              <span>{video.auteur}</span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{video.date}</span>
            </div>
          </div>
        </div>
      </div>
    </button>
  );
}

/* Bottom tab bar */
function TabBar({ tab, onTab }) {
  const tabs = [
    { id: "library", label: "Bibliothèque", Icon: Icons.library },
    { id: "categories", label: "Catégories", Icon: Icons.grid },
  ];
  return (
    <div style={{
      position: "absolute", left: 0, right: 0, bottom: 0, zIndex: 20,
      padding: "10px 22px calc(env(safe-area-inset-bottom, 0px) + 18px)",
      display: "flex", justifyContent: "center", gap: 8,
      background: "linear-gradient(180deg, transparent, rgba(10,10,12,0.85) 38%)",
    }}>
      <div style={{
        display: "flex", gap: 4, padding: 6, borderRadius: 999,
        background: "var(--glass)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)",
        border: "1px solid var(--hairline)", boxShadow: "var(--shadow-pop)",
      }}>
        {tabs.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <button key={id} onClick={() => onTab(id)} style={{
              display: "flex", alignItems: "center", gap: 8, height: 44, padding: "0 18px", borderRadius: 999,
              fontSize: 14, fontWeight: 600, transition: "all 0.28s var(--ease)",
              color: on ? "#0a0a0c" : "var(--txt-1)",
              background: on ? "var(--grad-accent)" : "transparent",
            }}>
              <Icon size={19} /> {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { StatusBar, Thumb, PlaceholderLabel, VideoCard, TabBar });
