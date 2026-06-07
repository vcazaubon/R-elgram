// ============================================================
// Réelgram — mock data (Spec 03)
// Ported verbatim from design-reference/project/data.jsx.
// Kept separate from lib/types.ts (the real data model, Spec 01).
// These mock shapes drive the design-system screens until the
// Supabase/backend wiring lands (Spec 04/05).
// ============================================================

export interface MockCategory {
  id: string;
  label: string;
  color: string; // CSS var() reference, e.g. "var(--c-revoir)"
  hex: string; // resolved hex, e.g. "#ff9966"
}

export interface MockVideo {
  id: string;
  title: string;
  cat: string; // MockCategory.id
  date: string;
  dur: string;
  auteur: string;
  g: [string, string]; // placeholder thumbnail gradient pair
}

export const CATEGORIES: MockCategory[] = [
  { id: 'revoir', label: 'À revoir', color: 'var(--c-revoir)', hex: '#ff9966' },
  { id: 'inspiration', label: 'Inspiration', color: 'var(--c-inspiration)', hex: '#a78bfa' },
  { id: 'muscu', label: 'Muscu', color: 'var(--c-muscu)', hex: '#5ee2a0' },
  { id: 'business', label: 'Business', color: 'var(--c-business)', hex: '#5fa8ff' },
  { id: 'humour', label: 'Humour', color: 'var(--c-humour)', hex: '#ffd166' },
  { id: 'idees', label: 'Idées', color: 'var(--c-idees)', hex: '#ff7eb3' },
];

export const catById = (id: string): MockCategory =>
  CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

export const VIDEOS: MockVideo[] = [
  { id: 'v1', title: 'Morning routine — 5h du mat', cat: 'inspiration', date: "Aujourd'hui", dur: '0:48', auteur: '@dontgiveup', g: ['#3a1f5c', '#7d3c8f'] },
  { id: 'v2', title: 'Tractions lestées progression', cat: 'muscu', date: 'Hier', dur: '1:12', auteur: '@calisthenics', g: ['#0f3d33', '#1f7a5c'] },
  { id: 'v3', title: 'Hook qui convertit en 3s', cat: 'business', date: 'Hier', dur: '0:31', auteur: '@growthlab', g: ['#102a52', '#2e6bd6'] },
  { id: 'v4', title: 'Le chat qui claque la porte', cat: 'humour', date: '2 j', dur: '0:22', auteur: '@dailylol', g: ['#4a3a0d', '#b08a1e'] },
  { id: 'v5', title: 'Setup bureau minimal 2026', cat: 'inspiration', date: '3 j', dur: '0:57', auteur: '@deskgoals', g: ['#3a1342', '#8a2e6b'] },
  { id: 'v6', title: "Idée d'app : vault de reels", cat: 'idees', date: '4 j', dur: '0:40', auteur: '@buildinpublic', g: ['#4a1233', '#d6457e'] },
  { id: 'v7', title: 'Meal prep 1500 kcal', cat: 'muscu', date: '5 j', dur: '1:34', auteur: '@fitkitchen', g: ['#123d2a', '#26a36b'] },
  { id: 'v8', title: 'Storytelling pour landing', cat: 'business', date: '1 sem', dur: '0:52', auteur: '@copychief', g: ['#13294a', '#3f7fd6'] },
];
