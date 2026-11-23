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
COPY package.json package-lock.json .npmrc ./
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
RUN npm run build:spa

FROM golang:1.27.4-bookworm AS server
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY migrations ./migrations
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
WORKDIR /app
COPY --from=server /out/server /app/server
COPY --from=web /src/web/dist /app/web
ENV SPA_DIST=/app/web PORT=3000
EXPOSE 3000
ENTRYPOINT ["/app/server"]
