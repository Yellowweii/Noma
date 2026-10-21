package app

import (
	"bufio"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"testing"

	"noma.local/public/internal/protocol"
)

func TestFrontendReceivesTokensBeforeLocalTurnCompletes(t *testing.T) {
	gate := make(chan struct{})
	release := sync.OnceFunc(func() { close(gate) })
	f := newFixture(t, fixtureOptions{streaming: true, streamGate: gate})
	defer release()
	frontendLogin(t, f)
	req, _ := http.NewRequest("POST", f.local.URL+"/api/v1/chat/sessions/"+sessionID+"/messages", strings.NewReader(`{"content":"打开测试灯","request_id":"`+requestID+`"}`))
	req.Header.Set("Origin", f.local.URL)
	req.Header.Set("Content-Type", "application/json")
	response, err := f.client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	var text strings.Builder
	for scanner.Scan() {
		if !strings.HasPrefix(scanner.Text(), "data:") {
			continue
		}
		var event protocol.StreamEvent
		if json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "data:"))), &event) == nil && event.Type == "token" {
			text.WriteString(event.Content)
			break
		}
	}
	if scanner.Err() != nil || text.String() != "本轮" {
		t.Fatal("first token was buffered", scanner.Err(), text.String())
	}
	if f.controls.Load() != 1 || f.results.Load() != 1 {
		t.Fatal("local tool loop did not finish before the reply")
	}
	release()
	done := false
	for scanner.Scan() {
		if !strings.HasPrefix(scanner.Text(), "data:") {
			continue
		}
		var event protocol.StreamEvent
		if err := json.Unmarshal([]byte(strings.TrimSpace(strings.TrimPrefix(scanner.Text(), "data:"))), &event); err != nil {
			t.Fatal(err)
		}
		if event.Type == "token" {
			text.WriteString(event.Content)
		}
		if event.Type == "done" {
			done = true
		}
	}
	if scanner.Err() != nil || text.String() != "本轮完成" || !done {
		t.Fatal("reply duplicated or incomplete", scanner.Err(), text.String(), done)
	}
	status, body, _ := f.request(t, "POST", "/api/v1/chat/sessions/"+sessionID+"/messages", map[string]string{"content": "打开测试灯", "request_id": requestID})
	if status != 200 || !strings.Contains(body, "本轮完成") || f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("stream replay re-executed a device", status, body)
	}
}

func TestInterruptedStreamReportsUnknownResultWithoutRetry(t *testing.T) {
	f := newFixture(t, fixtureOptions{streaming: true, streamFailure: true})
	frontendLogin(t, f)
	path := "/api/v1/chat/sessions/" + sessionID + "/messages"
	status, body, _ := f.request(t, "POST", path, map[string]string{"content": "打开测试灯", "request_id": requestID})
	if status != 200 || !strings.Contains(body, "event: error") || !strings.Contains(body, "结果未知") || strings.Contains(body, `"type":"done"`) {
		t.Fatal("interrupted stream claimed completion", status, body)
	}
	status, _, _ = f.request(t, "POST", path, map[string]string{"content": "打开测试灯", "request_id": requestID})
	if status != 502 || f.controls.Load() != 1 || f.turns.Load() != 1 {
		t.Fatal("interrupted turn was retried", status)
	}
}
