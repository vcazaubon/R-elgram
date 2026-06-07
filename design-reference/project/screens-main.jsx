/* ============================================================
   Réelgram — Library, Empty, Categories
   ============================================================ */

function LibraryScreen({ videos, onOpen, onAdd, onTab, tab, onDirection }) {
  const [q, setQ] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [focused, setFocused] = React.useState(false);

  const filtered = videos.filter((v) => {
    const okCat = filter === "all" || v.cat === filter;
    const okQ = !q || v.title.toLowerCase().includes(q.toLowerCase()) || v.auteur.toLowerCase().includes(q.toLowerCase());
    return okCat && okQ;
  });

  const chips = [{ id: "all", label: "Tout" }, ...CATEGORIES.map((c) => ({ id: c.id, label: c.label }))];

  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110 }}>
        {/* header */}
        <div style={{ padding: "8px 22px 4px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em", lineHeight: 1 }}>Réelgram</h1>
              <p style={{ marginTop: 7, fontSize: 14.5, color: "var(--txt-1)", letterSpacing: "-0.01em" }}>Tes vidéos sauvegardées, au même endroit.</p>
            </div>
            <button onClick={onDirection} aria-label="Design direction" style={{
              width: 40, height: 40, borderRadius: 12, display: "grid", placeItems: "center", flex: "0 0 auto",
              background: "var(--bg-2)", border: "1px solid var(--hairline)", color: "var(--a-violet)",
            }}><Icons.sparkle size={20} /></button>
          </div>
        </div>

        {/* search */}
        <div style={{ padding: "16px 22px 0" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, height: 46, padding: "0 14px",
            borderRadius: 15, background: "var(--bg-2)",
            border: `1px solid ${focused ? "var(--hairline-strong)" : "var(--hairline)"}`,
            transition: "border-color 0.25s var(--ease)",
            boxShadow: focused ? "0 0 0 4px rgba(167,139,250,0.10)" : "none",
          }}>
            <Icons.search size={19} style={{ color: "var(--txt-2)" }} />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
              placeholder="Rechercher dans ta bibliothèque"
              style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--txt-0)", fontSize: 15 }} />
            {q && <button onClick={() => setQ("")} style={{ color: "var(--txt-2)", display: "grid", placeItems: "center" }}><Icons.close size={18} /></button>}
          </div>
        </div>

        {/* category filters */}
        <div style={{ marginTop: 14, display: "flex", gap: 8, overflowX: "auto", padding: "0 22px 2px", scrollbarWidth: "none" }} className="hscroll">
          {chips.map((c) => (
            <button key={c.id} onClick={() => setFilter(c.id)}
              className={"pill" + (filter === c.id ? " active" : "")}>
              {c.id !== "all" && <span className="cat-dot" style={{ background: catById(c.id).hex }} />}
              {c.label}
            </button>
          ))}
        </div>

        {/* count */}
        <div style={{ padding: "18px 22px 8px", fontSize: 12.5, fontWeight: 600, color: "var(--txt-2)", letterSpacing: "0.02em", textTransform: "uppercase" }}>
          {filtered.length} vidéo{filtered.length > 1 ? "s" : ""}
        </div>

        {/* cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18, padding: "0 22px" }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "60px 0", textAlign: "center", color: "var(--txt-2)" }}>
              <Icons.search size={30} style={{ opacity: 0.5 }} />
              <p style={{ marginTop: 14, fontSize: 14.5 }}>Aucun résultat</p>
            </div>
          ) : filtered.map((v, i) => <VideoCard key={v.id} video={v} index={i} onOpen={onOpen} />)}
        </div>
      </div>

      {/* FAB */}
      <button onClick={onAdd} style={{
        position: "absolute", right: 22, bottom: 96, zIndex: 25,
        height: 56, padding: "0 22px 0 18px", borderRadius: 999,
        display: "flex", alignItems: "center", gap: 9, color: "#120a14", fontWeight: 680, fontSize: 15.5,
        background: "var(--grad-accent)", animation: "glowPulse 3.4s ease-in-out infinite",
      }}>
        <Icons.plus size={21} /> Ajouter un lien
      </button>

      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}

function EmptyScreen({ onAdd, onTab, tab }) {
  const steps = [
    { n: "1", t: "Partage depuis Instagram", icon: Icons.insta },
    { n: "2", t: "Réelgram sauvegarde", icon: Icons.sparkle },
    { n: "3", t: "Tu regardes quand tu veux", icon: Icons.play },
  ];
  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110, display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "8px 22px 0" }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>Réelgram</h1>
        </div>

        {/* hero visual */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 30px 10px" }}>
          <div className="rise" style={{ position: "relative", width: 168, height: 168, marginBottom: 6 }}>
            {/* glow */}
            <div style={{ position: "absolute", inset: -30, borderRadius: "50%", background: "var(--grad-accent)", filter: "blur(46px)", opacity: 0.28 }} />
            {/* stacked cards illustration */}
            <div style={{ position: "absolute", inset: 0 }}>
              <div style={{ position: "absolute", top: 30, left: 26, width: 116, height: 116, borderRadius: 26, background: "var(--bg-3)", border: "1px solid var(--hairline)", transform: "rotate(-11deg)", boxShadow: "var(--shadow-card)" }} />
              <div style={{ position: "absolute", top: 24, left: 30, width: 116, height: 116, borderRadius: 26, background: "var(--bg-2)", border: "1px solid var(--hairline)", transform: "rotate(7deg)", boxShadow: "var(--shadow-card)" }} />
              <div style={{ position: "absolute", top: 20, left: 28, width: 116, height: 116, borderRadius: 26, overflow: "hidden", border: "1px solid var(--hairline-strong)", boxShadow: "var(--shadow-pop)", background: "linear-gradient(150deg,#3a1f5c,#8a2e6b)" }}>
                <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
                  <div style={{ width: 46, height: 46, borderRadius: "50%", background: "rgba(10,10,12,0.4)", backdropFilter: "blur(8px)", border: "1px solid rgba(255,255,255,0.24)", display: "grid", placeItems: "center" }}>
                    <Icons.play size={20} style={{ marginLeft: 2, color: "#fff" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          <h2 className="rise" style={{ animationDelay: "0.06s", marginTop: 22, fontSize: 22, fontWeight: 680, letterSpacing: "-0.02em", textAlign: "center", lineHeight: 1.25, maxWidth: 280 }}>
            Ta bibliothèque est prête
          </h2>
          <p className="rise" style={{ animationDelay: "0.1s", marginTop: 10, fontSize: 15.5, color: "var(--txt-1)", textAlign: "center", lineHeight: 1.5, maxWidth: 290 }}>
            Partage un Reel depuis Instagram pour commencer.
          </p>
        </div>

        {/* 3 steps */}
        <div className="rise" style={{ animationDelay: "0.14s", padding: "0 22px", display: "flex", flexDirection: "column", gap: 10 }}>
          {steps.map((s, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 14, padding: "13px 15px", borderRadius: 16,
              background: "var(--bg-1)", border: "1px solid var(--hairline)",
            }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: "var(--grad-accent-soft)", border: "1px solid var(--hairline)", display: "grid", placeItems: "center", color: "var(--txt-0)", flex: "0 0 auto" }}>
                <s.icon size={19} />
              </div>
              <span style={{ fontSize: 15, color: "var(--txt-0)", fontWeight: 520 }}>{s.t}</span>
              <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 700, color: "var(--txt-3)" }}>{s.n}</span>
            </div>
          ))}
        </div>

        <div style={{ padding: "24px 22px 8px" }}>
          <button className="btn-primary" onClick={onAdd}><Icons.link size={20} /> Ajouter une URL</button>
        </div>
      </div>
      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}

function CategoriesScreen({ videos, categories, onTab, tab, onRename, onDelete, onAdd }) {
  const [editing, setEditing] = React.useState(null); // id being renamed
  const [draft, setDraft] = React.useState("");
  const [adding, setAdding] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const count = (id) => videos.filter((v) => v.cat === id).length;

  return (
    <div className="view">
      <StatusBar />
      <div className="scroll" style={{ paddingBottom: 110 }}>
        <div style={{ padding: "8px 22px 4px" }}>
          <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.03em" }}>Catégories</h1>
          <p style={{ marginTop: 7, fontSize: 14.5, color: "var(--txt-1)" }}>Organise ton vault comme tu veux.</p>
        </div>

        <div style={{ padding: "20px 22px 0", display: "flex", flexDirection: "column", gap: 10 }}>
          {categories.map((c, i) => (
            <div key={c.id} className="rise" style={{ animationDelay: `${0.04 * i}s`,
              display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", borderRadius: 18,
              background: "var(--bg-1)", border: "1px solid var(--hairline)" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: c.hex, boxShadow: `0 0 14px -1px ${c.hex}`, flex: "0 0 auto" }} />
              {editing === c.id ? (
                <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => { onRename(c.id, draft); setEditing(null); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { onRename(c.id, draft); setEditing(null); } }}
                  style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--txt-0)", fontSize: 16, fontWeight: 560 }} />
              ) : (
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 560, color: "var(--txt-0)" }}>{c.label}</div>
                  <div style={{ fontSize: 12.5, color: "var(--txt-2)", marginTop: 2 }}>{count(c.id)} vidéo{count(c.id) > 1 ? "s" : ""}</div>
                </div>
              )}
              <button onClick={() => { setEditing(c.id); setDraft(c.label); }} style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", color: "var(--txt-1)", background: "var(--bg-3)", border: "1px solid var(--hairline)" }}><Icons.edit size={17} /></button>
              <button onClick={() => onDelete(c.id)} style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", color: "var(--txt-2)", background: "var(--bg-3)", border: "1px solid var(--hairline)" }}><Icons.trash size={17} /></button>
            </div>
          ))}

          {adding ? (
            <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "15px 16px", borderRadius: 18, background: "var(--bg-1)", border: "1px solid var(--hairline-strong)" }}>
              <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--grad-accent)", flex: "0 0 auto" }} />
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la catégorie"
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onAdd(newName.trim()); setNewName(""); setAdding(false); } }}
                style={{ flex: 1, background: "none", border: "none", outline: "none", color: "var(--txt-0)", fontSize: 16 }} />
              <button onClick={() => { if (newName.trim()) onAdd(newName.trim()); setNewName(""); setAdding(false); }} style={{ width: 38, height: 38, borderRadius: 11, display: "grid", placeItems: "center", color: "#0a0a0c", background: "var(--grad-accent)" }}><Icons.check size={18} /></button>
            </div>
          ) : (
            <button onClick={() => setAdding(true)} style={{
              display: "flex", alignItems: "center", gap: 11, padding: "15px 16px", borderRadius: 18, marginTop: 2,
              background: "transparent", border: "1.5px dashed var(--hairline-strong)", color: "var(--txt-1)", fontSize: 15, fontWeight: 560,
            }}>
              <span style={{ width: 26, height: 26, borderRadius: 9, background: "var(--bg-3)", display: "grid", placeItems: "center" }}><Icons.plus size={17} /></span>
              Ajouter une catégorie
            </button>
          )}
        </div>
      </div>
      <TabBar tab={tab} onTab={onTab} />
    </div>
  );
}

Object.assign(window, { LibraryScreen, EmptyScreen, CategoriesScreen });
