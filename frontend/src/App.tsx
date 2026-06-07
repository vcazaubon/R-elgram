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
  isBiometricAvailable,
  isBiometricEnrolled,
  enrollBiometric,
  unlockBiometric,
  clearBiometric,
} from './lib/biometric';
import { setAuthTokenGetter, getMediaUrl } from './lib/api';
import * as db from './lib/db';
import type { Category, Video } from './lib/types';
import { Icons } from './components/Icons';
import { LoginScreen } from './screens/LoginScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { EmptyScreen } from './screens/EmptyScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { AccountSheet } from './screens/AccountSheet';

type Route = 'library' | 'categories' | 'import' | 'player';

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
  // One-shot enrolment offer after a fresh sign-in on a capable device.
  const [offerEnroll, setOfferEnroll] = useState(false);
  const [enrollDismissed, setEnrollDismissed] = useState(false);

  // Sync enrolment flag with the current user.
  useEffect(() => {
    setBiometricEnrolled(userKey ? isBiometricEnrolled(userKey) : false);
    setUnlocked(false);
    setEnrollDismissed(false);
    setOfferEnroll(false);
  }, [userKey]);

  // After sign-in with no enrolled credential, offer enrolment if the device
  // supports it. Never blocks: on unsupported browsers this stays false.
  useEffect(() => {
    let active = true;
    if (session && userKey && !biometricEnrolled && !enrollDismissed) {
      isBiometricAvailable().then((ok) => {
        if (active && ok) setOfferEnroll(true);
      });
    } else {
      setOfferEnroll(false);
    }
    return () => { active = false; };
  }, [session, userKey, biometricEnrolled, enrollDismissed]);

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

  const handleEnroll = async () => {
    if (!userKey) { setOfferEnroll(false); return; }
    const ok = await enrollBiometric(userKey);
    if (ok) setBiometricEnrolled(true);
    setOfferEnroll(false);
    setEnrollDismissed(true);
  };

  const skipEnroll = () => { setOfferEnroll(false); setEnrollDismissed(true); };

  const handleSignOut = async () => {
    if (userKey) clearBiometric(userKey);
    setBiometricEnrolled(false);
    setUnlocked(false);
    setOfferEnroll(false);
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

  return (
    <AppShell
      onSignOut={handleSignOut}
      offerEnroll={offerEnroll}
      onEnroll={handleEnroll}
      onSkipEnroll={skipEnroll}
    />
  );
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
  offerEnroll: boolean;
  onEnroll: () => void;
  onSkipEnroll: () => void;
}

function AppShell({ onSignOut, offerEnroll, onEnroll, onSkipEnroll }: AppShellProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  // videoId → signed thumbnail URL, resolved on demand for ready videos.
  const [thumbUrls, setThumbUrls] = useState<Record<string, string>>({});

  // Matches the prototype: screens receive the active tab as a literal
  // ("library" / "categories"), so the tab value is never read here — only
  // the setter participates in navigation.
  const [, setTab] = useState<TabId>('library');
  const [route, setRoute] = useState<Route>('library');
  const [current, setCurrent] = useState<Video | null>(null);
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  // Video pending deletion via library long-press (confirmation sheet).
  const [pendingDelete, setPendingDelete] = useState<Video | null>(null);
  // Monotonic counter identifying the most recent openVideo request, so a stale
  // async media-URL resolution can't clobber the currently displayed video.
  const openVideoReq = useRef(0);
  const [accountOpen, setAccountOpen] = useState(false);
  const [navKey, setNavKey] = useState(0);
  // URL pre-filled into the Import screen (deep link / Web Share Target).
  const [importUrl, setImportUrl] = useState<string | undefined>(undefined);

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

  // Resolve thumbnail URLs for ready videos we haven't fetched yet.
  useEffect(() => {
    let active = true;
    const pending = videos.filter((v) => v.status === 'ready' && !thumbUrls[v.id]);
    if (pending.length === 0) return;
    void Promise.all(
      pending.map(async (v) => {
        try {
          const { thumb_url } = await getMediaUrl(v.id);
          return [v.id, thumb_url] as const;
        } catch {
          return null;
        }
      }),
    ).then((pairs) => {
      if (!active) return;
      const next: Record<string, string> = {};
      for (const p of pairs) if (p) next[p[0]] = p[1];
      if (Object.keys(next).length) setThumbUrls((prev) => ({ ...prev, ...next }));
    });
    return () => { active = false; };
  }, [videos, thumbUrls]);

  // ---- actions -------------------------------------------------------------

  const openVideo = async (v: Video) => {
    setCurrent(v);
    setStreamUrl(null);
    go('player');
    // Guard against a race when videos are opened in quick succession: a slow
    // getMediaUrl for an earlier video must not overwrite the stream URL of the
    // one now showing. Only the latest request is allowed to apply its result.
    const reqId = ++openVideoReq.current;
    try {
      const { stream_url } = await getMediaUrl(v.id);
      if (openVideoReq.current === reqId) setStreamUrl(stream_url);
    } catch {
      if (openVideoReq.current === reqId) setStreamUrl(null);
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

  return (
    <div className="app-root">
      <div key={navKey} style={{ position: 'absolute', inset: 0 }}>
        {route === 'library' && (
          !loading && videos.length === 0
            ? <EmptyScreen tab="library" onTab={onTab} onAdd={openImport} />
            : <LibraryScreen videos={videos} categories={categories} thumbUrls={thumbUrls} loading={loading}
                tab="library" onTab={onTab} onOpen={openVideo} onRequestDelete={setPendingDelete}
                onAdd={openImport} onAccount={() => setAccountOpen(true)} />
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
          <PlayerScreen video={current} categories={categories} streamUrl={streamUrl}
            onBack={() => go('library')} onUpdate={handleUpdateVideo}
            onDelete={(v) => { void handleDeleteVideo(v); go('library'); }} />
        )}
      </div>

      {accountOpen && (
        <AccountSheet
          onClose={() => setAccountOpen(false)}
          onSignOut={() => { setAccountOpen(false); onSignOut(); }}
        />
      )}

      {offerEnroll && <EnrollSheet onEnroll={onEnroll} onSkip={onSkipEnroll} />}

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

interface EnrollSheetProps {
  onEnroll: () => void;
  onSkip: () => void;
}

function EnrollSheet({ onEnroll, onSkip }: EnrollSheetProps) {
  return (
    <div onClick={onSkip} style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(3px)', animation: 'fadeBg 0.25s ease both' }}>
      <style>{`@keyframes fadeBg{from{opacity:0}to{opacity:1}}@keyframes sheetUp{from{transform:translateY(100%)}to{transform:none}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--bg-1)', borderRadius: '26px 26px 0 0', border: '1px solid var(--hairline)', borderBottom: 'none', padding: '10px 22px calc(env(safe-area-inset-bottom,0px) + 26px)', animation: 'sheetUp 0.36s var(--ease) both', boxShadow: '0 -20px 60px -20px rgba(0,0,0,0.8)', textAlign: 'center' }}>
        <div style={{ width: 40, height: 5, borderRadius: 999, background: 'var(--hairline-strong)', margin: '0 auto 20px' }} />
        <div style={{ width: 64, height: 64, borderRadius: 20, background: 'var(--grad-accent)', display: 'grid', placeItems: 'center', margin: '0 auto 16px', color: '#120a14', boxShadow: '0 14px 34px -12px rgba(255,126,179,0.5)' }}>
          <FaceIdGlyphLg />
        </div>
        <h3 style={{ fontSize: 19, fontWeight: 700 }}>Verrouiller avec Face ID ?</h3>
        <p style={{ fontSize: 14, color: 'var(--txt-1)', marginTop: 8, lineHeight: 1.5 }}>
          Ajoute un verrou biométrique par-dessus ta session. À chaque ouverture, ton vault restera privé.
        </p>
        <button className="btn-primary" style={{ marginTop: 22 }} onClick={onEnroll}>Activer Face ID</button>
        <button className="btn-ghost" style={{ marginTop: 10 }} onClick={onSkip}>Plus tard</button>
      </div>
    </div>
  );
}

function FaceIdGlyphLg() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M9 10v1M15 10v1M12 9.5v3.5M10.5 12h-.5" />
      <path d="M9 15.5c.9.8 1.9 1.1 3 1.1s2.1-.3 3-1.1" />
    </svg>
  );
}
