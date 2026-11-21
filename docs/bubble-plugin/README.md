# JADILI Bubble Marketplace Plugin

JADILI is being adapted as a Bubble plugin backed by the existing Node/Express API. Bubble's plugin editor remains the publishing surface; this repository contains the backend contract, migrations, and implementation notes.

## Architecture

- Bubble plugin server-side actions call the JADILI API.
- Each Bubble installation is provisioned as an isolated marketplace tenant.
- Each marketplace receives a dedicated API key.
- The API key is stored only in Bubble plugin **Private** settings and used only by server-side actions. Never expose it in a page element, client-side action, URL, browser storage, or workflow output.
- PayHero credentials remain exclusively in the JADILI backend environment.

## Current implementation stage

The backend currently provides:
- Marketplace tenant and hashed API-key tables.
- Operator-protected marketplace provisioning at `POST /api/plugin/v1/marketplaces`.
- Bearer-key authentication and tenant identity lookup at `GET /api/plugin/v1/me`.

The existing legacy agents, mandates, negotiations, risk, transaction, and payment routes are **not yet tenant-scoped**. Do not expose or call those routes from the public Bubble plugin until the tenant-scoping migration and authorization checks are complete. This deliberate boundary prevents cross-marketplace data exposure.

## Backend configuration

Set a strong random `JADILI_PROVISIONING_KEY` in the backend environment. This is an operator-only secret used to create marketplace tenants. Do not put it in Bubble.

Provision a marketplace from a trusted operator environment:

```sh
curl -X POST "$JADILI_API_URL/api/plugin/v1/marketplaces" \
  -H "Content-Type: application/json" \
  -H "x-jadili-provisioning-key: $JADILI_PROVISIONING_KEY" \
  -d '{"name":"Example Bubble Marketplace"}'
```

The response contains the marketplace ID and a one-time `jad_live_...` API key. Store the key in Bubble plugin Private settings. The database stores only its SHA-256 hash.

Validate a key:

```sh
curl "$JADILI_API_URL/api/plugin/v1/me" \
  -H "Authorization: Bearer jad_live_REDACTED"
```

## Bubble plugin editor plan

Create a plugin named **JADILI Marketplace**.

Private plugin setting:
- `JADILI API Base URL` (text; default to the deployed API URL)
- `JADILI API Key` (text; mark **Private**)

Initial server-side action:
- `Validate Marketplace Connection`
  - Calls `GET /api/plugin/v1/me`
  - Sends `Authorization: Bearer [private API key]`
  - Returns marketplace ID, marketplace name, and API version.
  - Treats non-2xx responses as errors.

Do not add negotiation/payment actions until the backend tenant-scoping work is complete and tested.

## Next backend milestones

1. Add `marketplace_id` ownership to every marketplace-owned record and migrate existing legacy records safely.
2. Enforce tenant scoping in every create, read, update, review, retry, and payment callback lookup.
3. Add tenant-scoped API endpoints for users/agents, mandates, negotiations, risk review, transaction history, and payments.
4. Add Bubble server-side actions and event-driven payment status handling.
5. Test two separate marketplace API keys against each other's resources; all cross-tenant reads and writes must fail.
