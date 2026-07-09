# Deploy Harbor (hosted shareable demo)

This guide puts the **simulated** Harbor demo on a public URL. Fake money only — visitors can try the donor page and dashboard without installing anything.

## Prerequisites

1. A free [GitHub](https://github.com) account (the code is already in a repo once you push).
2. A free [Render](https://render.com) account (sign up with GitHub is easiest).

## Option A — Render Blueprint (recommended)

1. Push this repository to GitHub (if it is not already public/private on your account).
2. Open [https://dashboard.render.com](https://dashboard.render.com) and sign in.
3. Click **New** → **Blueprint**.
4. Connect the Harbor GitHub repository when prompted.
5. Render reads [`render.yaml`](./render.yaml) and proposes a web service named `harbor-demo`.
6. Click **Apply** / **Deploy**.
7. Wait for the build to finish (a few minutes on the free tier). Open the service URL Render assigns (something like `https://harbor-demo.onrender.com`).

You should see:

- A yellow banner: **Simulated network — not real bitcoin**
- `/donate` — amount routing + QR
- `/dashboard` — ledger + **Reset demo**

Free-tier services may sleep after idle time; the first request after sleep can take ~30–60 seconds.

## Option B — Render “New Web Service” (manual)

1. **New** → **Web Service** → select the Harbor repo.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `npm ci && npm run build`
   - **Start command:** `npm start`
   - **Instance type:** Free
3. Environment variables (or rely on `npm start`, which sets most of these):

   | Key | Value |
   |-----|--------|
   | `NODE_VERSION` | `22` |
   | `NODE_ENV` | `production` |
   | `HARBOR_HOSTED` | `1` |
   | `HARBOR_BITCOIN` | `mock` |
   | `HARBOR_SERVE_WEB` | `1` |
   | `HARBOR_DB_PATH` | `/tmp/harbor/harbor.db` |

4. Deploy and open the public URL.

## Option C — Docker (any host)

```bash
docker build -t harbor-demo .
docker run --rm -p 3001:3001 harbor-demo
```

Then open http://localhost:3001/donate

## Local production smoke test

```bash
npm ci
npm run build
npm start
```

Open http://127.0.0.1:3001/donate (single process — no Vite).

## What this demo is / is not

| Is | Is not |
|----|--------|
| Shareable UI for the donation flow | Real bitcoin or Lightning |
| Mock chain + simulate / reset | Persistent multi-tenant production |
| Watch-only ledger UX preview | Hardware wallet or signing |

## Troubleshooting

- **Build fails on Node version:** set `NODE_VERSION=22` (Render) or use the Dockerfile (Node 22).
- **Blank page / 404 on `/donate`:** ensure `HARBOR_SERVE_WEB=1` and `web/dist` was built (`npm run build`).
- **API works but UI does not:** confirm the start command is `npm start` from the repo root, not `npm run start -w server` alone without a built `web/dist`.
