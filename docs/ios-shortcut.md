# Raccourci iOS — Partager un Reel vers Réelgram

Ce guide explique comment créer un **Raccourci de partage** sur iPhone/iPad pour
envoyer une vidéo Instagram directement dans ton vault Réelgram, en un appui
depuis la feuille de partage d'Instagram.

> iOS n'implémente pas le **Web Share Target** des PWA : c'est ce Raccourci qui
> joue le rôle du partage natif. Sur Android, le partage vers la PWA installée
> fonctionne directement (rien à configurer).

---

## 1. Générer un token personnel

Le Raccourci s'authentifie avec un **token personnel** (et non ton mot de passe).

1. Ouvre Réelgram → bouton **Compte** (en-tête de la bibliothèque).
2. Section **Raccourci iOS** → **Générer un token**.
3. **Copie le token immédiatement** : il n'est affiché **qu'une seule fois**.
   (Tu peux toujours en générer un nouveau et révoquer l'ancien plus tard.)
4. Note aussi l'**URL de l'API** affichée juste en dessous, du type :

   ```
   https://<ton-domaine>/api/ingest
   ```

   C'est l'adresse que le Raccourci va appeler.

---

## 2. Créer le Raccourci

1. Ouvre l'app **Raccourcis** d'iOS → **+** (nouveau raccourci).
2. Touche le titre → **Renommer** en `Réelgram` (le nom apparaîtra dans la
   feuille de partage).
3. Touche l'icône **ⓘ** (Détails du raccourci) :
   - Active **« Afficher dans la feuille de partage »**.
   - Sous **Types d'entrée acceptés**, ne garde que **URL** (et éventuellement
     **Texte**) ; décoche le reste.

---

## 3. Ajouter l'action « Obtenir le contenu d'une URL »

Ajoute une action **« Obtenir le contenu d'une URL »** et configure-la ainsi :

| Champ | Valeur |
|-------|--------|
| **URL** | `https://<ton-domaine>/api/ingest` |
| **Méthode** | `POST` |
| **En-têtes** | `X-Reelgram-Token` : `<ton-token>` |
|             | `Content-Type` : `application/json` |
| **Corps de la requête** | `JSON` |

Dans le corps **JSON**, ajoute les champs suivants :

| Clé | Type | Valeur |
|-----|------|--------|
| `url` | Texte | l'**Entrée du raccourci** (variable « Entrée du raccourci ») |
| `category_id` | Texte | *(facultatif, déconseillé — voir note ci-dessous)* |

Concrètement, le corps envoyé ressemble à :

```json
{
  "url": "https://www.instagram.com/reel/C8xQ2pLm3aZ/"
}
```

> Le champ `category_id` est **facultatif** et **déconseillé ici** : l'app
> n'expose pas l'UUID des catégories, donc laisse-le de côté. Sans lui, la vidéo
> arrive **sans catégorie** et tu la ranges en deux secondes depuis l'app.

---

## 4. (Optionnel) Notification de résultat

Après l'action réseau, tu peux ajouter une action **« Afficher une
notification »** pour confirmer l'envoi. La réponse de l'API est un JSON :

```json
{ "id": "…", "status": "analyzing" }
```

- `status` vaut `analyzing` juste après l'envoi : l'ingestion se poursuit en
  arrière-plan côté serveur (téléchargement + miniature). Tu n'as pas besoin
  d'attendre dans le Raccourci.
- La progression complète (`analyzing → fetching → thumbnailing → ready`) est
  visible dans l'app, sur l'écran d'import et dans la bibliothèque.

---

## 5. Utilisation

1. Sur **Instagram**, ouvre le Reel → bouton **Partager** → **icône Partager**
   (feuille de partage iOS).
2. Choisis **Réelgram** dans la liste des raccourcis.
3. La vidéo est mise en file : elle apparaît dans ta bibliothèque Réelgram et
   devient lisible une fois l'ingestion terminée.

---

## Réponses & erreurs courantes

| Cas | Code / état | Que faire |
|-----|-------------|-----------|
| Succès | `201` + `{ id, status }` | Rien — la vidéo s'ingère en arrière-plan. |
| Token invalide / manquant | `401` | Regénère un token dans **Compte** et mets-le à jour dans l'en-tête `X-Reelgram-Token`. |
| URL non Instagram / invalide | `400` | Vérifie que l'entrée partagée est bien un lien Instagram (Reel/post vidéo). |
| Échec de récupération (cookies manquants, contenu privé/expiré) | la vidéo finit en `status: "error"` | Le lien est peut-être privé/expiré ; côté serveur, vérifie la configuration des cookies Instagram (yt-dlp). Réessaie depuis l'app. |

> **Sécurité** : le token donne accès à ton compte via `/api/ingest`. Si tu
> penses qu'il a fuité, révoque-le dans **Compte → Raccourci iOS** et génères-en
> un nouveau.
