# MCP Server

Lets a user connect an external AI client (Claude, ChatGPT, …) to their own
migraine.club account, to read their history and log new entries on their
behalf.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /api/mcp` | The MCP server itself, streamable HTTP transport |
| `GET /.well-known/oauth-protected-resource/mcp` | RFC 9728 resource metadata |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata, for older clients |

## Auth

Clerk is the OAuth 2.1 authorization server. We issue nothing and store no
tokens — Clerk mints the access and refresh tokens, and the MCP client holds
them.

Connect flow:

1. The client calls `/api/mcp`, gets `401` with a `WWW-Authenticate` header
   pointing at the resource metadata.
2. It reads the resource metadata and discovers Clerk.
3. It registers itself (DCR), then runs authorization code + PKCE.
4. The user approves on Clerk's consent screen.

### Required Clerk Dashboard configuration

The endpoints are inert until this is done, in
**OAuth applications → Settings → Client onboarding**:

- **Publish DCR support**: on. Claude connectors need Dynamic Client
  Registration today. CIMD is preferable on security grounds — it avoids a
  public unauthenticated client-registration endpoint — but is in beta and
  needs Clerk support to enable it for the account.
- **Default scopes for dynamic clients**: `openid profile migraine:read`.

  Claude omits `scope` when it connects, so these defaults decide what a new
  connection gets. `migraine:write` is deliberately **not** a default: a client
  must ask for it explicitly, so a default connection cannot write.

Enabling DCR makes the consent screen mandatory, which is the consent surface
this feature relies on — there is no separate in-app connection UI in v1.

## Scopes

| Scope | Grants |
|---|---|
| `migraine:read` | All read tools |
| `migraine:write` | `log_attack`, `update_attack`, `log_medication_dose`, `update_diary_day`, `log_factor` |

A tool whose scope is missing returns `INSUFFICIENT_SCOPE` rather than failing
the request, so the model can explain the problem to the user.

## Tools

Read: `get_user_context`, `list_attacks`, `list_medication_doses`, `get_diary`,
`get_insights`, `get_moh_status`, `get_clinician_report`,
`list_appointment_preps`, `get_appointment_prep`.

Write: `log_attack`, `update_attack`, `log_medication_dose`,
`update_diary_day`, `log_factor`.

There are no delete tools, by design. Corrections go through the update tools;
deletion stays in the app UI.

## Architecture

Tools live in `apps/server/internal/mcp` (`tools.go`, `tooldefs.go`) and are
pure translation: schema in, text plus JSON out. They never touch the
database or the auth layer. All behaviour lives in
`apps/server/internal/service`, which the REST handlers call too, so an attack logged
through Claude goes through the same invariants as one logged in the app —
the one-ongoing-attack rule, the diary day recompute, the insights cache
invalidation, and MOH dose counting.

`runTool` in `apps/server/internal/mcp/tools.go` wraps every tool with scope
enforcement, audit and error mapping.

### Dose routing

`log_medication_dose` resolves a free-text name to one of the user's
medications, creating it if new, then branches on `isAcute`. Acute medications
are written as `acute_doses` so they count toward medication-overuse
thresholds; anything else becomes a `medication_intakes` row. New custom
medications default to acute, so an unrecognised name is counted rather than
silently excluded.

### Routing

`/api/mcp` is mounted in `apps/server/internal/api/mcpapi`. It authenticates
the OAuth access token itself instead of the app's session cookie, and the
`.well-known` discovery URLs are served outside the locale routing
(`apps/server/internal/mcp/wellknown.go`).

## Audit

Every tool call writes one row to `mcp_tool_call_audit`: user, tool, client id,
outcome, error code, duration. No arguments or payloads, so the table holds no
health data. Writes are best-effort and never fail the tool. There is no UI for
it yet.
