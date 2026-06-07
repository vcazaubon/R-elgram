# Spec 06 — Flux Import + Raccourci iOS

> Lis `2026-06-07-reelgram-design.md` (§5 contrat d'API). Dépend de Spec 02, 04, 05.
> Écran : `design-reference/project/screens-import.jsx`.

## Objectif
Brancher l'écran **Import** sur l'ingestion réelle du backend (yt-dlp), avec la
progression 4 étapes et l'état d'erreur/retry du design. Livrer la **recette du
Raccourci iOS** qui POST une URL partagée vers `/api/ingest` via le token personnel.

## Tâches

### 1. ImportScreen branché
Adapter `screens-import.jsx` en gardant **tout le visuel** (form, preview chip,
sélecteur de catégorie, médaillon de progression, liste d'étapes, état erreur) :
- **Phase `form`** : champ URL (pré-rempli si l'app reçoit une URL via paramètre,
  cf. §3 ; sinon vide/placeholder), sélecteur de catégorie = catégories réelles
  (Spec 05). Bouton « Sauvegarder la vidéo ».
- **Phase `progress`** : au submit → `api.ingest(url, category_id)` → récupère
  `{id}`. Puis **polling** `api.ingestStatus(id)` (~800 ms) → mappe `status→step`
  (`Design maître §5`) pour animer le médaillon (%) et la liste d'étapes :
  `Analyse du lien → Récupération de la vidéo → Création de la miniature → Vidéo sauvegardée`.
- **Phase `done`** (`status=ready`) : médaillon ✓ + « Vidéo sauvegardée » + bouton
  « Voir dans la bibliothèque » → route library (la nouvelle vidéo apparaît, Spec 05).
- **Phase `error`** (`status=error`) : écran d'erreur du design
  (« Impossible de récupérer cette vidéo » + cause courte issue de `error`) +
  boutons « Réessayer » (retour form) et « Annuler ».
- Calcul du `%` : dériver de `step` (0→25→50→75→100) avec lissage comme le proto.

### 2. (Retiré) simulation
Supprimer la simulation `setTimeout` du proto ; la progression vient désormais du
polling réel. Conserver les transitions/anims visuelles.

### 3. Réception d'une URL entrante (deep link app)
Permettre d'ouvrir l'app directement sur l'import avec une URL pré-remplie :
- Supporter `?import=<url>` (ou `?url=`) au chargement : si présent et session
  active → ouvrir `ImportScreen` en phase form avec l'URL pré-remplie.
- Déclarer un `share_target` dans le manifest (Android/PWA capable) en best-effort
  (`action: '/?import=%s'`, method GET) — **note** : iOS n'implémente pas le Web
  Share Target ; sur iOS c'est le Raccourci (§4) qui gère le partage.

### 4. Recette Raccourci iOS → `docs/ios-shortcut.md`
Guide pas-à-pas (FR) pour créer un Raccourci de **partage** :
1. Dans Réelgram → feuille **Compte** → « Générer un token » → copier le token.
2. App **Raccourcis** iOS → nouveau raccourci → activer « Afficher dans la feuille
   de partage », type d'entrée = URL/Texte.
3. Action **« Obtenir le contenu d'une URL »** :
   - URL : `https://<ton-domaine>/api/ingest`
   - Méthode : `POST`
   - En-têtes : `X-Reelgram-Token: <token>`, `Content-Type: application/json`
   - Corps de la requête : JSON `{ "url": <Entrée du raccourci> }`
     (optionnel `"category_id": "<uuid>"`).
4. (Optionnel) notification de succès/échec selon le code retour.
5. Utilisation : sur Instagram → Partager → Réelgram → la vidéo arrive dans le vault.

Documenter aussi la réponse attendue (`{id, status}`) et les erreurs courantes
(token invalide → 401 ; URL non Instagram → 400 ; cookies manquants → `status=error`).

### 5. Lien depuis l'app
Dans la feuille Compte (Spec 05), ajouter un renvoi visible vers `docs/ios-shortcut.md`
(ou afficher les étapes inline + l'URL exacte `/api/ingest` pré-remplie avec le domaine).

## Critères d'acceptation
- Coller une URL Insta dans l'app → progression 4 étapes réelle → la vidéo
  apparaît dans la bibliothèque et est lisible.
- Une URL invalide/échec → écran d'erreur du design avec « Réessayer ».
- `?import=<url>` ouvre l'app directement sur l'import pré-rempli.
- En suivant `docs/ios-shortcut.md`, partager un Reel depuis iOS ajoute la vidéo
  au bon compte (vérifié via le token perso).
- Rendu pixel-perfect de l'écran Import conservé (médaillon, étapes, erreur).
