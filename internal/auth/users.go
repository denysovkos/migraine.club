package auth

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

// User is the subset of Clerk's User object the server reads.
type User struct {
	ID                    string         `json:"id"`
	FirstName             *string        `json:"first_name"`
	LastName              *string        `json:"last_name"`
	Username              *string        `json:"username"`
	ImageURL              string         `json:"image_url"`
	PrimaryEmailAddressID *string        `json:"primary_email_address_id"`
	EmailAddresses        []EmailAddress `json:"email_addresses"`
	PublicMetadata        map[string]any `json:"public_metadata"`
}

// EmailAddress is one of a user's email addresses.
type EmailAddress struct {
	ID           string `json:"id"`
	EmailAddress string `json:"email_address"`
}

// PrimaryEmail returns the primary email address, or "".
func (u *User) PrimaryEmail() string {
	if u == nil {
		return ""
	}
	for _, e := range u.EmailAddresses {
		if u.PrimaryEmailAddressID != nil && e.ID == *u.PrimaryEmailAddressID {
			return e.EmailAddress
		}
	}
	return ""
}

// FullName joins first and last name like Clerk's fullName.
func (u *User) FullName() string {
	if u == nil {
		return ""
	}
	var parts []string
	if u.FirstName != nil && *u.FirstName != "" {
		parts = append(parts, *u.FirstName)
	}
	if u.LastName != nil && *u.LastName != "" {
		parts = append(parts, *u.LastName)
	}
	return strings.Join(parts, " ")
}

// Users reads and deletes Clerk users.
type Users interface {
	Get(ctx context.Context, id string) (*User, error)
	Delete(ctx context.Context, id string) error
}

// GetUser calls GET /v1/users/{id}.
func (c *Clerk) Get(ctx context.Context, id string) (*User, error) {
	res, err := c.backend(ctx, http.MethodGet, "/v1/users/"+url.PathEscape(id))
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("clerk get user: status %d", res.StatusCode)
	}
	var u User
	if err := json.NewDecoder(res.Body).Decode(&u); err != nil {
		return nil, err
	}
	return &u, nil
}

// Delete calls DELETE /v1/users/{id}.
func (c *Clerk) Delete(ctx context.Context, id string) error {
	res, err := c.backend(ctx, http.MethodDelete, "/v1/users/"+url.PathEscape(id))
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode >= 300 {
		return fmt.Errorf("clerk delete user: status %d", res.StatusCode)
	}
	return nil
}

func (c *Clerk) backend(ctx context.Context, method, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.APIURL, "/")+path, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+c.SecretKey)
	return c.HTTP.Do(req)
}

// MockUsers is the stand-in for Clerk under E2E_MOCK_AUTH, matching
// src/libs/MockClerkServer.ts.
type MockUsers struct{}

func strp(s string) *string { return &s }

// Get returns the synthetic e2e user for any id.
func (MockUsers) Get(_ context.Context, id string) (*User, error) {
	return &User{
		ID:                    id,
		FirstName:             strp("E2E"),
		LastName:              strp("User"),
		Username:              strp("e2e-user"),
		PrimaryEmailAddressID: strp("e2e_email_001"),
		EmailAddresses:        []EmailAddress{{ID: "e2e_email_001", EmailAddress: "e2e@test.local"}},
		PublicMetadata:        map[string]any{},
	}, nil
}

// Delete pretends to delete.
func (MockUsers) Delete(context.Context, string) error { return nil }
