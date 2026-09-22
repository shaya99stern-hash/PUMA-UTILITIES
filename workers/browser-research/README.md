# Puma Browser Research Worker

Standalone Node/Playwright enrichment worker for browser-only public directory research.

## Why it is separate

The Next.js/Vercel app does not install Chromium. This worker has its own package and browser binaries so normal Puma deployments stay small.

## ContactOut policy

The adapter reads only publicly visible company-profile names and roles. It does not sign in, click **View**, reveal masked emails or phone numbers, consume contact credits, bypass a paywall, or automate restricted data.

## Run

```bash
cd workers/browser-research
npm install
npm run install:chromium
BROWSER_RESEARCH_TOKEN="use-a-long-random-secret" npm start
```

Expose the worker through HTTPS, then configure the Puma app server with:

- `PUMA_BROWSER_RESEARCH_URL=https://your-worker.example.com/`
- `PUMA_BROWSER_RESEARCH_TOKEN=<same token>`

The worker defaults to port `8787` and exposes `GET /health`.

## Contract

`POST /` accepts `adapter=contactout-public-directory`, company, geography, and maxPeople (1–20). It returns only `people[{name,title,sourceUrl,visibility:"public"}]`.
