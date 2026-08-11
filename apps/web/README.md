# Crowd Flow Optimiser — Web

Next.js App Router UI for setup → graph review → live simulation report.

## Setup

```bash
cd apps/web
npm install
copy .env.example .env.local
```

Run API on port 8000 (mock modes are fine), then:

```bash
npm run dev
```

Open http://localhost:3000

## Flow

1. Upload a layout or pick **Try this layout** (banquet / concert)
2. Set crowd + structured schedule → **Run simulation**
3. Review overlay (chat revise + drag/rename/delete) → **Confirm & continue**
4. Watch hotspots on the left; findings report fills on the right when the run ends

HTTP API calls are proxied via Next rewrites to `API_ORIGIN`. WebSockets connect to the API host directly (`NEXT_PUBLIC_API_WS`).
