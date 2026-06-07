/* ============================================================
   Réelgram — App controller
   ============================================================ */
const { useState, useEffect, useRef } = React;

function App() {
  const [videos, setVideos] = useState(VIDEOS);
  const [categories, setCategories] = useState(CATEGORIES);
  const [tab, setTab] = useState("library");          // library | categories
  const [authed, setAuthed] = useState(false);         // private vault gate
  const [route, setRoute] = useState("main");          // main | import | player | direction
  const [current, setCurrent] = useState(null);
  const [forceEmpty, setForceEmpty] = useState(false);
  const [importError, setImportError] = useState(false);
  const [navKey, setNavKey] = useState(0);             // retrigger transitions

  const go = (r) => { setRoute(r); setNavKey((k) => k + 1); };

  const openVideo = (v) => { setCurrent(v); go("player"); };

  const handleSaved = (catId) => {
    // add a fresh video to the top
    const palette = [["#102a52", "#2e6bd6"], ["#3a1342", "#8a2e6b"], ["#0f3d33", "#1f7a5c"]];
    const nv = { id: "v" + Date.now(), title: "Morning routine — 5h du mat", cat: catId, date: "À l'instant", dur: "0:48", auteur: "@dontgiveup", g: ["#3a1f5c", "#7d3c8f"] };
    setVideos((vs) => [nv, ...vs]);
    setForceEmpty(false);
    setTab("library");
    go("main");
  };

  const updateVideo = (v) => {
    setVideos((vs) => vs.map((x) => (x.id === v.id ? v : x)));
    setCurrent(v);
  };
  const deleteVideo = (v) => {
    setVideos((vs) => vs.filter((x) => x.id !== v.id));
    go("main");
  };

  const renameCat = (id, label) => { if (label.trim()) setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, label: label.trim() } : c))); };
  const deleteCat = (id) => setCategories((cs) => cs.filter((c) => c.id !== id));
  const addCat = (label) => {
    const hexes = ["#ff7eb3", "#ff9966", "#a78bfa", "#5ee2a0", "#5fa8ff", "#ffd166", "#7dd3fc", "#fca5a5"];
    setCategories((cs) => [...cs, { id: "c" + Date.now(), label, color: hexes[cs.length % hexes.length], hex: hexes[cs.length % hexes.length] }]);
  };

  const showEmpty = forceEmpty || videos.length === 0;

  if (!authed) {
    return (
      <>
        <Phone><LoginScreen onEnter={() => { setAuthed(true); setForceEmpty(false); setTab("library"); go("main"); }} /></Phone>
        <DemoRail key="rail-login" state={{ route: "login", tab, showEmpty: false, importError }}
          actions={{ library: () => setAuthed(true), empty: () => { setForceEmpty(true); setAuthed(true); },
            categories: () => { setTab("categories"); setAuthed(true); }, importOk: () => setAuthed(true), importErr: () => setAuthed(true),
            player: () => setAuthed(true), direction: () => setAuthed(true), login: () => {} }} />
      </>
    );
  }

  return (
    <>
      <Phone>
        <div key={navKey} style={{ position: "absolute", inset: 0 }}>
          {route === "main" && tab === "library" && (
            showEmpty
              ? <EmptyScreen tab={tab} onTab={setTab} onAdd={() => { setImportError(false); go("import"); }} />
              : <LibraryScreen videos={videos} tab={tab} onTab={setTab} onOpen={openVideo}
                  onAdd={() => { setImportError(false); go("import"); }} onDirection={() => go("direction")} />
          )}
          {route === "main" && tab === "categories" && (
            <CategoriesScreen videos={videos} categories={categories} tab={tab} onTab={setTab}
              onRename={renameCat} onDelete={deleteCat} onAdd={addCat} />
          )}
          {route === "import" && (
            <ImportScreen categories={categories} forceError={importError}
              onClose={() => go("main")} onSaved={handleSaved} />
          )}
          {route === "player" && current && (
            <PlayerScreen video={current} categories={categories}
              onBack={() => go("main")} onUpdate={updateVideo} onDelete={deleteVideo} />
          )}
          {route === "direction" && <DesignDirectionScreen onBack={() => go("main")} />}
        </div>
      </Phone>

      <DemoRail key="rail-main"
        state={{ route, tab, showEmpty, importError }}
        actions={{
          library: () => { setForceEmpty(false); setTab("library"); go("main"); },
          empty: () => { setForceEmpty(true); setTab("library"); go("main"); },
          categories: () => { setTab("categories"); go("main"); },
          importOk: () => { setImportError(false); go("import"); },
          importErr: () => { setImportError(true); go("import"); },
          player: () => openVideo(videos[0] || VIDEOS[0]),
          direction: () => go("direction"),
          login: () => { setAuthed(false); },
        }}
      />
    </>
  );
}

/* Phone shell with auto-scaling to fit viewport */
function Phone({ children }) {
  const ref = useRef(null);
  useEffect(() => {
    const fit = () => {
      const pad = 48;
      const sx = (window.innerWidth - pad - 220) / 390;   // leave room for rail
      const sy = (window.innerHeight - pad) / 844;
      const s = Math.min(1, Math.max(0.45, Math.min(sx, sy)));
      if (ref.current) ref.current.style.transform = `scale(${s})`;
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return <div ref={ref} className="phone">{children}</div>;
}

/* External demo rail — lets the reviewer jump to any state */
function DemoRail({ state, actions }) {
  const groups = [
    { head: "Bibliothèque", items: [
      { k: "library", label: "Remplie", on: state.route === "main" && state.tab === "library" && !state.showEmpty },
      { k: "empty", label: "Vide", on: state.route === "main" && state.tab === "library" && state.showEmpty },
    ]},
    { head: "Import", items: [
      { k: "importOk", label: "Progression", on: state.route === "import" && !state.importError },
      { k: "importErr", label: "Erreur", on: state.route === "import" && state.importError },
    ]},
    { head: "Écrans", items: [
      { k: "player", label: "Lecteur", on: state.route === "player" },
      { k: "categories", label: "Catégories", on: state.route === "main" && state.tab === "categories" },
      { k: "direction", label: "Design", on: state.route === "direction" },
      { k: "login", label: "Connexion", on: state.route === "login" },
    ]},
  ];
  return (
    <div style={{ position: "fixed", top: 0, right: 0, height: "100%", width: 210, display: "flex", flexDirection: "column", justifyContent: "center", gap: 20, padding: "0 26px", zIndex: 60 }}>
      <div>
        <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: "-0.02em", color: "#f4f4f6" }}>Réelgram</div>
        <div style={{ fontSize: 12, color: "#76768a", marginTop: 3 }}>Prototype · états</div>
      </div>
      {groups.map((g) => (
        <div key={g.head}>
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#5fa8ff", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8, opacity: 0.7 }}>{g.head}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {g.items.map((it) => (
              <button key={it.k} onClick={actions[it.k]} style={{
                textAlign: "left", padding: "9px 12px", borderRadius: 11, fontSize: 13, fontWeight: 540,
                color: it.on ? "#fff" : "#b8b8c4",
                background: it.on ? "rgba(255,255,255,0.09)" : "transparent",
                border: "1px solid " + (it.on ? "rgba(255,255,255,0.14)" : "transparent"),
                transition: "all 0.2s var(--ease)",
                display: "flex", alignItems: "center", gap: 9,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: it.on ? "var(--a-violet)" : "#3a3a48", flex: "0 0 auto" }} />
                {it.label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App />);
