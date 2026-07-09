# Deploy Harbor (hosted shareable demo)

This guide puts the **simulated** Harbor demo on a public URL. Fake money only — visitors can try the donor page and dashboard without installing anything.

**Repository:** [https://github.com/GoldmanSats/harbor-demo](https://github.com/GoldmanSats/harbor-demo)

## Prerequisites

1. Access to the GitHub repo above (already pushed).
2. A free [Render](https://render.com) account (sign up with GitHub is easiest).

## Option A — Render Blueprint (recommended)

1. Open [https://dashboard.render.com](https://dashboard.render.com) and sign in with GitHub.
2. Click **New** → **Blueprint**.
3. Select the **GoldmanSats/harbor-demo** repository when prompted (authorize Render if asked).
4. Render reads [`render.yaml`](./render.yaml) and proposes a web service named `harbor-demo`.
5. Click **Apply** / **Deploy**.
6. Wait for the build to finish (a few minutes on the free tier). Open the service URL Render assigns (something like `https://harbor-demo.onrender.com`).

You should see:

- A yellow banner: **Simulated network — not real bitcoin**
- `/donate` — amount routing + QR
- `/dashboard` — ledger + **Reset demo**

Free-tier services may sleep after idle time; the first request after sleep can take ~30–60 seconds.

## Option B — Render “New Web Service” (manual)

1. **New** → **Web Service** → select **GoldmanSats/harbor-demo**.
2. Settings:
   - **Runtime:** Node
   - **Build command:** `npm ci --include=dev && npm run build`
   - **Start command:** `npm start`
   - **Instance type:** Free
3. Environment variables:

   | Key | Value |
   |-----|--------|
   | `NODE_VERSION` | `22` |
   | `NODE_ENV` | `production` |
   | `HARBOR_HOSTED` | `1` |
   | `HARBOR_BITCOIN` | `mock` |
   | `HARBOR_SERVE_WEB` | `1` |
   | `HARBOR_DB_PATH` | `/tmp/harbor/harbor.db` |

   Important: if you set `NODE_ENV=production` as a service env var, the **build**
   command must use `npm ci --include=dev` (otherwise TypeScript/Vite are skipped
   and the build fails).

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
npm run start:local
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
