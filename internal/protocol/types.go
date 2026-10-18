// Package protocol defines the proposed Noma Cloud remote-tool contract.
// The current private cloud has not implemented these endpoints yet.
package protocol

import (
	"encoding/json"
	"time"
)

const Version = "1"

type ToolCall struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
	ExpiresAt time.Time       `json:"expires_at"`
}

type ToolResult struct {
	ID    string          `json:"id"`
	OK    bool            `json:"ok"`
	Data  json.RawMessage `json:"data,omitempty"`
	Error string          `json:"error,omitempty"`
}

type TurnRequest struct {
	ProtocolVersion    string `json:"protocol_version"`
	RequestID          string `json:"request_id"`
	SessionID          string `json:"session_id,omitempty"`
	Message            string `json:"message"`
	Regenerate         bool   `json:"regenerate,omitempty"`
	ReplaceAssistantID string `json:"replace_assistant_id,omitempty"`
}

type TurnResponse struct {
	ProtocolVersion    string     `json:"protocol_version"`
	RequestID          string     `json:"request_id"`
	SessionID          string     `json:"session_id"`
	TurnID             string     `json:"turn_id"`
	Reply              string     `json:"reply,omitempty"`
	ToolCalls          []ToolCall `json:"tool_calls,omitempty"`
	MessageID          string     `json:"message_id,omitempty"`
	AssistantMessageID string     `json:"assistant_message_id,omitempty"`
}

type ResultsRequest struct {
	ProtocolVersion string       `json:"protocol_version"`
	RequestID       string       `json:"request_id"`
	SessionID       string       `json:"session_id"`
	Results         []ToolResult `json:"tool_results"`
}
