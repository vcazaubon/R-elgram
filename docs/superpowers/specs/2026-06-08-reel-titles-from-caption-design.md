# Spec — Titres de reels parlants (dérivés de la légende)

> Nouvelle fonctionnalité post-V1. Touche uniquement l'ingestion backend
> (`backend/app/ingest.py`) + une migration Supabase. Dépend de Spec 02 (backend)
> et Spec 05 (lecteur/bibliothèque, déjà en place). Pas de changement frontend.

## Objectif

Quand un reel est ingéré, le titre affiché est aujourd'hui `Video by xxx` — une
chaîne **synthétique fabriquée par yt-dlp** pour Instagram (les reels n'ont pas de
vrai champ « titre »). `_extract_title()` lit `info["title"]` tel quel, d'où le
résultat.

On veut un titre **parlant**, dérivé de la **légende** du reel (`info["description"]`,
le texte écrit par l'auteur — aujourd'hui purement et simplement jeté). Au passage,
on **capture et stocke** la légende complète et la date de publication, elles aussi
jetées actuellement.

### Décisions verrouillées (brainstorming)

- **Source du titre** : la légende (pas d'IA, pas seulement auteur+date).
- **Repli sans légende exploitable** : `@auteur · <date de publication>`.
- **Périmètre de capture** : légende complète + date de publication stockées.
- **Rétroactif** : **non** — nouvelles ingestions uniquement. Pas de backfill,
  pas de re-titrage manuel (les anciens reels ont perdu leur `info` yt-dlp).
- **Approche** : chaîne multi-source robuste (B) avec détection du motif
  synthétique `Video by …`.

### Hors périmètre

- Backfill / re-fetch des reels déjà en bibliothèque.
- Génération de titre par LLM.
- Affichage UI de la légende complète et de la date de **publication** (les
  colonnes sont stockées « pour plus tard » ; le frontend continue d'afficher
  `created_at` comme aujourd'hui dans `PlayerScreen.tsx`). Aucun changement
  `frontend/` requis : le titre amélioré remonte automatiquement via la colonne
  `title` déjà rendue (`VideoCard.tsx:178`, `PlayerScreen.tsx:141`).

## Algorithme de résolution du titre

Fonction pure `_resolve_title(info: dict) -> str`. Chaîne, **dans cet ordre** :

1. **Légende** — première ligne *utile* de `info["description"]`, nettoyée
   (voir ci-dessous). Si une ligne utile existe → c'est le titre.
2. **Vrai titre** — `info["title"]`, s'il est non vide **et n'est pas** le motif
   synthétique `Video by …`. (Cas des sources non-Instagram avec un vrai titre
   mais sans légende exploitable.)
3. **Repli** — `@auteur · <date de publication>` (date omise si inconnue → `@auteur`
   seul).
4. **Dernier recours** — `Sans titre` (constante `DEFAULT_TITLE`, inchangée),
   quand il n'y a ni légende, ni vrai titre, ni auteur.

### « Première ligne utile » + nettoyage

`_clean_caption_line(description: str) -> Optional[str]` :

- Découper `description` en lignes ; parcourir dans l'ordre.
- Retenir la **première ligne** qui, une fois retirés hashtags (`#mot`), emojis et
  espaces, contient encore du **texte alphanumérique**. (Une légende faite
  uniquement de `#hashtags` ou d'emojis → aucune ligne utile → `None` → on tombe
  à l'étape suivante de la chaîne.)
- Sur cette ligne : **retirer le bloc de hashtags en fin** de ligne (ex.
  `Belle recette de pâtes 🍝 #food #pasta` → `Belle recette de pâtes 🍝`),
  **normaliser les espaces** (runs d'espaces → un seul, trim).
- **Tronquer au mot près** à `TITLE_MAX` (80) : couper à la dernière frontière de
  mot ≤ 80, ajouter `…` si la ligne a été coupée.

Nettoyage volontairement **léger** : on ne cherche pas à réécrire la légende, juste
à en extraire une première ligne propre. Les emojis en milieu de phrase sont
conservés.

### Détection du motif synthétique

`_is_synthetic_title(title: str, info: dict) -> bool` : vrai quand `title`
correspond au gabarit de l'extracteur Instagram de yt-dlp `Video by …`
(c.-à-d. `title.strip()` matche `^Video by \S`, ou égale `f"Video by {uploader}"`).
Empêche l'étape 2 de réintroduire exactement le problème qu'on corrige.

### Repli auteur + date

`_fallback_title(info: dict) -> Optional[str]` :

- `author = _extract_author(info)` (réutilise l'existant → `@handle` ou `None`).
- `date = _format_fr_date(published_at)` si date connue.
- Retour : `f"{author} · {date}"`, ou `author` seul si pas de date, ou `None` si
  pas d'auteur (→ la chaîne tombe sur `DEFAULT_TITLE`).

`_format_fr_date` : **sans dépendance de locale** (peu fiable en conteneur). Table
interne des 12 mois français → `"12 mai 2026"`.

## Données capturées & modèle

Nouvelle migration `supabase/migrations/0002_add_caption_published_at.sql` :

```sql
-- Réelgram — légende + date de publication (titres parlants)
alter table public.videos add column if not exists caption      text;
alter table public.videos add column if not exists published_at timestamptz;
```

- `caption` : **légende brute, complète** (`info["description"]` non modifié). Le
  nettoyage ne concerne **que** le titre ; la légende stockée reste fidèle (utile
  pour recherche / affichage futurs). `NULL` si absente.
- `published_at` : `info["timestamp"]` (epoch Unix) en priorité, sinon
  `info["upload_date"]` (`YYYYMMDD`), converti en ISO 8601 UTC. `NULL` si aucun.

Pas de changement RLS (la policy `own videos` couvre toutes les colonnes). Pas de
changement de modèle Pydantic : le contrat d'API (`IngestRequest`/`IngestResponse`/
`IngestStatus`) ne porte pas ces champs, et le frontend lit Supabase en direct.

## Point de modification (flux d'ingestion)

Dans `run_ingest` (`backend/app/ingest.py`, l'`update_video` final actuellement
lignes ~228-239), passer de 4 à 6 champs métier :

```python
supa.update_video(
    video_id,
    {
        "status": "ready",
        "storage_path": rel_video,
        "thumb_path": rel_thumb,
        "title":            _resolve_title(info),        # remplace _extract_title
        "author":           _extract_author(info),       # inchangé
        "duration_seconds": _extract_duration(info),     # inchangé
        "caption":          _extract_caption(info),      # nouveau (brut)
        "published_at":     _extract_published_at(info),  # nouveau (ISO ou None)
        "thumb_color":      color,                        # inchangé
    },
)
```

Helpers (purs, isolés, testables) :

- `_resolve_title(info)` — la chaîne (remplace et **supprime** `_extract_title`).
- `_clean_caption_line(description)` — extraction + nettoyage de la 1re ligne utile.
- `_is_synthetic_title(title, info)` — détection `Video by …`.
- `_fallback_title(info)` — `@auteur · date` / `@auteur` / `None`.
- `_format_fr_date(iso_or_dt)` — date FR sans locale.
- `_extract_caption(info)` — légende brute → `str | None`.
- `_extract_published_at(info)` — `timestamp`/`upload_date` → ISO 8601 `str | None`.

`_extract_author` et `_extract_duration` restent inchangés.

## Erreurs & robustesse

Aucune nouvelle source d'échec. Tous les helpers sont défensifs (`.get`,
`try/except` sur les conversions de date) et renvoient un repli plutôt que de
lever. La garantie existante — `run_ingest` ne propage **jamais** d'exception, le
statut de la row est la source de vérité — est préservée.

## Critères d'acceptation

- Un reel Instagram avec légende `"Recette de pâtes au citron 🍋\n\n#food #pasta"`
  ingéré → `title == "Recette de pâtes au citron 🍋"` (et **plus** `Video by …`).
- La colonne `caption` contient la légende **brute complète** ; `published_at`
  contient la date de publication (quand yt-dlp la fournit).
- Un reel sans légende (ou légende 100 % hashtags/emojis) → `title == "@auteur · <date>"`
  (ou `@auteur` seul si pas de date).
- Une source avec un vrai titre non synthétique et sans légende → ce titre est
  conservé (tronqué à 80).
- Aucune donnée d'entrée ne fait planter l'ingestion (statut `ready` atteint, ou
  `error` propre, jamais d'exception propagée).
- Le titre amélioré apparaît dans la bibliothèque et le lecteur **sans changement
  frontend**.

## Tests (TDD)

Tests unitaires purs (helpers — pas d'I/O) :

- `_resolve_title` : légende normale ; légende + hashtags en fin (hashtags
  retirés) ; légende 100 % hashtags → repli ; légende vide + vrai titre → vrai
  titre ; titre synthétique `Video by x` + pas de légende → `@auteur · date` ;
  ni légende ni titre ni auteur → `Sans titre` ; légende multi-lignes → 1re ligne
  utile ; légende > 80 car. → troncature au mot + `…`.
- `_is_synthetic_title` : `"Video by cool.creator"` → vrai ; `"Ma vraie vidéo"` →
  faux.
- `_extract_caption` : légende présente → brute ; absente/`""` → `None`.
- `_extract_published_at` : `timestamp` epoch → ISO ; `upload_date` `YYYYMMDD` →
  ISO ; aucun → `None`.
- `_format_fr_date` : `2026-05-12` → `"12 mai 2026"`.

Tests d'intégration (`run_ingest`, yt-dlp/ffmpeg/supa mockés, motif existant
`Recorder`) :

- Nouveau happy-path **avec `description`** : vérifie `title` dérivé de la légende
  + `caption` brute stockée + `published_at` rempli.
- Les tests existants de `test_ingest.py` (sans `description`) **restent inchangés
  et verts** : ils tombent sur le « vrai titre » (étape 2) ou `Sans titre`, soit
  exactement le comportement actuel.
