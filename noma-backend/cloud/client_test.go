package cloud

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestRotatedTokenSurvivesTemporaryCheckpointFailureWithoutRefreshingAgain(t *testing.T) {
	var refreshes atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		refreshes.Add(1)
		cookie, err := r.Cookie(refreshCookie)
		if err != nil || cookie.Value != "initial-test-refresh" {
			t.Error("unexpected refresh credential")
		}
		http.SetCookie(w, &http.Cookie{Name: refreshCookie, Value: "rotated-test-refresh"})
		fmt.Fprint(w, `{"access_token":"new-test-access","expires_in":3600}`)
	}))
	defer server.Close()
	account := &Account{RefreshToken: "initial-test-refresh"}
	stored, fail := "", false
	if err := account.PersistRefreshToken(func(token string) error {
		if fail {
			return fmt.Errorf("temporary disk error")
		}
		stored = token
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	client := New(server.URL)
	fail = true
	if _, err := client.AccessToken(context.Background(), account); err == nil {
		t.Fatal("storage failure did not stop use of an uncheckpointed credential")
	}
	fail = false
	if token, err := client.AccessToken(context.Background(), account); err != nil || token == "" || stored != "rotated-test-refresh" || refreshes.Load() != 1 {
		t.Fatal("credential checkpoint repair repeated the rotation")
	}
}

func TestRefreshDoesNotReplaceCredentialWithAnObsoleteCookieClearing(t *testing.T) {
	account := &Account{RefreshToken: "previous-test-refresh"}
	if err := account.update(tokenResponse{AccessToken: "test-access", ExpiresIn: 3600}, []*http.Cookie{
		{Name: refreshCookie, Value: "replacement-test-refresh", Path: "/"},
		{Name: refreshCookie, Value: "", Path: "/obsolete-auth", MaxAge: -1},
	}); err != nil || account.RefreshToken != "replacement-test-refresh" {
		t.Fatal("clearing an obsolete cookie overwrote the renewable credential")
	}
	if err := account.update(tokenResponse{AccessToken: "test-access", ExpiresIn: 3600}, []*http.Cookie{
		{Name: refreshCookie, Value: "", MaxAge: -1},
	}); err != nil || account.RefreshToken != "replacement-test-refresh" {
		t.Fatal("a successful refresh without a new credential erased the existing credential")
	}
}
