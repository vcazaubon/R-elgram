// ============================================================
// Réelgram — backend API client (Spec 05)
// Thin fetch wrapper for the FastAPI backend mounted under config.apiUrl.
// Reads (CRUD metadata) go through Supabase directly (db.ts); this client
// covers ingestion and the media/file path — endpoints only the backend
// can serve (yt-dlp/ffmpeg + the media volume + signed URLs).
//
// Auth: every request attaches `Authorization: Bearer <supabase_jwt>` when
// a token is available. The JWT getter is injectable via
// setAuthTokenGetter — App wires it to useAuth().getAccessToken (Spec 05 T6),
// which also keeps this module trivially testable (no React/Supabase import).
// cf. docs/superpowers/specs/2026-06-07-reelgram-design.md §5
// ============================================================
import { config } from './config';
import type { ApiToken, IngestStatus, MediaUrls, VideoStatus } from './types';
import type { ShareCreated, ShareInfo, ShareGlobalInfo, ShareExpiresIn } from './types';

// ---- injectable JWT getter --------------------------------------------------

export type AuthTokenGetter = () => Promise<string | null>;

// Default: no token. App overrides this with the real Supabase getter so the
// client works during tests / before auth is wired without importing auth.tsx.
let authTokenGetter: AuthTokenGetter = async () => null;

/** Inject the function used to resolve the current Supabase JWT. */
export function setAuthTokenGetter(getter: AuthTokenGetter): void {
  authTokenGetter = getter;
}

async function currentToken(): Promise<string | null> {
  try {
    return await authTokenGetter();
  } catch {
    // A failing session lookup must never break the request building; the
    // backend will reply 401 and callers surface that like any other error.
    return null;
  }
}

// ---- core fetch -------------------------------------------------------------

export interface ApiError extends Error {
  status: number;
}

function makeError(status: number, message: string): ApiError {
  const err = new Error(message) as ApiError;
  err.status = status;
  return err;
}

interface ApiFetchOptions {
  method?: string;
  /** JSON-serialisable body; Content-Type is set automatically. */
  json?: unknown;
}

/**
 * Issue a request against `${config.apiUrl}${path}`, attaching the bearer
 * token when present, parsing the JSON response, and throwing on non-ok with
 * the backend `detail`. 204 / empty responses resolve to undefined.
 */
export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};

  const token = await currentToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let body: string | undefined;
  if (opts.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.json);
  }

  const init: RequestInit = { headers };
  if (opts.method) init.method = opts.method;
  if (body !== undefined) init.body = body;

  const res = await fetch(`${config.apiUrl}${path}`, init);

  if (!res.ok) {
    let detail = `Erreur ${res.status}`;
    try {
      const data = await res.json();
      if (data && typeof data.detail === 'string') detail = data.detail;
    } catch {
      // Non-JSON / empty error body — keep the status-based message.
    }
    throw makeError(res.status, detail);
  }

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    // ok response without a JSON body (e.g. 200 + empty) — treat as void.
    return undefined as T;
  }
}

// ---- ingestion --------------------------------------------------------------

export interface IngestResult {
  id: string;
  status: VideoStatus;
}

/** Queue an Instagram URL for ingestion. Returns the new video id + status. */
export function ingest(url: string, categoryId?: string): Promise<IngestResult> {
  const payload: { url: string; category_id?: string } = { url };
  if (categoryId) payload.category_id = categoryId;
  return apiFetch<IngestResult>('/ingest', { method: 'POST', json: payload });
}

/** Poll the ingestion job status (used by the Import screen, Spec 07). */
export function ingestStatus(id: string): Promise<IngestStatus> {
  return apiFetch<IngestStatus>(`/ingest/${id}/status`);
}

// ---- media ------------------------------------------------------------------

/** Resolve short-lived signed stream + thumbnail URLs for a video. */
export function getMediaUrl(id: string): Promise<MediaUrls> {
  return apiFetch<MediaUrls>(`/videos/${id}/media-url`);
}

/**
 * Résout les URLs signées des slides d'un post image (ordre = index). Renvoie
 * un tableau vide si le post n'est pas une image (sécurité d'appel).
 */
export async function getSlides(id: string): Promise<string[]> {
  const m = await getMediaUrl(id);
  return m.slides ?? [];
}

/**
 * Full purge of a video: row + video file + thumbnail. The backend endpoint
 * lands in Spec 06; the call site is in place from now (db.deleteVideo delegates
 * here so no direct Supabase delete is ever issued).
 */
export function deleteVideo(id: string): Promise<void> {
  return apiFetch<void>(`/videos/${id}`, { method: 'DELETE' });
}

// ---- personal tokens (iOS Shortcut) ----------------------------------------

/** List the account's personal API tokens (no plaintext). */
export function listTokens(): Promise<ApiToken[]> {
  return apiFetch<ApiToken[]>('/tokens');
}

export interface CreatedToken {
  id: string;
  /** Plaintext token — returned ONCE, never retrievable again. */
  token: string;
}

/** Create a personal token; the plaintext is only returned here. */
export function createToken(label?: string): Promise<CreatedToken> {
  const payload: { label?: string } = {};
  if (label) payload.label = label;
  return apiFetch<CreatedToken>('/tokens', { method: 'POST', json: payload });
}

/** Revoke a personal token. */
export function deleteToken(id: string): Promise<void> {
  return apiFetch<void>(`/tokens/${id}`, { method: 'DELETE' });
}

// ---- shares (liens publics) -------------------------------------------------

export interface ShareCreateInput {
  expires_in: ShareExpiresIn;
  password?: string | null;
}

/** Crée un lien de partage pour un réel. */
export function createShare(videoId: string, input: ShareCreateInput): Promise<ShareCreated> {
  const payload: { expires_in: ShareExpiresIn; password?: string } = { expires_in: input.expires_in };
  if (input.password) payload.password = input.password;
  return apiFetch<ShareCreated>(`/videos/${videoId}/shares`, { method: 'POST', json: payload });
}

/** Liste les liens d'un réel. */
export function listVideoShares(videoId: string): Promise<ShareInfo[]> {
  return apiFetch<ShareInfo[]>(`/videos/${videoId}/shares`);
}

/** Liste globale de tous les liens (vue Compte). */
export function listAllShares(): Promise<ShareGlobalInfo[]> {
  return apiFetch<ShareGlobalInfo[]>('/shares');
}

/** Révoque un lien. */
export function deleteShare(shareId: string): Promise<void> {
  return apiFetch<void>(`/shares/${shareId}`, { method: 'DELETE' });
}
