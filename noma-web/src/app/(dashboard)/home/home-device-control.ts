import type { Device } from "@/types";

type HomeControlClient = {
  controlDevice: (id: string, action: string, params?: Record<string, unknown>) => Promise<{ ok: boolean }>;
  listDevices: () => Promise<Device[]>;
};

// Keep a light's last usable settings in the existing per-user home snapshot.
// Many integrations clear these attributes when off, or report them after power-on.
export function retainLightSettings(device: Device, previous?: Device): Device {
  if (device.domain !== "light" || previous?.entity_id !== device.entity_id) return device;
  const attributes = { ...device.attributes };
  let changed = false;
  for (const key of ["brightness", "rgb_color", "rgbw_color", "rgbww_color", "color_mode", "color_temp_kelvin"] as const) {
    const valid = (value: unknown) => {
      if (key === "color_mode") return typeof value === "string" && value !== "" && value !== "unknown";
      if (key === "brightness" || key === "color_temp_kelvin") return typeof value === "number" && Number.isFinite(value) && value > 0 && (key !== "brightness" || value <= 255);
      const length = key === "rgbw_color" ? 4 : key === "rgbww_color" ? 5 : 3;
      return Array.isArray(value) && value.length === length && value.every(channel => typeof channel === "number" && Number.isFinite(channel) && channel >= 0 && channel <= 255);
    };
    const cached = previous.attributes?.[key];
    if (valid(cached) && (device.state === "off" || !valid(attributes[key]))) {
      attributes[key] = Array.isArray(cached) ? [...cached] : cached;
      changed = true;
    }
  }
  return changed ? { ...device, attributes } : device;
}

export function optimisticDevice(device: Device, action: string, params: Record<string, unknown> = {}): Device {
  let state = device.state;
  const attributes = { ...device.attributes };
  switch (action) {
    case "turn_on":
      state = device.domain === "media_player" ? "idle" : device.domain === "climate" && device.state !== "off" ? device.state : "on";
      if (device.domain === "light" && typeof params.brightness_pct === "number") {
        attributes.brightness = Math.round(Math.max(0, Math.min(100, params.brightness_pct)) / 100 * 255);
        if (attributes.brightness === 0) state = "off";
      }
      if (device.domain === "light" && Array.isArray(params.rgb_color)) {
        attributes.rgb_color = [...params.rgb_color];
        attributes.color_mode = "rgb";
      }
      if (device.domain === "light") {
        for (const mode of ["rgbw", "rgbww"]) {
          const channels = params[`${mode}_color`];
          if (Array.isArray(channels)) {
            attributes[`${mode}_color`] = [...channels];
            attributes.color_mode = mode;
          }
        }
        if (typeof params.white === "number") {
          attributes.color_mode = "white";
          attributes.brightness = params.white;
        }
        if (typeof params.color_temp_kelvin === "number") {
          attributes.color_mode = "color_temp";
          attributes.color_temp_kelvin = params.color_temp_kelvin;
        }
      }
      break;
    case "turn_off": state = "off"; break;
    case "set_hvac_mode":
      if (typeof params.hvac_mode === "string") state = params.hvac_mode;
      break;
    case "open_cover": state = "opening"; break;
    case "close_cover": state = "closing"; break;
    case "stop_cover": state = attributes.current_position === 0 ? "closed" : "open"; break;
    case "set_cover_position":
      if (typeof params.position === "number") {
        attributes.current_position = params.position;
        state = params.position === 0 ? "closed" : "open";
      }
      break;
    case "media_play": state = "playing"; break;
    case "media_pause": state = "paused"; break;
    case "media_stop": state = "idle"; break;
    case "start": if (device.domain === "vacuum") state = "cleaning"; break;
    case "pause": if (device.domain === "vacuum") state = "paused"; break;
    case "stop": if (device.domain === "vacuum") state = "idle"; break;
    case "return_to_base": if (device.domain === "vacuum") state = "returning"; break;
    case "set_percentage":
      if (typeof params.percentage === "number") {
        attributes.percentage = params.percentage;
        state = params.percentage === 0 ? "off" : "on";
      }
      break;
  }
  const attributeControls: Record<string, string> = {
    set_temperature: "temperature", set_fan_mode: "fan_mode", set_preset_mode: "preset_mode",
    set_mode: "mode", set_humidity: "humidity", volume_set: "volume_level",
  };
  const attribute = attributeControls[action];
  if (attribute && params[attribute] !== undefined) attributes[attribute] = params[attribute];
  return { ...device, state, attributes };
}

export async function controlDeviceOptimistically(
  device: Device,
  action: string,
  params: Record<string, unknown> | undefined,
  client: HomeControlClient,
  update: (device: Device) => void,
): Promise<"confirmed" | "unconfirmed" | "failed"> {
  const expected = optimisticDevice(device, action, params);
  update(expected);
  try {
    const result = await client.controlDevice(device.entity_id, action, params);
    if (!result.ok) throw new Error("Device control failed");
  } catch {
    update(device);
    return "failed";
  }
  let latest: Device | undefined;
  // HA may acknowledge a service before the integration reports its new state.
  // Keep the optimistic value during this bounded read-back window.
  for (const delay of [0, 500, 1000, 1500]) {
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    try {
      const devices = await client.listDevices();
      const actual = devices.find(item => item.entity_id === device.entity_id);
      if (!actual) continue;
      latest = actual;
      if (!matchesControl(device, expected, actual, action)) continue;
      update(retainLightSettings(actual, actual.state === "off" ? device : expected));
      return "confirmed";
    } catch {
      // A read failure does not mean the accepted command failed to execute.
    }
  }
  if (latest) update(retainLightSettings(latest, device));
  return "unconfirmed";
}

function matchesControl(before: Device, expected: Device, actual: Device, action: string): boolean {
  const stateActions = ["turn_on", "turn_off", "set_hvac_mode", "open_cover", "close_cover", "stop_cover",
    "set_cover_position", "media_play", "media_pause", "media_stop", "start", "pause", "stop", "return_to_base", "set_percentage"];
  if (stateActions.includes(action)) {
    let states = [expected.state];
    if (action === "open_cover") states = ["opening", "open"];
    if (action === "close_cover") states = ["closing", "closed"];
    if (action === "stop_cover") states = ["open", "closed"];
    if (action === "turn_on" && before.domain === "climate") states = ["heat", "cool", "heat_cool", "auto", "dry", "fan_only", "on"];
    if (action === "turn_on" && before.domain === "media_player") states = ["on", "idle", "playing", "paused", "standby"];
    if (!states.includes(actual.state)) return false;
  }
  return Object.entries(expected.attributes ?? {}).every(([key, value]) => {
    if (key === "color_mode") {
      // RGB requests may be converted to HS/XY; explicit white modes must be reported.
      return value === before.attributes?.color_mode || !["white", "color_temp"].includes(String(value)) || actual.attributes?.color_mode === value;
    }
    if (value === before.attributes?.[key]) return true;
    if (key === "brightness" && before.domain === "light" && expected.state === "off") return true;
    const reported = actual.attributes?.[key];
    if (["rgb_color", "rgbw_color", "rgbww_color"].includes(key) && Array.isArray(value) && Array.isArray(reported)) {
      const length = key === "rgbw_color" ? 4 : key === "rgbww_color" ? 5 : 3;
      if (value.length !== length || reported.length !== length) return false;
      // HA can convert RGB through HS/XY and normalize its intensity; brightness is separate.
      const expectedMax = Math.max(...value) || 1;
      const reportedMax = Math.max(...reported) || 1;
      return value.every((channel, index) => Math.abs(channel / expectedMax - reported[index] / reportedMax) <= 0.02);
    }
    // HA integrations can round the conversion from percent to 0–255 brightness.
    return key === "brightness" && typeof value === "number" && typeof reported === "number"
      ? Math.abs(reported - value) <= 1 : reported === value;
  });
}
