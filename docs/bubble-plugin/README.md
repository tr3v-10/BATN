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
- Additive tenant ownership columns on marketplace data tables. Existing records remain unassigned (NULL) and are not automatically exposed to a new marketplace.
- Operator-protected marketplace provisioning at `POST /api/plugin/v1/marketplaces`.
- Bearer-key authentication and tenant identity lookup at `GET /api/plugin/v1/me`.
- Tenant-scoped users, agents, mandates, negotiations, risk-review queue/review, payments, and transaction-history endpoints under `/api/plugin/v1`.

The original legacy endpoints remain available for the existing demo and are **not** part of the Bubble plugin contract. Bubble must call only `/api/plugin/v1/*`. Do not configure Bubble to call legacy routes such as `/api/agents`, `/api/negotiations`, or `/api/payments`, because those routes are not tenant-scoped.

The Bubble app builder must also enforce its own Bubble privacy rules and workflow permissions before exposing actions such as agent creation, negotiation, or risk review to end users. The API key identifies the marketplace installation; it is not an individual Bubble user's identity.

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

## Version 1 API contract

All plugin routes require `Authorization: Bearer <private JADILI API key>`, except the operator-only marketplace provisioning route.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/plugin/v1/marketplaces` | Provision tenant (operator secret only) |
| GET | `/api/plugin/v1/me` | Validate installation and return marketplace identity |
| POST / GET | `/api/plugin/v1/users` | Create idempotent Bubble user mapping / list marketplace users |
| POST / GET | `/api/plugin/v1/agents` | Create / list buyer and seller agents |
| PUT / GET | `/api/plugin/v1/agents/:agentId/mandate` | Save / retrieve agent mandate |
| POST / GET | `/api/plugin/v1/negotiations` | Start negotiation / list marketplace negotiations |
| GET | `/api/plugin/v1/negotiations/:negotiationId/messages` | Read negotiation message history |
| GET | `/api/plugin/v1/risk/review-queue` | List negotiations awaiting risk review |
| POST | `/api/plugin/v1/negotiations/:negotiationId/risk-review` | Approve/reject a risk review |
| POST | `/api/plugin/v1/negotiations/:negotiationId/owner-approval` | Record the required buyer/seller owner approval |
| POST | `/api/plugin/v1/payments/initiate` | Initiate payment for eligible accepted negotiation |
| GET | `/api/plugin/v1/payments` | List marketplace payments |
| GET | `/api/plugin/v1/payments/:paymentId` | Read payment and event history |
| GET | `/api/plugin/v1/transactions` | List marketplace transaction tracking |

User creation requires `name` and `external_user_id`; the external ID should be Bubble's stable `Current User's unique id`. Agent creation requires `owner_id`, `name`, and `role` (`buyer` or `seller`). Mandate fields mirror the existing JADILI mandate contract. Negotiation creation requires buyer/seller agent IDs, item description, quantity, and initial offer. If a mandate requires owner approval, the Bubble workflow should call the owner-approval endpoint with the Bubble user's external ID; the backend checks that the mapped user owns the relevant buyer or seller agent. Risk review and owner approval can happen in either order.

Payment initiation uses `negotiation_id` and a Kenyan mobile number. It returns a masked phone number and payment status. Keep PayHero credentials on the JADILI backend only.

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
