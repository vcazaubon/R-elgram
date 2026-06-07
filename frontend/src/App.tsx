// ============================================================
// Réelgram — App shell, auth gate & state-based routing
// AuthProvider wraps everything. The Gate decides, from the Supabase
// session + the local Face ID lock, whether to show the LoginScreen
// (email form OR biometric lock) or the authenticated app shell.
// The shell screens (Library/Player/…) stay on mock data — Spec 05 wires
// Supabase CRUD; here the guard only governs ENTRY.
// navKey re-mounts the active screen to replay view-enter transitions.
// ============================================================
import { useEffect, useState } from 'react';
import { CATEGORIES, VIDEOS, type MockCategory, type MockVideo } from './lib/mock';
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
import { LoginScreen } from './screens/LoginScreen';
import { LibraryScreen } from './screens/LibraryScreen';
import { EmptyScreen } from './screens/EmptyScreen';
import { CategoriesScreen } from './screens/CategoriesScreen';
import { ImportScreen } from './screens/ImportScreen';
import { PlayerScreen } from './screens/PlayerScreen';
import { DesignDirectionScreen } from './screens/DesignDirectionScreen';

type Route = 'library' | 'categories' | 'import' | 'player' | 'direction';

const ADD_HEXES = ['#ff7eb3', '#ff9966', '#a78bfa', '#5ee2a0', '#5fa8ff', '#ffd166'];

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
  const { session, user, loading, signOut } = useAuth();
  const userKey = userKeyOf(user?.id);

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
  const [videos, setVideos] = useState<MockVideo[]>(VIDEOS);
  const [categories, setCategories] = useState<MockCategory[]>(CATEGORIES);
  // Matches the prototype: screens receive the active tab as a literal
  // ("library" / "categories"), so the tab value is never read here — only
  // the setter participates in navigation.
  const [, setTab] = useState<TabId>('library');
  const [route, setRoute] = useState<Route>('library');
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

      {/* Sign out lives in the Account sheet in Spec 05; expose a minimal hook
          here so the guard's signOut path is reachable and not dead code. */}
      <button
        onClick={onSignOut}
        aria-label="Se déconnecter"
        style={{ position: 'absolute', top: 'calc(env(safe-area-inset-top, 0px) + 8px)', right: 14, zIndex: 30, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
      />

      {offerEnroll && <EnrollSheet onEnroll={onEnroll} onSkip={onSkipEnroll} />}
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
