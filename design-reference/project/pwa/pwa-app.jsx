/* ============================================================
   Réelgram — PWA shell (full-bleed, installable)
   Reuses the SAME screen components as the prototype, but drops
   the phone bezel + demo rail and fills the device viewport.
   ============================================================ */
const { useState, useEffect } = React;

function PwaApp() {
  const [videos, setVideos] = useState(VIDEOS);
  const [categories, setCategories] = useState(CATEGORIES);
  const [tab, setTab] = useState("library");
  const [route, setRoute] = useState("login");   // start locked
  const [current, setCurrent] = useState(null);
  const [importError, setImportError] = useState(false);
  const [navKey, setNavKey] = useState(0);

  const go = (r) => { setRoute(r); setNavKey((k) => k + 1); };
  const openVideo = (v) => { setCurrent(v); go("player"); };

  const handleSaved = (catId) => {
    const nv = { id: "v" + Date.now(), title: "Morning routine — 5h du mat", cat: catId, date: "À l'instant", dur: "0:48", auteur: "@dontgiveup", g: ["#3a1f5c", "#7d3c8f"] };
    setVideos((vs) => [nv, ...vs]); setTab("library"); go("library");
  };
  const updateVideo = (v) => { setVideos((vs) => vs.map((x) => (x.id === v.id ? v : x))); setCurrent(v); };
  const deleteVideo = (v) => { setVideos((vs) => vs.filter((x) => x.id !== v.id)); go("library"); };
  const renameCat = (id, label) => { if (label.trim()) setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, label: label.trim() } : c))); };
  const deleteCat = (id) => setCategories((cs) => cs.filter((c) => c.id !== id));
  const addCat = (label) => { const hexes = ["#ff7eb3", "#ff9966", "#a78bfa", "#5ee2a0", "#5fa8ff", "#ffd166"]; setCategories((cs) => [...cs, { id: "c" + Date.now(), label, color: hexes[cs.length % hexes.length], hex: hexes[cs.length % hexes.length] }]); };

  const onTab = (t) => { setTab(t); go(t === "categories" ? "categories" : "library"); };

  return (
    <div className="app-root">
      <div key={navKey} style={{ position: "absolute", inset: 0 }}>
        {route === "login" && <LoginScreen onEnter={() => { setTab("library"); go("library"); }} />}
        {route === "library" && (
          videos.length === 0
            ? <EmptyScreen tab="library" onTab={onTab} onAdd={() => { setImportError(false); go("import"); }} />
            : <LibraryScreen videos={videos} tab="library" onTab={onTab} onOpen={openVideo}
                onAdd={() => { setImportError(false); go("import"); }} onDirection={() => go("direction")} />
        )}
        {route === "categories" && (
          <CategoriesScreen videos={videos} categories={categories} tab="categories" onTab={onTab}
            onRename={renameCat} onDelete={deleteCat} onAdd={addCat} />
        )}
        {route === "import" && <ImportScreen categories={categories} forceError={importError} onClose={() => go("library")} onSaved={handleSaved} />}
        {route === "player" && current && <PlayerScreen video={current} categories={categories} onBack={() => go("library")} onUpdate={updateVideo} onDelete={deleteVideo} />}
        {route === "direction" && <DesignDirectionScreen onBack={() => go("library")} />}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<PwaApp />);

/* register the service worker (only works over http/https, not file://) */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  });
}
