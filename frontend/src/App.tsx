// ============================================================
// Réelgram — App shell & state-based routing
// Ported from design-reference/project/pwa/pwa-app.jsx.
// Mock handlers operate on local state (Supabase/backend wiring lands
// in Spec 04/05). navKey re-mounts the active screen to replay the
// view-enter / modal-enter transitions on every navigation.
// ============================================================
import { useState } from 'react';
import { CATEGORIES, VIDEOS, type MockCategory, type MockVideo } from './lib/mock';
import type { TabId } from './components/TabBar';
import { LoginScreen } from './screens/LoginScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { EmptyScreen } from './screens/EmptyScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { DesignDirectionScreen } from './screens/DesignDirectionScreen';

type Route = 'login' | 'library' | 'categories' | 'import' | 'player' | 'direction';

const ADD_HEXES = ['#ff7eb3', '#ff9966', '#a78bfa', '#5ee2a0', '#5fa8ff', '#ffd166'];

export default function App() {
  const [videos, setVideos] = useState<MockVideo[]>(VIDEOS);
  const [categories, setCategories] = useState<MockCategory[]>(CATEGORIES);
  // Matches the prototype: screens receive the active tab as a literal
  // ("library" / "categories"), so the tab value is never read here — only
  // the setter participates in navigation.
  const [, setTab] = useState<TabId>('library');
  const [route, setRoute] = useState<Route>('login'); // start locked
  const [current, setCurrent] = useState<MockVideo | null>(null);
  const [importError, setImportError] = useState(false);
  const [navKey, setNavKey] = useState(0);

  const go = (r: Route) => { setRoute(r); setNavKey((k) => k + 1); };
  const openVideo = (v: MockVideo) => { setCurrent(v); go('player'); };

  const handleSaved = (catId: string) => {
    const nv: MockVideo = { id: 'v' + Date.now(), title: 'Morning routine — 5h du mat', cat: catId, date: "À l'instant", dur: '0:48', auteur: '@dontgiveup', g: ['#3a1f5c', '#7d3c8f'] };
    setVideos((vs) => [nv, ...vs]); setTab('library'); go('library');
  };
  const updateVideo = (v: MockVideo) => { setVideos((vs) => vs.map((x) => (x.id === v.id ? v : x))); setCurrent(v); };
  const deleteVideo = (v: MockVideo) => { setVideos((vs) => vs.filter((x) => x.id !== v.id)); go('library'); };
  const renameCat = (id: string, label: string) => { if (label.trim()) setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, label: label.trim() } : c))); };
  const deleteCat = (id: string) => setCategories((cs) => cs.filter((c) => c.id !== id));
  const addCat = (label: string) => {
    setCategories((cs) => {
      const hex = ADD_HEXES[cs.length % ADD_HEXES.length];
      return [...cs, { id: 'c' + Date.now(), label, color: hex, hex }];
    });
  };

  const onTab = (t: TabId) => { setTab(t); go(t === 'categories' ? 'categories' : 'library'); };

  return (
    <div className="app-root">
      <div key={navKey} style={{ position: 'absolute', inset: 0 }}>
        {route === 'login' && <LoginScreen onEnter={() => { setTab('library'); go('library'); }} />}
        {route === 'library' && (
          videos.length === 0
            ? <EmptyScreen tab="library" onTab={onTab} onAdd={() => { setImportError(false); go('import'); }} />
            : <LibraryScreen videos={videos} tab="library" onTab={onTab} onOpen={openVideo}
                onAdd={() => { setImportError(false); go('import'); }} onDirection={() => go('direction')} />
        )}
        {route === 'categories' && (
          <CategoriesScreen videos={videos} categories={categories} tab="categories" onTab={onTab}
            onRename={renameCat} onDelete={deleteCat} onAdd={addCat} />
        )}
        {route === 'import' && <ImportScreen categories={categories} forceError={importError} onClose={() => go('library')} onSaved={handleSaved} />}
        {route === 'player' && current && <PlayerScreen video={current} categories={categories} onBack={() => go('library')} onUpdate={updateVideo} onDelete={deleteVideo} />}
        {route === 'direction' && <DesignDirectionScreen onBack={() => go('library')} />}
      </div>
    </div>
  );
}
