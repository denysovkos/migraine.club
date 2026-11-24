# syntax=docker/dockerfile:1
#
# Production image: the Go server and the Vite build of the frontend.
#
# NEXT_PUBLIC_* values are inlined into the frontend bundle at build time (as
# Next did), so they are build arguments; Render passes service environment
# variables of the same name to the build. Everything else is read by the
# server at runtime.

FROM node:26-bookworm-slim AS web
WORKDIR /src
# The workspace manifests first, so the install layer is cached until a
# dependency changes.
COPY package.json package-lock.json .npmrc ./
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
COPY apps/e2e/package.json apps/e2e/
COPY packages/db/package.json packages/db/
COPY packages/locales/package.json packages/locales/
RUN HUSKY=0 npm ci --ignore-scripts
COPY . .
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_VAPID_PUBLIC_KEY
ARG NEXT_PUBLIC_SENTRY_DSN
ARG NEXT_PUBLIC_E2E_MOCK_AUTH
ARG E2E_MOCK_AUTH
RUN npm run build -w @migraine/client

FROM golang:1.27.4-bookworm AS server
WORKDIR /src/apps/server
# The locale messages are a Go module of their own (a replace in go.mod).
COPY packages/locales /src/packages/locales
COPY apps/server/go.mod apps/server/go.sum ./
RUN go mod download
COPY apps/server/cmd ./cmd
COPY apps/server/internal ./internal
COPY apps/server/migrations ./migrations
COPY apps/server/content ./content
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# Runs as root, like the Node service did: Render's persistent disk
# (FILES_STORAGE_PATH, doctor verification uploads) is owned by root, and so
# are the files already on it.
FROM gcr.io/distroless/static-debian12
WORKDIR /app
COPY --from=server /out/server /app/server
COPY --from=web /src/apps/client/dist /app/web
ENV SPA_DIST=/app/web PORT=3000
EXPOSE 3000
ENTRYPOINT ["/app/server"]
