/* ============================================================
   Réelgram — Import flow, Player, Design Direction
   ============================================================ */

function ImportScreen({ onClose, onSaved, categories, forceError }) {
  const [url, setUrl] = React.useState("https://www.instagram.com/reel/C8xQ2pLm3aZ/");
  const [cat, setCat] = React.useState("revoir");
  const [phase, setPhase] = React.useState("form"); // form | progress | done | error
  const [step, setStep] = React.useState(0);

  const STEPS = ["Analyse du lien", "Récupération de la vidéo", "Création de la miniature", "Vidéo sauvegardée"];

  const start = () => {
    setPhase("progress"); setStep(0);
  };

  React.useEffect(() => {
    if (phase !== "progress") return;
    let cancelled = false;
    const run = async () => {
      for (let i = 0; i < STEPS.length; i++) {
        await new Promise((r) => setTimeout(r, i === 1 ? 1100 : 850));
        if (cancelled) return;
        // simulate failure during fetch
        if (forceError && i === 1) { setPhase("error"); return; }
        setStep(i + 1);
      }
      await new Promise((r) => setTimeout(r, 500));
      if (!cancelled) setPhase("done");
    };
    run();
    return () => { cancelled = true; };
  }, [phase]);

  const selectedCat = catById(cat);

  return (
    <div className="view modal-enter" style={{ background: "var(--bg-0)" }}>
      <StatusBar />
      {/* header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 18px 4px" }}>
        <button onClick={onClose} style={{ width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", background: "var(--bg-2)", border: "1px solid var(--hairline)", color: "var(--txt-1)" }}>
          <Icons.close size={20} />
        </button>
        <span style={{ fontSize: 15, fontWeight: 600, color: "var(--txt-1)" }}>Importer</span>
        <div style={{ width: 40 }} />
      </div>

      <div className="scroll" style={{ padding: "0 22px" }}>
        {/* source badge */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 13, color: "var(--txt-2)" }}>
          <Icons.insta size={16} /> Lien reçu depuis iOS
        </div>

        {phase === "form" && (
          <div className="view-enter" style={{ position: "static" }}>
            <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.03em", marginTop: 14 }}>Lien reçu</h1>

            {/* URL field */}
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--txt-2)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 26, marginBottom: 9 }}>Lien Instagram</label>
            <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "0 14px", height: 54, borderRadius: 15, background: "var(--bg-2)", border: "1px solid var(--hairline)" }}>
              <Icons.link size={19} style={{ color: "var(--a-violet)", flex: "0 0 auto" }} />
              <input value={url} onChange={(e) => setUrl(e.target.value)}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--txt-0)", fontSize: 14.5, textOverflow: "ellipsis" }} />
            </div>

            {/* preview chip */}
            <div style={{ marginTop: 22, display: "flex", gap: 14, alignItems: "center", padding: 12, borderRadius: 18, background: "var(--bg-1)", border: "1px solid var(--hairline)" }}>
              <div style={{ width: 70, height: 70, borderRadius: 14, overflow: "hidden", flex: "0 0 auto", position: "relative" }}>
                <Thumb video={{ g: ["#3a1f5c", "#8a2e6b"] }} radius="14" showPlay={false} scrim={false} />
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>Reel · Instagram</div>
                <div style={{ fontSize: 12.5, color: "var(--txt-2)", marginTop: 3, fontFamily: "ui-monospace, monospace" }}>reel/C8xQ2pLm3aZ</div>
              </div>
            </div>

            {/* category selector */}
            <label style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--txt-2)", textTransform: "uppercase", letterSpacing: "0.04em", marginTop: 26, marginBottom: 11 }}>Catégorie</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {categories.map((c) => (
                <button key={c.id} onClick={() => setCat(c.id)} className={"pill" + (cat === c.id ? " active" : "")}>
                  <span className="cat-dot" style={{ background: cat === c.id ? "rgba(10,10,12,0.55)" : c.hex }} />{c.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {(phase === "progress" || phase === "done") && (
          <ProgressBlock steps={STEPS} step={step} done={phase === "done"} cat={selectedCat} />
        )}

        {phase === "error" && (
          <div className="view-enter" style={{ position: "static", paddingTop: 50, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
            <div style={{ position: "relative", width: 92, height: 92, marginBottom: 8 }}>
              <div style={{ position: "absolute", inset: -10, borderRadius: "50%", background: "#ff5d6c", filter: "blur(34px)", opacity: 0.3 }} />
              <div style={{ position: "relative", width: 92, height: 92, borderRadius: "50%", background: "var(--bg-2)", border: "1px solid var(--hairline)", display: "grid", placeItems: "center", color: "#ff8a96" }}>
                <Icons.close size={40} />
              </div>
            </div>
            <h2 style={{ marginTop: 18, fontSize: 21, fontWeight: 680, letterSpacing: "-0.02em", maxWidth: 260 }}>Impossible de récupérer cette vidéo</h2>
            <p style={{ marginTop: 10, fontSize: 14.5, color: "var(--txt-1)", lineHeight: 1.5, maxWidth: 280 }}>Le lien est peut-être privé ou expiré. Vérifie l'URL et réessaie.</p>
            <div style={{ marginTop: 28, width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
              <button className="btn-primary" onClick={() => setPhase("form")}><Icons.retry size={19} /> Réessayer</button>
              <button className="btn-ghost" onClick={onClose}>Annuler</button>
            </div>
          </div>
        )}
      </div>

      {/* footer CTA */}
      {phase === "form" && (
        <div style={{ padding: "12px 22px calc(env(safe-area-inset-bottom,0px) + 22px)", background: "linear-gradient(180deg, transparent, var(--bg-0) 40%)" }}>
          <button className="btn-primary" onClick={start}><Icons.sparkle size={20} /> Sauvegarder la vidéo</button>
        </div>
      )}
      {phase === "done" && (
        <div className="view-enter" style={{ position: "static", padding: "12px 22px calc(env(safe-area-inset-bottom,0px) + 22px)" }}>
          <button className="btn-primary" onClick={() => onSaved(cat)}><Icons.check size={20} /> Voir dans la bibliothèque</button>
        </div>
      )}
    </div>
  );
}

function ProgressBlock({ steps, step, done, cat }) {
  const pct = done ? 100 : Math.min(100, (step / steps.length) * 100 + 6);
  return (
    <div className="view-enter" style={{ position: "static", paddingTop: 34, display: "flex", flexDirection: "column", alignItems: "center" }}>
      {/* animated medallion */}
      <div style={{ position: "relative", width: 132, height: 132, marginBottom: 10 }}>
        <div style={{ position: "absolute", inset: -14, borderRadius: "50%", background: "var(--grad-accent)", filter: "blur(40px)", opacity: done ? 0.4 : 0.26, transition: "opacity 0.5s" }} />
        <svg width="132" height="132" viewBox="0 0 132 132" style={{ position: "relative", transform: "rotate(-90deg)" }}>
          <circle cx="66" cy="66" r="58" fill="none" stroke="var(--bg-3)" strokeWidth="6" />
          <defs>
            <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ff7eb3" /><stop offset="0.5" stopColor="#ff9966" /><stop offset="1" stopColor="#a78bfa" />
            </linearGradient>
          </defs>
          <circle cx="66" cy="66" r="58" fill="none" stroke="url(#pg)" strokeWidth="6" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 58}
            strokeDashoffset={2 * Math.PI * 58 * (1 - pct / 100)}
            style={{ transition: "stroke-dashoffset 0.7s var(--ease)" }} />
        </svg>
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
          {done ? (
            <div style={{ width: 64, height: 64, borderRadius: "50%", background: "var(--grad-accent)", display: "grid", placeItems: "center", color: "#0a0a0c", animation: "rise 0.4s var(--ease) both" }}>
              <Icons.check size={32} sw={2.4} />
            </div>
          ) : (
            <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.03em" }}>{Math.round(pct)}<span style={{ fontSize: 16, color: "var(--txt-2)" }}>%</span></div>
          )}
        </div>
      </div>

      <h2 style={{ marginTop: 16, fontSize: 21, fontWeight: 680, letterSpacing: "-0.02em" }}>{done ? "Vidéo sauvegardée" : "Sauvegarde en cours"}</h2>
      <p style={{ marginTop: 8, fontSize: 14, color: "var(--txt-2)" }}>{done ? "Ajoutée à " + cat.label : "Ça prend quelques secondes…"}</p>

      {/* step list */}
      <div style={{ marginTop: 30, width: "100%", display: "flex", flexDirection: "column", gap: 4 }}>
        {steps.map((s, i) => {
          const state = done || i < step ? "done" : i === step ? "active" : "wait";
          return (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 13, padding: "11px 14px", borderRadius: 14,
              background: state === "active" ? "var(--bg-2)" : "transparent",
              border: `1px solid ${state === "active" ? "var(--hairline)" : "transparent"}`,
              transition: "all 0.3s var(--ease)" }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", flex: "0 0 auto", display: "grid", placeItems: "center",
                background: state === "done" ? "var(--grad-accent)" : state === "active" ? "var(--bg-3)" : "var(--bg-2)",
                border: state === "wait" ? "1px solid var(--hairline)" : "none", color: state === "done" ? "#0a0a0c" : "var(--txt-1)" }}>
                {state === "done" ? <Icons.check size={15} sw={2.6} /> :
                 state === "active" ? <span style={{ width: 15, height: 15, borderRadius: "50%", border: "2px solid var(--a-violet)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} /> :
                 <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--txt-3)" }} />}
              </span>
              <span style={{ fontSize: 14.5, fontWeight: state === "wait" ? 460 : 560, color: state === "wait" ? "var(--txt-2)" : "var(--txt-0)" }}>{s}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { ImportScreen, ProgressBlock });
