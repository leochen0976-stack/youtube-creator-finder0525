# CreatorTrack Deployment Guide

This guide explains how to upload CreatorTrack to GitHub and deploy the public website with Cloudflare Pages.

## 1. Deployment Architecture

CreatorTrack has two parts:

```text
Cloudflare Pages frontend
  -> /api proxy function
  -> Node backend API
  -> YouTube Data API
```

Cloudflare Pages can host the React frontend. The current backend is a Node.js service with local data, cache, exports, and API logic, so it should run on a Node host such as Render, Railway, Fly.io, a VPS, or a private server exposed by Cloudflare Tunnel.

## 2. Do Not Upload Secrets Or Local Data

The project already ignores these files:

```text
.env
.env.*
node_modules/
dist/
backend/data/*.sqlite
backend/data/exports/*
*.log
```

Before uploading to GitHub, confirm that real API keys are only in local `.env` files and never committed.

## 3. Upload To GitHub

Run from the project root:

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master"
git init
git add .
git commit -m "Initial CreatorTrack deployment"
git branch -M main
git remote add origin https://github.com/YOUR_NAME/creatortrack.git
git push -u origin main
```

If Git is not installed, install GitHub Desktop, choose `Add local repository`, select this project folder, then publish it to GitHub.

## 4. Deploy Frontend To Cloudflare Pages

In Cloudflare:

1. Open **Workers & Pages**.
2. Click **Create application**.
3. Choose **Pages**.
4. Connect your GitHub repository.
5. Use these build settings:

```text
Framework preset: Vite
Root directory: frontend
Build command: npm run build
Build output directory: dist
```

Set this environment variable:

```text
VITE_API_BASE_URL=/api
```

The frontend includes a Pages Function at:

```text
frontend/functions/api/[[path]].ts
```

That function proxies browser API requests from `/api/*` to your backend.

## 5. Deploy Backend

The backend must run as a Node service.

Required backend environment variables:

```text
YOUTUBE_API_KEY=your_youtube_api_key
APP_BASE_URL=https://your-cloudflare-pages-domain.pages.dev
DEFAULT_SUB_MIN=3000
DEFAULT_SUB_MAX=50000
DEFAULT_MAX_CANDIDATES=200
DEFAULT_LOOKBACK_DAYS=30
EXPORT_DIR=./data/exports
```

Render provides `PORT` automatically. Do not hard-code it in Render unless you have a specific reason.

Recommended Render backend settings:

```text
Root directory: backend
Build command: npm install && npm run typecheck
Start command: npm start
```

`npm start` runs:

```text
tsx src/server.ts
```

`tsx` is listed under production `dependencies`, so Render can start the TypeScript backend even when dev dependencies are omitted.

## 6. Connect Cloudflare Pages To Backend

After the backend is online, copy its public URL, for example:

```text
https://creatortrack-api.onrender.com
```

In Cloudflare Pages, add this variable:

```text
BACKEND_BASE_URL=https://creatortrack-api.onrender.com
```

Then redeploy the Pages project.

The frontend will call:

```text
https://your-site.pages.dev/api/jobs
```

Cloudflare will proxy it to:

```text
https://creatortrack-api.onrender.com/api/jobs
```

Quick checks:

```text
Backend root:
https://creatortrack-api.onrender.com/

Backend health:
https://creatortrack-api.onrender.com/health

Cloudflare proxied health:
https://your-site.pages.dev/api/health
```

Expected health response:

```json
{"ok":true,"service":"youtube-creator-pipeline-backend"}
```

If the Cloudflare site opens but search does not work, check these first:

```text
Cloudflare Pages variable:
VITE_API_BASE_URL=/api

Cloudflare Pages variable:
BACKEND_BASE_URL=https://creatortrack-api.onrender.com
```

After changing Cloudflare environment variables, redeploy the Pages project. Vite environment variables are embedded at build time.

## 7. Optional: Use Cloudflare Worker API Proxy

This repository also contains a separate Worker proxy:

```text
cloudflare/api-proxy
```

Use it only if you want a standalone API gateway. For most cases, the built-in Pages Function is simpler.

Deploy Worker:

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master\cloudflare\api-proxy"
npm install
npx wrangler login
npx wrangler secret put BACKEND_BASE_URL
npx wrangler deploy
```

Then set frontend:

```text
VITE_API_BASE_URL=https://youtube-finder-api.YOUR_SUBDOMAIN.workers.dev
```

## 8. Local Verification

Frontend:

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master\frontend"
npm run typecheck
npm run build
```

Backend:

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master\backend"
npm run typecheck
npm test
```

Local services:

```powershell
cd "D:\市场部\AI项目\youtube-creator-finder-master"
.\scripts\start-backend-local.ps1
.\scripts\start-frontend-local.ps1
```

Open:

```text
Frontend: http://127.0.0.1:3000
Backend:  http://localhost:3011/health
```
