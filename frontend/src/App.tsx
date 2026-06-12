// ============================================================
// Réelgram — App shell, auth gate & state-based routing
// AuthProvider wraps everything. The Gate decides, from the Supabase
// session + the local Face ID lock, whether to show the LoginScreen
// (email form OR biometric lock) or the authenticated app shell.
// The shell now runs on REAL data (Spec 05): videos/categories load via
// db.ts (Supabase, RLS-scoped), live updates via realtime, the player streams
// the real file via the backend (getMediaUrl), and metadata mutations persist.
// navKey re-mounts the active screen to replay view-enter transitions.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabId } from './components/TabBar';
import { AuthProvider, useAuth } from './lib/auth';
import { decideAuthMode } from './lib/authLogic';
import {
  isBiometricEnrolled,
  unlockBiometric,
  clearBiometric,
} from './lib/biometric';
import { setAuthTokenGetter, getMediaUrl, getSlides } from './lib/api';
import { createThumbnailLoader, type ThumbnailLoader } from './lib/thumbnails';
import * as db from './lib/db';
import type { Category, Video } from './lib/types';
import { Icons } from './components/Icons';
import { LoginScreen } from './screens/LoginScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { EmptyScreen } from './screens/EmptyScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { GalleryScreen } from './screens/GalleryScreen';
import { AccountSheet } from './screens/AccountSheet';
import { SharedLinksScreen } from './screens/SharedLinksScreen';
import { Toast } from './components/Toast';
import { detectCompletions, type Completion } from './lib/importToasts';

type Route = 'library' | 'categories' | 'import' | 'player' | 'shared-links';

function userKeyOf(id: string | undefined | null): string | null {
  return id ? `u:${id}` : null;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}

function Gate() {
  const { session, user, loading, signOut, getAccessToken } = useAuth();
  const userKey = userKeyOf(user?.id);

  // Wire the API client's JWT getter once, to the live Supabase session.
  useEffect(() => {
    setAuthTokenGetter(getAccessToken);
  }, [getAccessToken]);

  // Local Face ID lock state, recomputed whenever the user changes.
  const [biometricEnrolled, setBiometricEnrolled] = useState(false);
  // While locked, the app is gated behind biometric unlock even with a session.
  const [unlocked, setUnlocked] = useState(false);

  // Sync enrolment flag with the current user. Face ID stays opt-in (enabled
  // from Account → Connexion) — no post-sign-in nudge (removed as friction).
  useEffect(() => {
    setBiometricEnrolled(userKey ? isBiometricEnrolled(userKey) : false);
    setUnlocked(false);
  }, [userKey]);

  if (loading) {
    return <BootSplash />;
  }

  const mode = decideAuthMode({ hasSession: !!session, biometricEnrolled });
  // 'biometric' lock is satisfied once unlocked this session.
  const showApp = mode === 'enter' || (mode === 'biometric' && unlocked);

  const handleUnlock = async (): Promise<boolean> => {
    if (!userKey) return false;
    const ok = await unlockBiometric(userKey);
    if (ok) setUnlocked(true);
    return ok;
  };

  const handleSignOut = async () => {
    if (userKey) clearBiometric(userKey);
    setBiometricEnrolled(false);
    setUnlocked(false);
    await signOut();
  };

  if (!showApp) {
    return (
      <div className="app-root">
        <div style={{ position: 'absolute', inset: 0 }}>
          <LoginScreen
            biometricLock={mode === 'biometric'}
            onBiometricUnlock={handleUnlock}
            onEnter={() => { /* route decided by auth state; nothing to force */ }}
          />
        </div>
      </div>
    );
  }

  return <AppShell onSignOut={handleSignOut} />;
}

function BootSplash() {
  return (
    <div className="app-root">
      <div className="view" style={{ background: 'var(--bg-0)', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ width: 26, height: 26, borderRadius: '50%', border: '2.6px solid var(--hairline-strong)', borderTopColor: 'var(--a-rose)', animation: 'spin 0.7s linear infinite' }} />
      </div>
    </div>
  );
}

interface AppShellProps {
  onSignOut: () => void;
}

function AppShell({ onSignOut }: AppShellProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // videoId → signed thumbnail URL, resolved on demand for ready videos.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});
  // Lazy thumbnail loader: a card calls onThumbVisible when it nears the
  // viewport; the loader dedupes + caches and pushes resolved URLs into
  // thumbUrls. Replaces the old eager Promise.all over every ready video.
  const thumbLoaderRef = useRef<ThumbnailLoader | null>(null);
  if (!thumbLoaderRef.current) {
    thumbLoaderRef.current = createThumbnailLoader({
      fetch: (id) => getMediaUrl(id).then((m) => m.thumb_url),
      onResolved: (id, url) => setThumbUrls((prev) => ({ ...prev, [id]: url })),
    });
  }
  const onThumbVisible = useCallback((id: string) => thumbLoaderRef.current!.request(id), []);

  // Matches the prototype: screens receive the active tab as a literal
  // ("library" / "categories"), so the tab value is never read here — only
  // the setter participates in navigation.
  const [, setTab] = useState<TabId>('library');
  const [route, setRoute] = useState<Route>('library');
  const [current, setCurrent] = useState<Video | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [slides, setSlides] = useState<string[] | null>(null);
  // Video pending deletion via library long-press (confirmation sheet).
  const [pendingDelete, setPendingDelete] = useState<Video | null>(null);
  // Monotonic counter identifying the most recent openVideo request, so a stale
  // async media-URL resolution can't clobber the currently displayed video.
  const openVideoReq = useRef(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [navKey, setNavKey] = useState(0);
  // URL pre-filled into the Import screen (deep link / Web Share Target).
  const [importUrl, setImportUrl] = useState<string | undefined>(undefined);
  // File de toasts de fin d'import (un affiché à la fois) + snapshot précédent
  // des vidéos pour détecter les transitions.
  const [toasts, setToasts] = useState<Completion[]>([]);
  const prevVideosRef = useRef<Video[] | null>(null);

  const go = (r: Route) => { setRoute(r); setNavKey((k) => k + 1); };

  // ---- deep link / share target -------------------------------------------
  // At boot (session already active here), honour ?import=<url> (or ?url=) by
  // opening the Import screen pre-filled, then strip the param so a reload /
  // back navigation doesn't re-trigger the flow. iOS uses the Shortcut instead.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const shared = params.get('import') ?? params.get('url');
    if (shared) {
      setImportUrl(shared);
      go('import');
      params.delete('import');
      params.delete('url');
      const qs = params.toString();
      const clean = window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash;
      window.history.replaceState(null, '', clean);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Finalise an ingestion started from the Import screen: close import, jump to
  // the library and refetch so the new video appears (status then evolves via
  // realtime / its own polling).
  const handleSaved = () => {
    setImportUrl(undefined);
    setTab('library');
    go('library');
    void refresh();
  };

  // ---- data loading --------------------------------------------------------

  const refresh = useCallback(async () => {
    try {
      const [vs, cs] = await Promise.all([db.listVideos(), db.listCategories()]);
      setVideos(vs);
      setCategories(cs);
    } catch {
      // Keep the last known data; an empty first load shows the empty/loading UI.
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Realtime: refetch on any change to the user's videos (new ingests, status
  // transitions, deletes). Falls back silently if realtime is unavailable.
  useEffect(() => db.subscribeVideos(() => { void refresh(); }), [refresh]);

  // Détecte les transitions vers ready/error entre deux instantanés de `videos`
  // et empile les toasts correspondants. Premier rendu : snapshot silencieux
  // (aucun toast pour les vidéos déjà terminées au lancement).
  useEffect(() => {
    const prev = prevVideosRef.current;
    prevVideosRef.current = videos;
    if (prev === null) return;
    const done = detectCompletions(prev, videos);
    if (done.length) setToasts((q) => [...q, ...done]);
  }, [videos]);

  // Poll de secours : tant qu'au moins un import est en cours ET que l'app est
  // au premier plan, rafraîchit toutes les 2 s en plus du realtime. S'arrête dès
  // qu'il n'y a plus rien en cours (refresh est idempotent).
  useEffect(() => {
    const inflight = videos.some((v) => v.status !== 'ready' && v.status !== 'error');
    if (!inflight || document.visibilityState !== 'visible') return;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 2000);
    return () => clearInterval(id);
  }, [videos, refresh]);

  // Refetch whenever the app returns to the foreground. On iOS the realtime
  // socket dies while the PWA is backgrounded, and an import done OUTSIDE the
  // app (the iOS Shortcut shares straight to /api/ingest) never reaches a live
  // subscription — so without this the library only updates after a full
  // close/reopen. visibilitychange covers app-switch; focus covers the rest.
  useEffect(() => {
    const onForeground = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onForeground);
    window.addEventListener('focus', onForeground);
    return () => {
      document.removeEventListener('visibilitychange', onForeground);
      window.removeEventListener('focus', onForeground);
    };
  }, [refresh]);

  // ---- actions -------------------------------------------------------------

  const openVideo = async (v: Video) => {
    setCurrent(v);
    setStreamUrl(null);
    setSlides(null);
    go('player');
    const reqId = ++openVideoReq.current;
    try {
      if (v.media_type === 'image') {
        const s = await getSlides(v.id);
        if (openVideoReq.current === reqId) setSlides(s);
      } else {
        const { stream_url } = await getMediaUrl(v.id);
        if (openVideoReq.current === reqId) setStreamUrl(stream_url ?? null);
      }
    } catch {
      if (openVideoReq.current === reqId) { setStreamUrl(null); setSlides(null); }
    }
  };

  const handleUpdateVideo = async (fields: { title?: string; category_id?: string | null }) => {
    if (!current) return;
    // Optimistic local update so the player reflects the change immediately.
    const optimistic = { ...current, ...fields } as Video;
    setCurrent(optimistic);
    setVideos((vs) => vs.map((x) => (x.id === current.id ? optimistic : x)));
    try {
      const updated = await db.updateVideo(current.id, fields);
      setCurrent(updated);
      setVideos((vs) => vs.map((x) => (x.id === updated.id ? updated : x)));
    } catch {
      void refresh();
    }
  };

  const handleDeleteVideo = async (v: Video) => {
    // Optimistic removal. Navigation (if any) is the caller's concern so the
    // delete can be triggered from the library too, not only from the player.
    setVideos((vs) => vs.filter((x) => x.id !== v.id));
    try {
      await db.deleteVideo(v.id);
    } catch {
      void refresh();
    }
  };

  const renameCat = async (id: string, label: string) => {
    const next = label.trim();
    if (!next) return;
    setCategories((cs) => cs.map((c) => (c.id === id ? { ...c, label: next } : c)));
    try {
      await db.renameCategory(id, next);
    } catch {
      void refresh();
    }
  };

  const deleteCat = async (id: string) => {
    setCategories((cs) => cs.filter((c) => c.id !== id));
    // Linked videos become uncategorised (FK on delete set null).
    setVideos((vs) => vs.map((v) => (v.category_id === id ? { ...v, category_id: null } : v)));
    try {
      await db.deleteCategory(id);
    } catch {
      void refresh();
    }
  };

  const addCat = async (label: string) => {
    const next = label.trim();
    if (!next) return;
    try {
      const created = await db.createCategory(next);
      setCategories((cs) => [...cs, created]);
    } catch {
      void refresh();
    }
  };

  const onTab = (t: TabId) => { setTab(t); go(t === 'categories' ? 'categories' : 'library'); };

  // Open the Import screen blank (FAB / empty state); a deep-link URL only
  // pre-fills when set by the share-target effect above.
  const openImport = () => { setImportUrl(undefined); go('import'); };

  const activeToast = toasts[0] ?? null;
  const dismissToast = () => setToasts((q) => q.slice(1));
  const handleToastTap = () => {
    if (!activeToast) return;
    const v = videos.find((x) => x.id === activeToast.id);
    if (!v) return; // supprimé entre-temps
    // Route on the live status, not the toast's snapshot kind, in case the video
    // moved on since the toast was queued.
    if (v.status === 'ready') void openVideo(v);
    else if (v.status === 'error') setPendingDelete(v);
    // sinon : encore en cours → toast obsolète, on ne fait rien (déjà fermé).
  };

  return (
    <div className="app-root">
      <div key={navKey} style={{ position: 'absolute', inset: 0 }}>
        {route === 'library' && (
          !loading && videos.length === 0
            ? <EmptyScreen tab="library" onTab={onTab} onAdd={openImport} />
            : <LibraryScreen videos={videos} categories={categories} thumbUrls={thumbUrls} loading={loading}
                tab="library" onTab={onTab} onOpen={openVideo} onRequestDelete={setPendingDelete}
                onAdd={openImport} onAccount={() => setAccountOpen(true)} onThumbVisible={onThumbVisible} />
        )}
        {route === 'categories' && (
          <CategoriesScreen videos={videos} categories={categories} tab="categories" onTab={onTab}
            onRename={renameCat} onDelete={deleteCat} onAdd={addCat} />
        )}
        {route === 'import' && (
          <ImportScreen categories={categories} initialUrl={importUrl}
            onClose={() => go('library')} onSaved={handleSaved} />
        )}
        {route === 'player' && current && (
          current.media_type === 'image'
            ? <GalleryScreen video={current} categories={categories} slides={slides}
                onBack={() => go('library')} onUpdate={handleUpdateVideo}
                onDelete={(v) => { void handleDeleteVideo(v); go('library'); }} />
            : <PlayerScreen video={current} categories={categories} streamUrl={streamUrl}
                onBack={() => go('library')} onUpdate={handleUpdateVideo}
                onDelete={(v) => { void handleDeleteVideo(v); go('library'); }} />
        )}
        {route === 'shared-links' && (
          <SharedLinksScreen onBack={() => go('library')} />
        )}
      </div>

      {accountOpen && (
        <AccountSheet
          onClose={() => setAccountOpen(false)}
          onSignOut={() => { setAccountOpen(false); onSignOut(); }}
          onSharedLinks={() => { setAccountOpen(false); go('shared-links'); }}
        />
      )}

      {activeToast && (
        <Toast
          key={`${activeToast.id}:${activeToast.kind}`}
          kind={activeToast.kind}
          title={activeToast.title}
          onTap={handleToastTap}
          onDismiss={dismissToast}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteSheet
          title={pendingDelete.title}
          onConfirm={() => { const v = pendingDelete; setPendingDelete(null); void handleDeleteVideo(v); }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

interface ConfirmDeleteSheetProps {
  title: string;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmDeleteSheet({ title, onConfirm, onCancel }: ConfirmDeleteSheetProps) {
  return (
    <div onClick={onCancel} style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', animation: 'fadeBg 0.25s ease both' }}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)', borderBottom: 'none', padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)', animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)', textAlign: 'center' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 18px' }} />
        <div style={{ width: 60, height: 60, borderRadius: '50%', background: 'rgba(255,93,108,0.12)', display: 'grid', placeItems: 'center', margin: '4px auto 16px', color: '#ff8a96' }}>
          <Icons.trash size={26} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 680 }}>Supprimer cette vidéo ?</h3>
        <p style={{ fontSize: 14, color: 'var(--txt-1)', marginTop: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
          « {title} » sera retirée de ta bibliothèque. Cette action est définitive.
        </p>
        <button onClick={onConfirm} style={{ marginTop: 22, width: '100%', height: 54, borderRadius: 16, fontSize: 16, fontWeight: 640, color: '#fff', background: '#e8475a' }}>Supprimer</button>
        <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onCancel}>Annuler</button>
      </div>
    </div>
  );
}

