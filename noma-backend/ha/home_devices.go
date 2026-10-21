package ha

import "strings"

// Dashboard visibility is separate from the executor's entity/service grants.
// Hiding housekeeping entities must not change what an authorized tool can read.
func (s State) HomeCandidate() bool {
	switch strings.SplitN(s.EntityID, ".", 2)[0] {
	case "light", "switch", "input_boolean", "climate", "cover", "media_player", "fan", "humidifier", "vacuum", "sensor", "binary_sensor":
		return true
	}
	return false
}

func (s State) HomeVisible() bool {
	if !s.HomeCandidate() || s.homeHidden {
		return false
	}
	domain, _, _ := strings.Cut(s.EntityID, ".")
	if domain != "sensor" && domain != "binary_sensor" {
		return true
	}
	// These built-in integrations are housekeeping rather than room devices.
	// The REST state directory may omit their registry metadata.
	for _, prefix := range []string{"sensor.backup_", "sensor.sun_", "sensor.iphone_", "sensor.ipad_", "sensor.mobile_", "binary_sensor.iphone_", "binary_sensor.ipad_", "binary_sensor.mobile_"} {
		if strings.HasPrefix(s.EntityID, prefix) {
			return false
		}
	}
	// Older HA instances may not permit registry reads. Phone entity IDs often
	// include the owner's name before the model, rather than starting with it.
	for _, part := range strings.Split(s.EntityID, "_") {
		if part == "iphone" || part == "ipad" {
			return false
		}
	}
	class, _ := s.Attributes["device_class"].(string)
	if domain == "sensor" {
		switch class {
		case "temperature", "humidity", "pressure", "atmospheric_pressure", "illuminance", "aqi", "carbon_dioxide", "carbon_monoxide", "pm1", "pm10", "pm25", "volatile_organic_compounds", "volatile_organic_compounds_parts", "moisture", "sound_pressure", "water", "volume_flow_rate":
			return true
		}
	} else {
		switch class {
		case "door", "window", "opening", "motion", "occupancy", "presence", "moisture", "smoke", "gas", "carbon_monoxide", "safety", "sound", "vibration", "heat", "cold", "light", "lock":
			return true
		}
	}
	return false
}

func homeMetadataHidden(attributes map[string]any) bool {
	for _, key := range []string{"entity_category", "hidden_by", "disabled_by"} {
		if value, _ := attributes[key].(string); value != "" {
			return true
		}
	}
	for _, key := range []string{"integration", "platform"} {
		if value, _ := attributes[key].(string); value == "mobile_app" || value == "backup" || value == "sun" {
			return true
		}
	}
	return false
}
