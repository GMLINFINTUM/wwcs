# WWCS — Washington Weather and Climate Services (Standalone)

A community weather website for Washington State: live weather desk, ZIP-code
forecasts, spotter registration, spotter observations, weather blog, and a
moderated live chat. Built to deploy free on [Render](https://render.com).

**Stack:** Node.js + Express backend, vanilla HTML/CSS/JS frontend, PostgreSQL.
**Live weather sources (all free, no API keys):** National Weather Service
(api.weather.gov), Open-Meteo forecasts, Zippopotam ZIP lookup, RainViewer radar.

---

## Deploying to Render (step by step)

You only do this once. It takes about 15 minutes.

### 1. Create a GitHub account
1. Go to https://github.com and sign up (free).
2. Create a **new repository** (click `+` → *New repository*), name it `wwcs`,
   leave it Public, and click *Create repository*.

### 2. Put this code on GitHub
On your computer, in a terminal inside the `wwcs-standalone` folder:

```bash
git init
git add .
git commit -m "WWCS standalone app"
git branch -M main
git remote add origin https://github.com/YOUR-GITHUB-USERNAME/wwcs.git
git push -u origin main
```

(Replace `YOUR-GITHUB-USERNAME` with your GitHub username. GitHub will ask
you to sign in — use your new account.)

### 3. Create a Render account
1. Go to https://dashboard.render.com and sign up — choose **Sign up with GitHub**
   so it connects to your GitHub account automatically.

### 4. Deploy with the blueprint
1. In the Render dashboard, click **New +** → **Blueprint**.
2. Choose your `wwcs` repository and click **Connect**.
3. Render reads `render.yaml` in this repo and shows two things it will create:
   - a **Web Service** (the site itself, free plan)
   - a **PostgreSQL database** (free plan)
4. Click **Apply**. Render will install dependencies, create the database tables
   automatically (`npm run migrate` runs during the build), and start the site.
5. Wait a few minutes. When the web service shows **Live**, click its URL
   (something like `https://wwcs.onrender.com`) — your site is up!

> **Note:** on Render's free plan the site sleeps after ~15 minutes of no
> traffic and takes ~30–60 seconds to wake up on the next visit. That's normal.

### 5. (Optional) Point a custom domain at it
If you later buy a domain (about $10–15/year from e.g. Cloudflare or Porkbun):
Render dashboard → your web service → **Settings** → **Custom Domains** →
*Add Custom Domain* and follow the DNS instructions.

---

## Running it on your own computer

Requires Node.js 20+.

```bash
npm install
npm start        # site at http://localhost:3000 (works without a database)
```

To enable sign-ups, observations, blog, and chat locally, point it at any
PostgreSQL database:

```bash
export DATABASE_URL="postgres://user:password@localhost:5432/wwcs"
npm run migrate  # creates the tables
npm start
```

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | On Render (auto-set by `render.yaml`) | PostgreSQL connection string. Without it, pages still render but accounts/observations/blog/chat return a friendly "not configured" message. |
| `PORT` | No (Render sets it) | Port the server listens on. Defaults to 3000. |
| `MODERATION_API_URL` | No | Optional second-layer AI moderation endpoint for chat (see below). |
| `MODERATION_API_KEY` | No | Bearer token sent to `MODERATION_API_URL`. |

### Plugging in LLM chat moderation later

Chat already has a built-in filter (blocklist incl. leetspeak normalization,
500-char limit, 6-messages-per-minute rate limit, duplicate detection — see
`moderation.js`). To add an LLM layer:

1. Create a small HTTP endpoint (e.g. an OpenAI-compatible moderation call or
   your own function) that accepts `POST { "text": "..." }` and returns
   `{ "flagged": true/false, "reason": "..." }`.
2. Set `MODERATION_API_URL` and `MODERATION_API_KEY` in Render
   (dashboard → web service → **Environment**).
3. No code changes needed — `moderation.js` calls it automatically when both
   are set. If the endpoint is down or misconfigured, the built-in filter
   still applies (it fails open, never fails closed).

## Project layout

```
wwcs-standalone/
├── server.js          # Express app: static hosting + community API
├── moderation.js      # Chat content filter + optional LLM hook
├── migrate.js         # Runs schema.sql (npm run migrate)
├── schema.sql         # Postgres tables: spotters, sessions, observations, blog_posts, chat_messages
├── render.yaml        # Render blueprint: free web service + free Postgres
├── package.json       # deps: express, pg, bcryptjs
└── public/            # Frontend (vanilla JS)
    ├── index.html     # Homepage: live desk, headlines, alerts, ZIP forecast, radar
    ├── spotter.html    # Spotter registration + sign-in
    ├── spotters.html   # Spotter Center directory
    ├── observations.html # Observation feed + submit form
    ├── blog.html       # Blog feed + publishing flow
    ├── chat.html       # Live chat (polls /api/chat)
    ├── auth.js         # Shared API/auth helpers
    ├── styles.css
    ├── logo.webp       # WWCS full logo
    └── icon.webp       # WWCS compact mark (also the favicon)
```
