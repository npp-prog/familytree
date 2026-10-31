# 🌳 Family Tree

A family tree web app that uses **Firebase** (Auth + Firestore) and is hosted on **Netlify**.

- Sign in with a **social media account** (Google, Facebook, X/Twitter, GitHub).
- Only signed-in users can **add family members**, each with a name, email and social media accounts
  (Facebook, Instagram, X, TikTok, LinkedIn), linked as parent, child, spouse or sibling.
- People you add **don't need an account**. If they later sign in with a social account that uses the
  **same email**, the tree they belong to shows up in their sidebar (read-only).
- Every signed-in user also gets their own tree to build.

No build step: plain HTML/CSS/JS modules in `public/`, with Firebase loaded from Google's CDN.

## Project layout

```
public/                  <- Netlify publishes this folder
  index.html
  css/styles.css
  js/app.js              <- auth, Firestore reads/writes, UI
  js/tree.js             <- tree layout + rendering (pure, unit-tested)
  js/firebase-config.js  <- Firebase web config + which sign-in buttons to show
firestore.rules          <- security rules (who can read/write what)
firebase.json, .firebaserc, firestore.indexes.json
netlify.toml
tests/tree.test.mjs
```

## Data model (Firestore)

```
trees/{ownerUid}                         one tree per user
  ownerUid, ownerName, memberEmails[]    <- lower-case emails of everyone in the tree
trees/{ownerUid}/people/{personId}
  name, email, socials{facebook,instagram,x,tiktok,linkedin}, parentIds[], spouseIds[], isOwner
```

Rules: only the owner can write their tree; anyone whose sign-in email is in `memberEmails` can read it.

## Setup

### 1. Firebase (project `familytree-f0410`)

1. **Firestore**: Firebase console → Build → Firestore Database → *Create database* (production mode).
2. **Security rules**: deploy `firestore.rules`. Either paste it into Firestore → Rules → *Publish*, or run:
   ```bash
   npm install -g firebase-tools
   firebase login
   firebase deploy --only firestore:rules
   ```
3. **Sign-in providers**: Authentication → Sign-in method → enable the ones you want:
   - **Google**: just enable it.
   - **Facebook**: create an app at developers.facebook.com, paste the App ID/secret into Firebase, and add the
     OAuth redirect URI Firebase shows (`https://familytree-f0410.firebaseapp.com/__/auth/handler`) to the Facebook app.
   - **X (Twitter)** / **GitHub**: same idea. Get an API key/secret from their developer portal and add the redirect URI.
   - To hide a provider you haven't set up, remove it from `enabledProviders` in `public/js/firebase-config.js`.
4. **Authorized domains**: Authentication → Settings → Authorized domains → add your Netlify domain
   (e.g. `your-site.netlify.app` and any custom domain). Sign-in won't work on that domain until you do this.
5. Recommended: Authentication → Settings → *User account linking* → "Link accounts that use the same email",
   so the same person can sign in with different providers.

### 2. Netlify

1. Netlify → *Add new site* → *Import an existing project* → pick this GitHub repo.
2. Build command: *(leave empty)*. Publish directory: `public` (already set in `netlify.toml`).
3. Deploy, then add the resulting `*.netlify.app` domain to Firebase authorized domains (step 1.4).

## Local development

```bash
npm start   # serves public/ on http://localhost:5173 (localhost is authorized in Firebase by default)
npm test    # tree layout / social link tests
```

## Notes

- Matching uses the email the social provider returns. Some X/GitHub accounts don't share an email.
  Those users can still build their own tree, but they can't be matched to trees other people made for them.
- The Firebase web `apiKey` in `firebase-config.js` is public by design; the data is protected by `firestore.rules`.
