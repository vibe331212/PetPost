# PetPost

A social app for pets. Live at https://vibe331212.github.io/PetPost/ (GitHub Pages, deploys from `main` about a minute after a push).
Two people code this from two computers, so **pull before starting and push when done**, and keep commits small.

## How it's built
- Plain HTML/CSS/JavaScript modules, no build step and no npm. Open `index.html` through any static server (for example `python3 -m http.server`) to run it.
- `js/app.js`: the whole app. It has a hash router (`#/feed`, `#/profile/<name>`, `#/post/<id>/<from>`, `#/goals`, `#/care`...), views are functions like `viewPost(main, ...)`, and clicks and forms are handled by delegated `data-action` / `data-form` handlers.
- `js/cloud.js`: talks to the online database (Supabase). It mimics a simple store API: `db.get/put/del/all/byIndex`, plus sign-in, follow, report/block and delete account. New post or profile fields must be added to `POST_FIELDS` / `PUBLIC_FIELDS` / `PRIVATE_FIELDS` there, or they won't be saved.
- `js/config.js`: the Supabase URL and the **publishable** key, which is safe to be public. Never put a secret or service_role key in the code.
- Other files: `media.js` (photo resize, video), `camera.js`, `stickers.js`, `petcard.js` (pet card and goal progress images), `celebrate.js` (confetti and trophies), `themes.js` (the 15 modes), `icons.js`, `sounds.js`.
- `sw.js`: service worker so it works as a home-screen app. **Bump `VERSION` every time app files change**, or phones keep the old version. If you add a new JS file, also add it to `SHELL`.
- `supabase/migrations/`: database tables and security rules (RLS: people can only change their own things). Database changes need the password in `supabase/db-password.local.txt`, which is only on the owner's computer and must never be committed.
  - **A new migration file does nothing until it is pushed to the live database** (`supabase db push --linked`), and app code that needs it breaks until then. If you can't push it yourself, tell the person you're working with clearly that "the database needs updating" before pushing the app code.
  - Make changes through migration files, not by hand in the Supabase dashboard, so the history stays right.
- `ios/`: an iPhone app (Xcode, WKWebView) that bundles the web files and adds a native bridge for reminders, the share sheet and haptics. It needs a Mac with Xcode. Version numbers are in the project settings.

## App words and rules
- Likes are **Licks**, comments are **Barks**, named after the pet's sound (Meow for cats, Neigh for horses...), and sharing is **Share**.
- Posts are photos, videos or moments (moments disappear after 24 hours).
- Style: clean and modern, **no emojis** anywhere in the app. Icons are line SVGs from `icons.js`.
- Usernames are cleaned automatically (`cleanUsername`: "Eli the GOAT" becomes `eli_the_goat`).
- Only your own pet card can be shared.

## Careful
- The database is live, with real users. Don't delete accounts or posts unless the owner asks.
- Test accounts must start with `pptest_` and be deleted afterwards.
- If you ever add sample or AI accounts, give them `ai: true` in their profile so the app tags them as AI. Never make them look like real people.
- Keep explanations simple and friendly. The people working on this are new to coding.
