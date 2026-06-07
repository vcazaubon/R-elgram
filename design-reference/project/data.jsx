/* ============================================================
   Réelgram — Icons (stroke, premium, consistent 1.7 weight)
   ============================================================ */
const Ico = ({ d, size = 24, sw = 1.7, fill = "none", children, ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill}
    stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {d ? <path d={d} /> : children}
  </svg>
);

const Icons = {
  search: (p) => <Ico {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></Ico>,
  plus: (p) => <Ico d="M12 5v14M5 12h14" {...p} />,
  link: (p) => <Ico {...p}><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" /></Ico>,
  play: (p) => <Ico fill="currentColor" stroke="none" {...p}><path d="M8 5.5v13a1 1 0 0 0 1.52.86l10.5-6.5a1 1 0 0 0 0-1.72L9.52 4.64A1 1 0 0 0 8 5.5z" /></Ico>,
  pause: (p) => <Ico fill="currentColor" stroke="none" {...p}><rect x="7" y="5" width="3.4" height="14" rx="1.2" /><rect x="13.6" y="5" width="3.4" height="14" rx="1.2" /></Ico>,
  back: (p) => <Ico d="M15 5l-7 7 7 7" {...p} />,
  chevron: (p) => <Ico d="M9 6l6 6-6 6" {...p} />,
  close: (p) => <Ico d="M6 6l12 12M18 6L6 18" {...p} />,
  library: (p) => <Ico {...p}><rect x="3" y="4" width="18" height="14" rx="3" /><path d="M3 9h18" /><path d="M8 18v2M16 18v2" /></Ico>,
  grid: (p) => <Ico {...p}><rect x="4" y="4" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="2" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="2" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="2" /></Ico>,
  tag: (p) => <Ico {...p}><path d="M3 11.5V5a2 2 0 0 1 2-2h6.5a2 2 0 0 1 1.4.6l7 7a2 2 0 0 1 0 2.8l-6.5 6.5a2 2 0 0 1-2.8 0l-7-7A2 2 0 0 1 3 11.5z" /><circle cx="7.5" cy="7.5" r="1.4" fill="currentColor" stroke="none" /></Ico>,
  trash: (p) => <Ico {...p}><path d="M4 7h16" /><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" /><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" /></Ico>,
  edit: (p) => <Ico {...p}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></Ico>,
  check: (p) => <Ico d="M5 12.5l4.5 4.5L19 7" {...p} />,
  retry: (p) => <Ico {...p}><path d="M3.5 12a8.5 8.5 0 1 1 2.6 6.1" /><path d="M3 14.5V19h4.5" /></Ico>,
  sparkle: (p) => <Ico {...p}><path d="M12 3l1.8 4.9L19 9.7l-4.2 1.8L12 16l-1.8-4.5L6 9.7l5.2-1.8z" /><path d="M19 15l.7 1.9L21.5 18l-1.8.7L19 21l-.7-2.3L16.5 18l1.8-.7z" /></Ico>,
  insta: (p) => <Ico {...p}><rect x="3.5" y="3.5" width="17" height="17" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none" /></Ico>,
  clock: (p) => <Ico {...p}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></Ico>,
  volume: (p) => <Ico {...p}><path d="M4 9.5v5h3.5L12 19V5L7.5 9.5z" /><path d="M16 9a4 4 0 0 1 0 6" /><path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" /></Ico>,
  expand: (p) => <Ico {...p}><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M16 3h3a2 2 0 0 1 2 2v3" /><path d="M21 16v3a2 2 0 0 1-2 2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /></Ico>,
  more: (p) => <Ico {...p}><circle cx="6" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" /><circle cx="18" cy="12" r="1.5" fill="currentColor" stroke="none" /></Ico>,
  signal: (p) => <Ico fill="currentColor" stroke="none" {...p}><rect x="2" y="11" width="3" height="6" rx="1" /><rect x="7" y="8" width="3" height="9" rx="1" /><rect x="12" y="5" width="3" height="12" rx="1" /><rect x="17" y="2.5" width="3" height="14.5" rx="1" /></Ico>,
};

/* ============================================================
   Categories
   ============================================================ */
const CATEGORIES = [
  { id: "revoir", label: "À revoir", color: "var(--c-revoir)", hex: "#ff9966" },
  { id: "inspiration", label: "Inspiration", color: "var(--c-inspiration)", hex: "#a78bfa" },
  { id: "muscu", label: "Muscu", color: "var(--c-muscu)", hex: "#5ee2a0" },
  { id: "business", label: "Business", color: "var(--c-business)", hex: "#5fa8ff" },
  { id: "humour", label: "Humour", color: "var(--c-humour)", hex: "#ffd166" },
  { id: "idees", label: "Idées", color: "var(--c-idees)", hex: "#ff7eb3" },
];
const catById = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];

/* ============================================================
   Sample library — placeholder thumbnails via gradient pairs
   ============================================================ */
const VIDEOS = [
  { id: "v1", title: "Morning routine — 5h du mat", cat: "inspiration", date: "Aujourd'hui", dur: "0:48", auteur: "@dontgiveup", g: ["#3a1f5c", "#7d3c8f"] },
  { id: "v2", title: "Tractions lestées progression", cat: "muscu", date: "Hier", dur: "1:12", auteur: "@calisthenics", g: ["#0f3d33", "#1f7a5c"] },
  { id: "v3", title: "Hook qui convertit en 3s", cat: "business", date: "Hier", dur: "0:31", auteur: "@growthlab", g: ["#102a52", "#2e6bd6"] },
  { id: "v4", title: "Le chat qui claque la porte", cat: "humour", date: "2 j", dur: "0:22", auteur: "@dailylol", g: ["#4a3a0d", "#b08a1e"] },
  { id: "v5", title: "Setup bureau minimal 2026", cat: "inspiration", date: "3 j", dur: "0:57", auteur: "@deskgoals", g: ["#3a1342", "#8a2e6b"] },
  { id: "v6", title: "Idée d'app : vault de reels", cat: "idees", date: "4 j", dur: "0:40", auteur: "@buildinpublic", g: ["#4a1233", "#d6457e"] },
  { id: "v7", title: "Meal prep 1500 kcal", cat: "muscu", date: "5 j", dur: "1:34", auteur: "@fitkitchen", g: ["#123d2a", "#26a36b"] },
  { id: "v8", title: "Storytelling pour landing", cat: "business", date: "1 sem", dur: "0:52", auteur: "@copychief", g: ["#13294a", "#3f7fd6"] },
];

Object.assign(window, { Icons, CATEGORIES, catById, VIDEOS });
