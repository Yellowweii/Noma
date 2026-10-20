import type { Device } from "@/types";

export function numberAttribute(device: Device, key: string): number | undefined {
  const value = device.attributes?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
export function lightBrightnessPct(device: Device): number | undefined {
  const brightness = numberAttribute(device, "brightness");
  // Off-state attributes may hold the brightness to restore on the next power-on.
  return brightness === undefined ? undefined : device.state === "off" ? 0 : Math.round(brightness / 255 * 100);
}
export function stringAttribute(device: Device, key: string): string | undefined {
  const value = device.attributes?.[key];
  return typeof value === "string" && value ? value : undefined;
}
export function stringList(device: Device, key: string): string[] {
  const value = device.attributes?.[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
export function supports(device: Device, action: string, parameter?: string): boolean {
  return Boolean(device.supported_actions?.includes(action) && (!parameter || device.action_params?.[action]?.includes(parameter)));
}
export function supportsLightColor(device: Device): boolean {
  return device.domain === "light" && ["rgb_color", "rgbw_color", "rgbww_color"].some(parameter => supports(device, "turn_on", parameter));
}
export function lightColorHex(device: Device): string | undefined {
  if (isWhiteLight(device)) return "#ffffff";
  const mode = stringAttribute(device, "color_mode");
  const native = mode === "rgbw" || mode === "rgbww" ? device.attributes?.[`${mode}_color`] : undefined;
  const rgb = Array.isArray(native) ? native.slice(0, 3) : device.attributes?.rgb_color;
  if (!Array.isArray(rgb) || rgb.length !== 3 || !rgb.every(channel => typeof channel === "number" && Number.isFinite(channel) && channel >= 0 && channel <= 255)) return undefined;
  return `#${rgb.map(channel => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}
export function whiteLightParams(device: Device): Record<string, unknown> | undefined {
  if (device.domain !== "light") return undefined;
  if (supports(device, "turn_on", "color_temp_kelvin")) {
    const max = numberAttribute(device, "max_color_temp_kelvin") ?? 6535;
    return { color_temp_kelvin: Math.round(max) };
  }
  if (supports(device, "turn_on", "rgbw_color")) return { rgbw_color: [0, 0, 0, 255] };
  if (supports(device, "turn_on", "rgbww_color")) return { rgbww_color: [0, 0, 0, 255, 0] };
  if (supports(device, "turn_on", "white")) return { white: numberAttribute(device, "brightness") || 255 };
  return undefined;
}
export function lightColorParams(device: Device, rgb: number[]): Record<string, unknown> {
  if (supports(device, "turn_on", "rgbw_color")) return { rgbw_color: [...rgb, 0] };
  if (supports(device, "turn_on", "rgbww_color")) return { rgbww_color: [...rgb, 0, 0] };
  return { rgb_color: [...rgb] };
}
export function isWhiteLight(device: Device): boolean {
  const mode = stringAttribute(device, "color_mode");
  if (mode === "white" || mode === "color_temp") return true;
  const channels = mode === "rgbw" || mode === "rgbww" ? device.attributes?.[`${mode}_color`] : undefined;
  return Array.isArray(channels) && channels.length === (mode === "rgbw" ? 4 : 5) &&
    channels.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 255) &&
    channels.slice(0, 3).every(value => value <= 3) && channels.slice(3).some(value => value > 3);
}
export function isSpeaker(device: Device): boolean {
  return device.domain === "media_player" && (stringAttribute(device, "device_class") === "speaker" ||
    /音箱|音响|喇叭/.test(device.name) || /speaker|sonos|yinxiang/.test(`${stringAttribute(device, "icon") ?? ""} ${device.entity_id}`.toLowerCase()));
}
export function unavailable(device: Device): boolean {
  return typeof device.state !== "string" || ["unavailable", "unknown", ""].includes(device.state.trim().toLowerCase());
}
export const modeLabels: Record<string, string> = {
  off: "关闭", heat: "制热", cool: "制冷", heat_cool: "自动冷暖", auto: "自动", dry: "除湿", fan_only: "送风",
};
export function stateText(device: Device): string {
  if (device.state === "unavailable") return "不可用";
  if (device.state === "unknown" || typeof device.state !== "string" || !device.state) return "状态未知";
  if (device.domain === "sensor") {
    const unit = stringAttribute(device, "unit_of_measurement");
    return `${device.state}${unit ? ` ${unit}` : ""}`;
  }
  if (device.domain === "binary_sensor") {
    const labels: Record<string, [string, string]> = {
      door: ["已关闭", "已打开"], window: ["已关闭", "已打开"], opening: ["已关闭", "已打开"],
      motion: ["无活动", "检测到活动"], occupancy: ["无人", "有人"], presence: ["无人", "有人"],
      moisture: ["干燥", "检测到漏水"], smoke: ["正常", "检测到烟雾"], gas: ["正常", "检测到气体"],
      problem: ["正常", "异常"], connectivity: ["未连接", "已连接"],
    };
    const pair = labels[stringAttribute(device, "device_class") || ""];
    if (pair && ["on", "off"].includes(device.state)) return pair[device.state === "on" ? 1 : 0];
  }
  const labels: Record<string, string> = {
    on: "已开启", off: "已关闭", open: "已打开", closed: "已关闭", opening: "正在打开", closing: "正在关闭",
    playing: "播放中", paused: "已暂停", idle: "待机", standby: "待机",
    cleaning: "清扫中", docked: "已停靠", returning: "返回充电中",
  };
  return device.domain === "climate" ? (modeLabels[device.state] || labels[device.state] || device.state) : (labels[device.state] || device.state);
}
export function activeDevice(device: Device): boolean {
  return !unavailable(device) && (device.state === "on" || device.state === "open" ||
    (device.domain === "climate" && device.state !== "off") || device.state === "playing");
}
export function deviceDetails(device: Device): string[] {
  if (unavailable(device)) return [];
  const details: string[] = [];
  if (device.domain === "light" && device.state === "on") {
    const brightness = lightBrightnessPct(device);
    if (brightness !== undefined && supports(device, "turn_on", "brightness_pct")) details.push(`亮度 ${brightness}%`);
  }
  if (device.domain === "cover") {
    const position = numberAttribute(device, "current_position");
    if (position !== undefined) details.push(`已打开 ${position}%`);
  }
  if (device.domain === "climate") {
    const unit = stringAttribute(device, "temperature_unit") || "";
    const target = numberAttribute(device, "temperature");
    const current = numberAttribute(device, "current_temperature");
    if (target !== undefined) details.push(`设定 ${target}${unit}`);
    if (current !== undefined) details.push(`当前 ${current}${unit}`);
  }
  return details;
}
// Whether the detail panel offers anything beyond the card's common controls.
export function hasDetailControls(device: Device): boolean {
  switch (device.domain) {
    case "light": return supports(device, "turn_on", "brightness_pct") || supportsLightColor(device) || Boolean(whiteLightParams(device));
    case "cover": return supports(device, "set_cover_position", "position") && numberAttribute(device, "current_position") !== undefined;
    case "climate": return supports(device, "set_temperature", "temperature") ||
      (supports(device, "set_hvac_mode", "hvac_mode") && stringList(device, "hvac_modes").some(mode => mode !== "off")) ||
      (supports(device, "set_fan_mode", "fan_mode") && stringList(device, "fan_modes").length > 0);
    case "fan": return supports(device, "set_percentage", "percentage") ||
      (supports(device, "set_preset_mode", "preset_mode") && stringList(device, "preset_modes").length > 0);
    case "humidifier": return supports(device, "set_humidity", "humidity") ||
      (supports(device, "set_mode", "mode") && stringList(device, "available_modes").length > 0);
    case "media_player": return isSpeaker(device) ?
      ["media_play", "media_pause", "media_previous_track", "media_next_track"].some(action => supports(device, action)) || supports(device, "volume_set", "volume_level") :
      ["media_play", "media_pause", "media_stop"].some(action => supports(device, action));
    case "vacuum": return ["pause", "stop"].some(action => supports(device, action));
    default: return false;
  }
}
export function roomKey(device: Device): string {
  return device.room?.trim() ? (device.area_id || `name:${device.room.trim()}`) : "unassigned";
}
export function relatedEntityGroups(devices: Device[]): Device[][] {
  const groups = new Map<string, Device[]>();
  for (const device of devices) {
    const key = device.device_id ? `device:${device.device_id}` : `entity:${device.entity_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(device);
  }
  return [...groups.values()];
}

export const homeControlDomains = new Set(["light", "switch", "input_boolean", "climate", "cover", "media_player", "fan", "humidifier", "vacuum"]);
export const specializedHomeDomains = new Set([...homeControlDomains, "sensor", "binary_sensor"]);
export function isHomeSensor(device: Device): boolean {
  return device.domain === "sensor" || device.domain === "binary_sensor";
}
export function homeSummary(devices: Device[]): string {
  return `${relatedEntityGroups(devices).length} 台设备`;
}
