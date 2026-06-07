/* ============================================================
   Réelgram — Mini Design Direction
   ============================================================ */

function DesignDirectionScreen({ onBack }) {
  const Swatch = ({ name, val, hex }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ height: 56, borderRadius: 14, background: val, border: "1px solid var(--hairline)" }} />
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--txt-0)" }}>{name}</div>
      <div style={{ fontSize: 10.5, color: "var(--txt-2)", fontFamily: "ui-monospace, monospace" }}>{hex}</div>
    </div>
  );

  const Section = ({ title, kicker, children }) => (
    <div style={{ marginTop: 30 }}>
      <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--a-violet)", textTransform: "uppercase", letterSpacing: "0.08em" }}>{kicker}</div>
      <h2 style={{ fontSize: 19, fontWeight: 680, letterSpacing: "-0.02em", marginTop: 5, marginBottom: 14 }}>{title}</h2>
      {children}
    </div>
  );

  return (
    <div className="view modal-enter" style={{ background: "var(--bg-0)" }}>
      <StatusBar />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "6px 18px 4px" }}>
        <button onClick={onBack} style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bg-2)", border: "1px solid var(--hairline)", color: "var(--txt-1)" }}><Icons.back size={20} /></button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--txt-1)" }}>Design Direction</span>
      </div>

      <div className="scroll" style={{ padding: "10px 22px 40px" }}>
        {/* hero */}
        <div style={{ position: "relative", borderRadius: 22, overflow: "hidden", padding: "26px 22px", border: "1px solid var(--hairline)", background: "var(--bg-1)" }}>
          <div style={{ position: "absolute", inset: 0, background: "var(--grad-accent-soft)" }} />
          <div style={{ position: "relative" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 999, background: "rgba(10,10,12,0.4)", border: "1px solid var(--hairline)", fontSize: 12, fontWeight: 600, color: "var(--txt-1)" }}>
              <Icons.sparkle size={14} /> Mini Design Direction
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 720, letterSpacing: "-0.03em", marginTop: 14, lineHeight: 1.15 }}>Calme, premium,<br />mobile-first.</h1>
            <p style={{ fontSize: 14, color: "var(--txt-1)", marginTop: 10, lineHeight: 1.5 }}>L'effet wow vient du polish — espacements, lumière douce et transitions — pas du nombre de features.</p>
          </div>
        </div>

        <Section kicker="01 — Palette" title="Sombre profond + accent dégradé">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
            <Swatch name="Fond" val="#0a0a0c" hex="#0A0A0C" />
            <Swatch name="Surface" val="#16161c" hex="#16161C" />
            <Swatch name="Contrôle" val="#1e1e26" hex="#1E1E26" />
          </div>
          <div style={{ marginTop: 14, height: 56, borderRadius: 14, background: "var(--grad-accent)", display: "flex", alignItems: "center", justifyContent: "center", color: "#120a14", fontWeight: 680, fontSize: 13.5 }}>
            Accent · rose → orange → violet
          </div>
          <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
            {CATEGORIES.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 11px", borderRadius: 999, background: "var(--bg-2)", border: "1px solid var(--hairline)", fontSize: 12, color: "var(--txt-1)" }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: c.hex }} /> {c.label}
              </div>
            ))}
          </div>
        </Section>

        <Section kicker="02 — Typographie" title="SF Pro — système iOS">
          <div style={{ padding: "18px 18px", borderRadius: 18, background: "var(--bg-1)", border: "1px solid var(--hairline)" }}>
            <div style={{ fontSize: 30, fontWeight: 720, letterSpacing: "-0.03em" }}>Réelgram</div>
            <div style={{ fontSize: 12, color: "var(--txt-2)", marginTop: 2 }}>Display · 30 / 700 · -3% tracking</div>
            <div style={{ height: 1, background: "var(--hairline)", margin: "16px 0" }} />
            <div style={{ fontSize: 17, fontWeight: 600 }}>Titre de carte premium</div>
            <div style={{ fontSize: 12, color: "var(--txt-2)", marginTop: 2 }}>Text · 16 / 600</div>
            <div style={{ height: 1, background: "var(--hairline)", margin: "16px 0" }} />
            <div style={{ fontSize: 14.5, color: "var(--txt-1)" }}>Corps de texte, lisible et aéré.</div>
            <div style={{ fontSize: 12, color: "var(--txt-2)", marginTop: 2 }}>Body · 14.5 / 400 · txt-1</div>
          </div>
        </Section>

        <Section kicker="03 — Composants" title="Cards, boutons, pills">
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <button className="btn-primary" style={{ height: 50 }}><Icons.sparkle size={18} /> Bouton primaire</button>
            <div style={{ display: "flex", gap: 8 }}>
              <span className="pill active">Pill active</span>
              <span className="pill">Pill</span>
              <span className="pill"><span className="cat-dot" style={{ background: "var(--c-muscu)" }} />Muscu</span>
            </div>
            <div style={{ borderRadius: 18, overflow: "hidden", border: "1px solid var(--hairline)" }}>
              <div style={{ aspectRatio: "16/9", position: "relative" }}>
                <Thumb video={{ g: ["#3a1f5c", "#8a2e6b"] }} radius="0" />
              </div>
              <div style={{ padding: 13, background: "var(--bg-2)" }}>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Card glass · coins 26px</div>
                <div style={{ fontSize: 12, color: "var(--txt-2)", marginTop: 3 }}>Glow catégorie · scrim · blur</div>
              </div>
            </div>
          </div>
        </Section>

        <Section kicker="04 — Espacement" title="Grille 8pt, très aérée">
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
            {[4, 8, 12, 16, 24, 32].map((n) => (
              <div key={n} style={{ flex: 1, textAlign: "center" }}>
                <div style={{ height: n * 1.7, borderRadius: 6, background: "var(--grad-accent-soft)", border: "1px solid var(--hairline)" }} />
                <div style={{ fontSize: 10.5, color: "var(--txt-2)", marginTop: 6, fontFamily: "ui-monospace, monospace" }}>{n}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 13.5, color: "var(--txt-1)", marginTop: 16, lineHeight: 1.55 }}>
            Marges latérales de 22px, gouttières de 18px entre cards. Rayons généreux (16–30px). Coins arrondis partout.
          </p>
        </Section>

        <Section kicker="05 — Ambiance" title="Détails lumineux subtils">
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {[
              "Glow coloré diffus derrière chaque card",
              "Glassmorphism léger sur barres et pills",
              "Transitions de 0.4s, easing doux",
              "Ombres profondes mais discrètes",
            ].map((t, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 11, fontSize: 14, color: "var(--txt-0)" }}>
                <span style={{ width: 22, height: 22, borderRadius: 7, background: "var(--grad-accent-soft)", border: "1px solid var(--hairline)", display: "grid", placeItems: "center", color: "var(--a-violet)", flex: "0 0 auto" }}><Icons.check size={14} sw={2.4} /></span>
                {t}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
}

Object.assign(window, { DesignDirectionScreen });
