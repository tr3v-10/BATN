# BATN / Jadili frontend

The active frontend is the Jadili workspace UI integrated with the existing BATN Express API.

## Run locally

1. Start the backend from the repository root:
   `cd backend && npm install && npm run dev`
2. In another terminal, configure and start the frontend:
   `cd frontend && cp .env.example .env && npm ci && npm run dev`
3. The default API origin is `http://localhost:5000`. Set `VITE_API_BASE_URL` in `.env` if your backend runs elsewhere. Set the origin only; the app appends `/api`.

## Connected backend features

- Health and dashboard statistics: `GET /api/status`, `GET /api/dashboard`
- Owner and agent management: `GET/POST /api/users`, `GET/POST /api/agents`, `PATCH /api/agents/:id/status`
- Agent mandates: `GET /api/mandates`, `PUT /api/mandates/:agentId`
- Negotiations: `GET/POST /api/negotiations`
- Risk review queue: `GET /api/risk/review-queue`, `POST /api/risk/:negotiationId/review`
- Mock payments: `GET /api/payments`, `PATCH /api/payments/:id/status`
- Audit and transaction tracking: `GET /api/audit`, `GET /api/transactions`

## Explicit prototype limitations

Authentication, login/signup, user sessions, role-based authorization, team invitations, notifications, live M-Pesa/bank payments and mandate-based approval decisions are not currently exposed by the backend. The UI labels these limitations rather than presenting them as working functionality. Payment status advancement is only for the backend's `mock` provider.

## Checks

Run `npm run build` before merging. The repository's original frontend is preserved in `../frontend-legacy/` on the integration branch.
