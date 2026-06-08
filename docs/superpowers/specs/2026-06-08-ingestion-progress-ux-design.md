# Spec — UX d'ingestion en cours (carte enrichie + toast de fin)

> Fonctionnalité **frontend uniquement** (React + Vite PWA). Aucun changement
> backend, aucune migration, aucune nouvelle dépendance. Dépend de Spec 05
> (bibliothèque / lecteur) et Spec 07 (import iOS), déjà en place.

## Objectif

Quand l'utilisateur partage un réel (via le raccourci iOS, qui poste directement
sur `/api/ingest` puis renvoie dans l'app), il rouvre l'app et atterrit sur la
bibliothèque pendant que l'ingestion tourne encore. Aujourd'hui il voit une carte
**grisée** (`opacity: 0.78`) avec un simple badge « … » en bas à droite : on ne
sait ni que ça travaille, ni où ça en est, ni quand c'est fini.

On veut :

1. **La carte devient l'indicateur** : anneau de progression + libellé d'étape
   pendant l'ingestion.
2. **Un toast de fin** confirme le résultat (succès ou échec) une fois l'ingestion
   terminée.
3. Des mises à jour **fiables** (l'anneau avance, le toast part) même si le
   Supabase realtime ne délivre pas.

### Décisions verrouillées (brainstorming)

- **Direction** : carte enrichie **+** toast de fin (option C).
- **Carte** : anneau de progression + libellé d'étape, **sans pourcentage**
  (les % du pipeline sont volontairement lissés → un chiffre précis serait
  trompeur).
- **Toast** : en **bas, au-dessus de la barre d'onglets** ; **tap = ouvre le réel
  prêt** ; libellé **avec le titre** du réel.
- **Échec** : on affiche aussi un **toast d'erreur** ; tap → ouvre directement la
  **confirmation de suppression** (`ConfirmDeleteSheet` existant), pas un lecteur
  vide. Le « relancer / re-ingestion » est **hors périmètre**.
- **Fiabilité** : Supabase realtime **+ poll de secours** (~2 s) tant qu'au moins
  un import est en cours.

### Hors périmètre

- Toute modification backend / base de données.
- Re-ingestion (« réessayer ») depuis le toast d'erreur.
- Barre de progression fine côté pipeline (on reste sur les 3 étapes du statut).
- File d'attente visuelle complexe (voir « défauts » ci-dessous : un toast à la
  fois, en file).

## Composants & responsabilités

### 1. Carte « en cours » — `frontend/src/components/VideoCard.tsx` (modif)

Quand `video.status` n'est ni `ready` ni `error`, remplacer le badge « … » par un
**overlay de progression** sur l'aperçu :

- **Anneau** : cercle SVG dont le `stroke-dashoffset` est dérivé de
  `progressFor(video.status).percent` (logique existante dans `ingestProgress.ts`).
- **Libellé d'étape** sous l'anneau, depuis un nouveau map `STEP_LABELS`
  (cf. §3) : `analyzing` → « Analyse… », `fetching` → « Téléchargement… »,
  `thumbnailing` → « Aperçu… ».
- La carte passe en **opacité quasi-pleine** (l'overlay suffit à signaler le
  travail en cours) ; elle reste **non navigable** (`<div aria-disabled>`,
  inchangé) et **supprimable au long-press** (inchangé).
- L'état `error` conserve son badge « Erreur » actuel (inchangé).

Réutilise le glassmorphism existant (`rgba(8,8,10,0.4)` + `backdrop-filter`) et
l'animation `spin` / l'anneau déjà présents dans `ImportScreen.tsx`.

### 2. Toast — `frontend/src/components/Toast.tsx` (nouveau)

Composant **présentationnel** (aucune logique de détection). Props :

```ts
type ToastKind = 'success' | 'error';
interface ToastProps {
  kind: ToastKind;
  title: string;        // titre du réel (success) ; libellé d'erreur (error)
  onTap: () => void;    // success → ouvrir le réel ; error → ouvrir la suppression
  onDismiss: () => void;
}
```

- Position **fixe en bas**, au-dessus de la barre d'onglets, **safe-area aware**
  (`env(safe-area-inset-bottom)`).
- Succès : « ✓ « *{title}* » ajouté ». Erreur : « Échec de l'import » (style
  erreur, accent rouge cohérent avec le `#ff8a96` déjà utilisé).
- **Auto-disparition ~4 s** ; **tap** → `onTap` (et le toast se ferme ensuite) ;
  **swipe** ou **timeout** → `onDismiss`. Animation d'entrée/sortie avec l'easing
  `--ease` existant.

### 3. Libellés d'étape — `frontend/src/lib/ingestProgress.ts` (modif)

Ajouter un export pur, testable :

```ts
export const STEP_LABELS: Record<VideoStatus, string> = {
  analyzing: 'Analyse…',
  fetching: 'Téléchargement…',
  thumbnailing: 'Aperçu…',
  ready: 'Prêt',
  error: 'Erreur',
};
```

(`ready`/`error` présents pour exhaustivité du type ; la carte n'affiche le
libellé que pour les états en cours.)

### 4. Détection de fin — `frontend/src/lib/importToasts.ts` (nouveau, pur)

Fonction **pure** comparant deux listes de vidéos pour repérer les transitions :

```ts
interface Completion { id: string; kind: ToastKind; title: string; }

/** Réels passés de 'non terminé' à 'ready' (success) ou 'error' (error)
 *  entre prev et next. Ignore tout réel absent de prev (déjà connu => pas une
 *  transition observée). */
export function detectCompletions(prev: Video[], next: Video[]): Completion[];
```

Règles :
- `success` quand un id passe d'un statut non-`ready` (dans `prev`) à `ready`
  (dans `next`).
- `error` quand un id passe d'un statut non-`error` à `error`.
- Un id **présent dans `next` mais absent de `prev`** n'est **pas** une transition
  (cas du tout premier chargement / nouvelle vidéo déjà avancée) → pas de toast.
  C'est ce qui garantit **zéro spam au lancement**.

### 5. Orchestration — `frontend/src/App.tsx` (modif)

`App` possède déjà `videos`, `refresh`, l'abonnement realtime
(`subscribeVideos`) et le refresh au premier plan. On ajoute :

- **Snapshot précédent** : conserver la liste `videos` précédente (ref) ; à chaque
  `setVideos`, appeler `detectCompletions(prev, next)` et **empiler** les toasts
  obtenus dans une file (`toastQueue`). Au **premier** chargement, on enregistre le
  snapshot **sans** émettre de toast.
- **File de toasts** : afficher **un toast à la fois** ; à la fermeture (tap,
  swipe ou timeout), passer au suivant.
- **Handlers tap** : `success` → `onOpen(video)` (ouvre le lecteur, logique
  existante) ; `error` → `onRequestDelete(video)` (ouvre `ConfirmDeleteSheet`,
  logique existante).
- **Poll de secours** : un `useEffect` qui, **tant que** `videos.some(v => v.status
  !== 'ready' && v.status !== 'error')` **et que l'app est au premier plan**,
  lance `setInterval(refresh, 2000)` ; nettoyé dès qu'il n'y a plus d'import en
  cours ou que l'app passe en arrière-plan. Coexiste avec le realtime (`refresh`
  est idempotent).

## Flux de données

1. Backend fait avancer `videos.status` (`fetching` → `thumbnailing` → `ready`/`error`).
2. Realtime **et/ou** poll de secours → `App.refresh()` recharge `videos` → `setVideos`.
3. La carte se re-rend : l'anneau avance, le libellé change ; à `ready` elle
   redevient une carte normale cliquable.
4. `detectCompletions(prev, next)` repère la transition → toast empilé.
5. Le toast s'affiche en bas ; tap succès → lecteur ; tap erreur → suppression.

## Gestion des erreurs

- Échec d'ingestion → un toast d'erreur (en plus du badge « Erreur » sur la carte).
- Échecs réseau du poll/refresh : silencieux (on retente au tick suivant), comme
  le polling existant de l'`ImportScreen`.
- Aucune nouvelle exception possible : `detectCompletions` et `STEP_LABELS` sont
  purs et défensifs.

## Critères d'acceptation

- Partager un réel puis rouvrir l'app : la carte affiche un **anneau + l'étape en
  cours** (plus de carte « cassée » grisée avec un simple « … »).
- L'anneau **avance** au fil des étapes, y compris si le realtime ne délivre pas
  (grâce au poll de secours) ; il s'arrête quand tout est `ready`/`error`.
- À la fin, un **toast** « ✓ « *titre* » ajouté » apparaît en bas ; **tap → ouvre
  le réel**.
- En cas d'échec, un **toast d'erreur** apparaît ; **tap → confirmation de
  suppression**.
- **Aucun toast** n'apparaît pour les vidéos déjà prêtes au moment où l'on ouvre
  l'app (pas de spam au lancement).
- Le poll de secours **ne tourne pas** quand aucun import n'est en cours, ni quand
  l'app est en arrière-plan.

## Tests

Tests **purs** (cohérent avec l'existant : `ingestProgress.test.ts`, `db.test.ts`,
`api.test.ts`, exécutés via Vitest) :

- `detectCompletions` :
  - transition non-ready → `ready` → un `Completion` `success` avec le bon `title`.
  - transition non-error → `error` → un `Completion` `error`.
  - id présent dans `next` mais absent de `prev` → **aucun** completion (anti-spam).
  - aucune transition (listes identiques) → `[]`.
  - statut inchangé encore en cours (`fetching` → `fetching`) → `[]`.
- `STEP_LABELS` : libellés attendus pour `analyzing`/`fetching`/`thumbnailing`.
- Math de l'anneau (si une petite fonction `dashoffsetFor(percent, r)` est
  extraite) : 0 % → offset = circonférence ; 100 % → offset = 0.

Les changements **visuels** (overlay carte, toast, animations) sont vérifiés
**manuellement** via le serveur de dev Vite déjà exposé à distance
(cf. mémoire « dev server »), faute d'infra de tests de rendu React dans le repo.
