// frontend/src/public/publicApi.ts
const API = (window.__ENV__?.API_URL ?? '/api');

export interface PublicMeta {
  media_type: 'video' | 'image';
  title: string;
  needs_password: boolean;
  expires_at: string | null;
  stream_url?: string;
  slides?: string[];
  thumb_url?: string;
}

export type ResolveResult =
  | { state: 'ok'; meta: PublicMeta }
  | { state: 'password' }
  | { state: 'gone' }
  | { state: 'notfound' };

function slugFromPath(): string {
  const m = window.location.pathname.match(/\/s\/([^/?#]+)/);
  return m ? m[1] : '';
}

export async function resolveShare(): Promise<ResolveResult> {
  const slug = slugFromPath();
  if (!slug) return { state: 'notfound' };
  const res = await fetch(`${API}/share/${slug}`);
  if (res.status === 410) return { state: 'gone' };
  if (res.status === 404) return { state: 'notfound' };
  if (!res.ok) return { state: 'gone' };
  const meta = (await res.json()) as PublicMeta;
  return meta.needs_password ? { state: 'password' } : { state: 'ok', meta };
}

export async function unlockShare(password: string): Promise<PublicMeta | null> {
  const slug = slugFromPath();
  const res = await fetch(`${API}/share/${slug}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  return (await res.json()) as PublicMeta;
}
