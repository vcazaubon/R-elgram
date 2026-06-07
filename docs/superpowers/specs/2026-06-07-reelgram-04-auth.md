# Spec 04 — Auth (email/mot de passe + Face ID WebAuthn)

> Lis `2026-06-07-reelgram-design.md` (§2 décisions auth). Dépend de Spec 01, 03.
> Écran de référence : `design-reference/project/screens-login.jsx`.

## Objectif
Brancher l'authentification **email + mot de passe** via Supabase Auth, ajouter
une couche **Face ID** (WebAuthn / authentificateur de plateforme) comme verrou
biométrique par-dessus la session de la PWA installée, et poser le **route guard**
+ l'isolation multi-user.

## Tâches

### 1. Client Supabase → `frontend/src/lib/supabase.ts`
`createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } })`.

### 2. Auth context → `frontend/src/lib/auth.tsx`
- `AuthProvider` : expose `session`, `user`, `loading`,
  `signIn(email, pwd)`, `signUp(email, pwd)`, `signOut()`.
- `onAuthStateChange` pour réagir aux changements de session.
- `getAccessToken()` : renvoie le JWT courant (utilisé par l'api client en Spec 05/06).

### 3. LoginScreen branché
Adapter `screens-login.jsx` en gardant **tout le visuel premium** (brand, glow,
dégradé, micro-anim) mais en remplaçant le contenu des actions :
- Mode `email` = formulaire **email + mot de passe** + toggle
  « Créer un compte / Se connecter » (state `signup|signin`).
  - `signin` → `signIn` ; `signup` → `signUp` (masqué si `config.ALLOW_SIGNUPS === false`).
  - États : loading (spinner du proto), erreur (message court sous le champ, ton
    rouge `#ff8a96`), succès → `onEnter`.
- Le bouton **« Déverrouiller avec Face ID »** :
  - visible **uniquement** si une credential WebAuthn est déjà enrôlée pour cet
    appareil (cf. §4) **et** qu'une session Supabase persistée existe.
  - sinon, garder le bouton primaire = soumission email/mdp.
- Le bouton **« Continuer avec Apple »** : masqué en V1 (extension future).
- Microcopy conservée : « Ton vault privé de Reels… », « Aucun compte public… ».

### 4. Couche Face ID (WebAuthn) → `frontend/src/lib/biometric.ts`
Verrou biométrique **local** par-dessus la session (pas un provider Supabase) :
- **Enrôlement** (proposé après la 1ʳᵉ connexion réussie, ou via la feuille Compte
  en Spec 05) : `navigator.credentials.create()` avec
  `authenticatorAttachment: 'platform'`, `userVerification: 'required'`. Stocker
  le `credentialId` (base64) dans `localStorage` (lié à l'email/user). Pas de
  serveur requis : on ne vérifie pas une assertion côté backend ; le but est de
  **gater l'accès local** à une session déjà valide.
- **Déverrouillage** : `navigator.credentials.get()` avec le `credentialId` stocké
  et `userVerification: 'required'`. Succès → on lève le verrou et on entre
  (`onEnter`). Échec/annulation → rester sur le verrou, proposer fallback mot de passe.
- **Détection** : `window.PublicKeyCredential &&
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()` pour savoir
  si Face ID est dispo (sinon, cacher l'option proprement).
- **Garde-fou** : si WebAuthn indisponible (navigateur non supporté), l'app
  fonctionne en email/mdp pur, sans dégradation.

### 5. Route guard → `frontend/src/App.tsx`
- Au boot : si pas de session → `route='login'` (mode email).
- Si session présente **et** Face ID enrôlé → `route='login'` en mode **verrou
  Face ID** (l'app est « verrouillée » jusqu'au déverrouillage biométrique).
- Si session présente **et** pas de Face ID enrôlé → entrer directement
  (`route='library'`).
- `signOut()` → retour login + purge de l'état.
- Le `LoginScreen` reste la seule route accessible tant que non authentifié/déverrouillé.

### 6. Isolation
Rien à coder de plus côté front (RLS fait le travail), mais **vérifier** que
toutes les requêtes Supabase (Spec 05) passent la session courante — supabase-js
attache le JWT automatiquement. Documenter : le backend (Spec 02) applique aussi
`user_id` côté serveur.

## Critères d'acceptation
- Inscription d'un nouvel email/mdp → compte créé → 6 catégories par défaut
  présentes (trigger Spec 01) → entrée dans la bibliothèque (vide).
- Connexion d'un compte existant → bibliothèque de **ce** compte uniquement.
- Deux comptes différents ne voient jamais les données l'un de l'autre.
- Sur appareil compatible : après 1ʳᵉ connexion, enrôlement Face ID proposé ; à la
  réouverture de l'app installée, l'app est verrouillée et se déverrouille via
  Face ID ; fallback mot de passe disponible.
- Sur appareil/navigateur sans WebAuthn : flux email/mdp pur, aucune erreur.
- `signOut` ramène au login et efface la session.
- Visuel du LoginScreen toujours pixel-perfect vs mockup.

## Notes
- WebAuthn exige **HTTPS** (ou localhost) et l'app **installée** pour Face ID sur
  iOS — cohérent avec le déploiement Coolify (TLS) et l'install PWA.
- Si `ALLOW_SIGNUPS=false`, masquer le toggle d'inscription **et** désactiver les
  signups dans le dashboard Supabase (Authentication → Providers → Email).
