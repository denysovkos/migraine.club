# Go server tasks. The frontend keeps using npm scripts.
GOTOOLCHAIN ?= go1.27.4
export GOTOOLCHAIN
SQLC_VERSION := v1.31.1
GOLANGCI_VERSION := v2.15.0
GOBIN := $(shell go env GOPATH)/bin

.PHONY: gen schema sqlc test lint build check-gen

## gen: regenerate the schema snapshot and the sqlc query layer
gen: schema sqlc

schema:
	go run ./cmd/schemagen

sqlc:
	@test -x $(GOBIN)/sqlc && $(GOBIN)/sqlc version | grep -q $(SQLC_VERSION) || go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)
	$(GOBIN)/sqlc generate

## check-gen: fail when generated files are out of date
check-gen: gen
	git diff --exit-code -- internal/db/schema.sql internal/db/q

## test: Go tests (set TEST_DATABASE_URL for the database-backed ones)
test:
	go test -race -count=1 ./...

lint:
	@test -x $(GOBIN)/golangci-lint || go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)
	$(GOBIN)/golangci-lint run ./...

build:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o bin/server ./cmd/server
