"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  Activity, AirVent, Bell, Blinds, Bot, Cctv, ChevronRight, Coffee, DoorOpen, Droplets, Fan, Flame, Heater,
  House, Lightbulb, Lock, Microwave, Monitor, Palette, Pause, Play, Plug, Refrigerator, Router, ShowerHead, SkipBack, SkipForward, Speaker, Square, Sun, Thermometer, Tv, Volume2,
  WashingMachine, Wind, X,
  type LucideIcon,
} from "lucide-react";
import type { Device } from "@/types";
import { activeDevice, deviceDetails, hasDetailControls, isSpeaker, isWhiteLight, lightBrightnessPct, lightColorHex, lightColorParams, modeLabels, numberAttribute, specializedHomeDomains, stateText, stringAttribute, stringList, supports, supportsLightColor, unavailable, whiteLightParams } from "./home-devices";
import styles from "./home-dashboard.module.css";

type Control = (action: string, params?: Record<string, unknown>) => Promise<boolean>;

// Virtual helpers (input_boolean/switch) carry no device type, so infer it from the HA icon, name and entity_id.
const iconRules: [RegExp, RegExp, LucideIcon][] = [
  [/灯/, /lightbulb|lamp|light|deng/, Lightbulb],
  [/电视/, /television|\btv\b|_tv|tv_|dianshi/, Tv],
  [/窗帘|百叶|卷帘/, /curtain|blind|shade|window-shutter|chuanglian/, Blinds],
  [/空调|新风/, /air-conditioner|hvac|air_?con|kongtiao/, AirVent],
  [/暖气|取暖|电暖/, /heater|radiator|nuanqi/, Heater],
  [/风扇|吊扇/, /fan|fengshan/, Fan],
  [/加湿|除湿/, /humidifier|dehumidifier|jiashi/, Droplets],
  [/扫地|拖地|机器人/, /vacuum|robot/, Bot],
  [/音箱|音响|喇叭/, /speaker|sonos|yinxiang/, Speaker],
  [/热水器|淋浴/, /water-heater|water_heater|shower|reshuiqi/, ShowerHead],
  [/冰箱/, /fridge|refrigerator|bingxiang/, Refrigerator],
  [/洗衣|烘干/, /washing|washer|dryer|xiyiji/, WashingMachine],
  [/微波|烤箱/, /microwave|oven/, Microwave],
  [/咖啡/, /coffee/, Coffee],
  [/锁/, /lock/, Lock],
  [/门/, /door|garage|gate/, DoorOpen],
  [/摄像|监控/, /camera|cctv/, Cctv],
  [/路由|网关/, /router|gateway/, Router],
  [/插座|插头/, /outlet|socket|plug|chazuo/, Plug],
];
const domainIcons: Record<string, LucideIcon> = {
  light: Lightbulb, switch: Plug, input_boolean: Plug, climate: AirVent, cover: Blinds,
  media_player: Monitor, fan: Fan, humidifier: Droplets, vacuum: Bot,
};
const sensorIcons: Record<string, LucideIcon> = {
  temperature: Thermometer, humidity: Droplets, moisture: Droplets, carbon_dioxide: Wind, carbon_monoxide: Wind,
  pm1: Wind, pm10: Wind, pm25: Wind, aqi: Wind, volatile_organic_compounds: Wind, illuminance: Sun,
  door: DoorOpen, window: Blinds, opening: DoorOpen, smoke: Flame, gas: Flame, safety: Bell,
};
const powerDomains = new Set(["light", "switch", "input_boolean", "climate", "media_player", "fan", "humidifier"]);

function deviceIcon(device: Device): LucideIcon {
  if (device.domain === "sensor" || device.domain === "binary_sensor") {
    return sensorIcons[stringAttribute(device, "device_class") || ""] || Activity;
  }
  const name = device.name;
  const id = `${stringAttribute(device, "icon") ?? ""} ${device.entity_id}`.toLowerCase();
  return iconRules.find(([zh, en]) => zh.test(name) || en.test(id))?.[2] || domainIcons[device.domain] || Plug;
}

function RangeControl({ label, accessibleLabel, value, disabled, onCommit, icon: RangeIcon, smooth = Boolean(RangeIcon), inline = false,
  min = 0, max = 100, step = 1, hideUnknown = false, hideZero = false, formatValue = (value: number) => `${value}%` }: {
  label: string; accessibleLabel: string; value?: number; disabled: boolean; onCommit: (value: number) => Promise<boolean>; icon?: LucideIcon; smooth?: boolean; inline?: boolean;
  min?: number; max?: number; step?: number; hideUnknown?: boolean; hideZero?: boolean; formatValue?: (value: number) => string;
}) {
  const [draft, setDraft] = useState(value ?? min);
  const [touched, setTouched] = useState(false);
  const [commitRevision, setCommitRevision] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointerStart = useRef<number | null>(null);
  const draftValue = useRef(value ?? min);
  const edited = useRef(false);
  const queuedValue = useRef<number | null>(null);
  const committing = useRef(false);
  useEffect(() => {
    if (committing.current || edited.current) return;
    draftValue.current = value ?? min;
    setDraft(value ?? min);
    setTouched(false);
  }, [value, min, commitRevision]);
  async function commit() {
    if (disabled || !edited.current) return;
    edited.current = false;
    setTouched(false);
    let target = draftValue.current;
    if (committing.current) {
      queuedValue.current = target;
      return;
    }
    if (target === value) return;
    committing.current = true;
    try {
      // Keep accepting input while one request runs; send only the newest queued target.
      while (true) {
        queuedValue.current = null;
        const success = await onCommit(target);
        const next = queuedValue.current;
        if (next === null || (next === target && success)) break;
        target = next;
      }
    } finally {
      committing.current = false;
      // Sync after React renders the final read-back state, unless the user is still editing.
      setCommitRevision(previous => previous + 1);
    }
  }
  const progress = Math.min(1, Math.max(0, (draft - min) / (max - min)));
  const valueText = value === undefined && !touched ? (hideUnknown ? "" : "未知") : hideZero && draft === 0 ? "" : formatValue(draft);
  return <label className={`${styles.range}${RangeIcon ? ` ${styles.rangeWithIcon}` : ""}${inline ? ` ${styles.inlineRange}` : ""}`}>
    {!inline && <span className={styles.rangeLabel}>{label}{valueText && <span>{valueText}</span>}</span>}
    <span className={styles.rangeTrack}>
      {RangeIcon && <RangeIcon size={20} strokeWidth={1.5} className={styles.rangeIcon} aria-hidden="true" />}
      <span className={`${styles.rangeSlider}${smooth ? ` ${styles.smoothRange}` : ""}${dragging ? ` ${styles.rangeDragging}` : ""}`}
        style={{ "--range-value": progress } as CSSProperties}>
        {smooth && <>
          <span className={styles.rangeRail} aria-hidden="true"><span className={styles.rangeFill} /></span>
          <span className={styles.rangeThumb} aria-hidden="true" />
        </>}
        <input type="range" aria-label={accessibleLabel} min={min} max={max} step={step} value={draft} disabled={disabled}
          style={{ "--range-progress": `${progress * 100}%` } as CSSProperties}
          onChange={event => {
            draftValue.current = Number(event.target.value);
            edited.current = true;
            setDraft(draftValue.current);
            setTouched(true);
          }}
          onPointerDown={event => {
            if (!smooth || disabled) return;
            pointerStart.current = event.clientX;
            const bounds = event.currentTarget.getBoundingClientRect();
            const thumbCenter = bounds.left + 9 + (bounds.width - 18) * progress;
            setDragging(Math.abs(event.clientX - thumbCenter) <= 14);
          }}
          onPointerMove={event => {
            if (pointerStart.current !== null && Math.abs(event.clientX - pointerStart.current) > 3) setDragging(true);
          }}
          onPointerUp={() => { pointerStart.current = null; setDragging(false); void commit(); }}
          onPointerCancel={() => { pointerStart.current = null; setDragging(false); }}
          onKeyUp={() => void commit()} onBlur={() => void commit()} />
      </span>
      {inline && <span className={styles.rangeValue}>{valueText}</span>}
    </span>
  </label>;
}

const lightColorPresets = [
  { name: "暖黄", color: "#ffd166" }, { name: "橙", color: "#ff8a00" }, { name: "红", color: "#ff0000" },
  { name: "绿", color: "#00ff00" }, { name: "青", color: "#00ffff" }, { name: "蓝", color: "#0000ff" },
  { name: "紫", color: "#aa00ff" },
];

function rgbFromHex(color: string): number[] {
  return [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
}

function LightColorControl({ device, disabled, onControl }: { device: Device; disabled: boolean; onControl: Control }) {
  const color = lightColorHex(device);
  const whiteParams = whiteLightParams(device);
  const whiteActive = isWhiteLight(device);
  const withColor = supportsLightColor(device);
  const [draft, setDraft] = useState(color ?? "#ffffff");
  const [edited, setEdited] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const colorDisabled = disabled || applying;
  const selectedPreset = color && !whiteActive ? lightColorPresets.find(preset => {
    const rgb = rgbFromHex(color);
    const max = Math.max(...rgb) || 1;
    return rgbFromHex(preset.color).every((channel, index) => Math.abs(channel / 255 - rgb[index] / max) <= 0.02);
  }) : undefined;
  useEffect(() => {
    if (!edited) setDraft(color ?? "#ffffff");
  }, [color, edited]);
  async function applyColor(params: Record<string, unknown>) {
    if (colorDisabled) return;
    setApplying(true);
    try {
      await onControl("turn_on", params);
    } finally {
      setEdited(false);
      setApplying(false);
    }
  }
  return <div className={styles.colorControl}>
    <span>颜色</span>
    <div className={styles.colorOptions}>
      <div className={styles.colorSwatches} role="group" aria-label={`${device.name}常用颜色`}>
        {whiteParams && <button type="button" className={styles.colorSwatch} style={{ backgroundColor: "#ffffff" }}
          title="白光" disabled={colorDisabled} aria-label={`${device.name}白光`} aria-pressed={whiteActive} onClick={async () => {
            if (colorDisabled) return;
            setCustomOpen(false);
            await applyColor(whiteParams);
          }} />}
        {withColor && lightColorPresets.map(preset => <button key={preset.color} type="button" className={styles.colorSwatch}
          style={{ backgroundColor: preset.color }} title={preset.name} aria-label={`${device.name}设为${preset.name}`}
          aria-pressed={selectedPreset === preset} disabled={colorDisabled} onClick={async () => {
            if (colorDisabled) return;
            setCustomOpen(false);
            setEdited(false);
            await applyColor(lightColorParams(device, rgbFromHex(preset.color)));
          }} />)}
      </div>
      {withColor && <button type="button" className={styles.customColorButton} disabled={colorDisabled}
        aria-expanded={customOpen} aria-controls={`${device.entity_id}-custom-color`}
        aria-pressed={Boolean(color && !selectedPreset && !whiteActive)} onClick={() => setCustomOpen(open => !open)}>
        <Palette size={14} aria-hidden="true" />自定义
      </button>}
    </div>
    {customOpen && <div id={`${device.entity_id}-custom-color`} className={styles.colorPicker}>
      <input id={`${device.entity_id}-color`} type="color" aria-label={`${device.name}颜色`} value={draft} disabled={colorDisabled}
        onChange={event => { setDraft(event.target.value); setEdited(true); }} />
      <span>选择颜色</span>
      <button type="button" disabled={colorDisabled || !edited} onClick={async () => {
        if (!edited) return;
        await applyColor(lightColorParams(device, rgbFromHex(draft)));
      }}>应用颜色</button>
    </div>}
  </div>;
}

function PowerSwitch({ device, disabled, onControl }: { device: Device; disabled: boolean; onControl: Control }) {
  const isPowered = !unavailable(device) && !["off", "standby"].includes(device.state);
  const powerAction = isPowered ? "turn_off" : "turn_on";
  if (!powerDomains.has(device.domain) || !supports(device, powerAction)) return null;
  return <button type="button" role="switch"
    aria-checked={isPowered} aria-label={`${isPowered ? "关闭" : "开启"}${device.name}`}
    className={styles.powerSwitch} disabled={disabled} onClick={() => void onControl(powerAction)}><span /></button>;
}

function ActionButtons({ device, disabled, onControl, actions }: {
  device: Device; disabled: boolean; onControl: Control; actions: [string, string][];
}) {
  const available = actions.filter(([action]) => supports(device, action));
  if (available.length === 0) return null;
  return <div className={styles.controls}>
    {available.map(([action, label]) => <button key={action} type="button" disabled={disabled}
      onClick={() => void onControl(action)}>{label}</button>)}
  </div>;
}

function SpeakerControls({ device, disabled, onControl }: { device: Device; disabled: boolean; onControl: Control }) {
  const playbackAction = device.state === "playing" && supports(device, "media_pause") ? "media_pause" :
    supports(device, "media_play") ? "media_play" : "media_pause";
  const PlaybackIcon = playbackAction === "media_pause" ? Pause : Play;
  const volume = numberAttribute(device, "volume_level");
  const withTransport = ["media_previous_track", playbackAction, "media_next_track"].some(action => supports(device, action));
  return <div className={styles.speakerControls}>
    {withTransport && <div className={styles.speakerTransport}>
      {supports(device, "media_previous_track") && <button type="button" aria-label="上一首" disabled={disabled}
        onClick={() => void onControl("media_previous_track")}><SkipBack size={17} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></button>}
      {supports(device, playbackAction) && <button type="button" className={styles.speakerPlayback}
        aria-label={playbackAction === "media_pause" ? "暂停" : "播放"} disabled={disabled}
        onClick={() => void onControl(playbackAction)}><PlaybackIcon size={21} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></button>}
      {supports(device, "media_next_track") && <button type="button" aria-label="下一首" disabled={disabled}
        onClick={() => void onControl("media_next_track")}><SkipForward size={17} fill="currentColor" strokeWidth={1.5} aria-hidden="true" /></button>}
    </div>}
    {supports(device, "volume_set", "volume_level") && <RangeControl label="音量" accessibleLabel={`${device.name}音量`} icon={Volume2} inline
      value={volume === undefined ? undefined : Math.round(volume * 100)} disabled={unavailable(device)}
      onCommit={value => onControl("volume_set", { volume_level: value / 100 })} />}
  </div>;
}

function temperatureRange(device: Device) {
  const target = numberAttribute(device, "temperature");
  const min = numberAttribute(device, "min_temp");
  const max = numberAttribute(device, "max_temp");
  const step = numberAttribute(device, "target_temp_step");
  const slider = device.domain === "climate" && supports(device, "set_temperature", "temperature") &&
    target !== undefined && min !== undefined && max !== undefined && max > min && step !== undefined && step > 0;
  return { target, min, max, step, slider };
}

const quickActions: Record<string, [string, string, LucideIcon][]> = {
  cover: [["close_cover", "关闭", SkipBack], ["stop_cover", "停止", Square], ["open_cover", "全开", SkipForward]],
  vacuum: [["start", "开始清扫", Play], ["return_to_base", "返回充电", House]],
};

// Common controls fit in the card's heading row so every card keeps the same height.
function QuickActions({ device, disabled, onControl }: { device: Device; disabled: boolean; onControl: Control }) {
  const playbackFallback = isSpeaker(device) && !supports(device, "turn_on") && !supports(device, "turn_off");
  const playbackAction = device.state === "playing" && supports(device, "media_pause") ? "media_pause" :
    supports(device, "media_play") ? "media_play" : "media_pause";
  const actions: [string, string, LucideIcon][] = playbackFallback ?
    [[playbackAction, `${playbackAction === "media_pause" ? "暂停" : "播放"}${device.name}`, playbackAction === "media_pause" ? Pause : Play]] :
    (quickActions[device.domain] ?? []);
  const available = actions.filter(([action]) => supports(device, action));
  if (available.length === 0) return null;
  return <div className={styles.quickActions}>
    {available.map(([action, label, ActionIcon]) => <button key={action} type="button" aria-label={label}
      disabled={disabled} onClick={() => void onControl(action)}><ActionIcon size={action === "stop_cover" ? 12 : 15}
        fill={device.domain === "cover" || playbackFallback ? "currentColor" : "none"} strokeWidth={device.domain === "cover" || playbackFallback ? 1.5 : 2} aria-hidden="true" /></button>)}
  </div>;
}

function CardStatus({ device }: { device: Device }) {
  const temperature = numberAttribute(device, "temperature") ?? numberAttribute(device, "current_temperature");
  const details = device.domain === "climate" ? (temperature === undefined ? [] : [`${temperature}${stringAttribute(device, "temperature_unit") || ""}`]) : deviceDetails(device);
  const state = device.domain === "cover" && details.length > 0 && ["open", "closed"].includes(device.state) ? [] : [stateText(device)];
  const parts = [...state, ...details];
  return <p className={styles.cardStatus}>{parts.map(part => <span key={part}>{part}</span>)}</p>;
}

function DetailControls({ device, disabled, onControl }: { device: Device; disabled: boolean; onControl: Control }) {
  const { target, min, max, step, slider } = temperatureRange(device);
  const brightness = lightBrightnessPct(device);
  const modes = device.domain === "climate" && supports(device, "set_hvac_mode", "hvac_mode") ? stringList(device, "hvac_modes").filter(mode => mode !== "off") : [];
  const fanModes = device.domain === "climate" && supports(device, "set_fan_mode", "fan_mode") ? stringList(device, "fan_modes") : [];
  const fanLabels: Record<string, string> = { auto: "自动", low: "低风", medium: "中风", mid: "中风", high: "高风", quiet: "静音", turbo: "强劲" };
  const modeControl = device.domain === "fan" && supports(device, "set_preset_mode", "preset_mode") ? {
    action: "set_preset_mode", parameter: "preset_mode", options: stringList(device, "preset_modes"), value: stringAttribute(device, "preset_mode"),
  } : device.domain === "humidifier" && supports(device, "set_mode", "mode") ? {
    action: "set_mode", parameter: "mode", options: stringList(device, "available_modes"), value: stringAttribute(device, "mode"),
  } : null;
  return <>
    {device.domain === "light" && supports(device, "turn_on", "brightness_pct") && <RangeControl label="亮度" accessibleLabel={`${device.name}亮度`} icon={Sun}
      value={brightness} disabled={unavailable(device) || device.state === "off"}
      hideUnknown hideZero
      onCommit={value => onControl("turn_on", { brightness_pct: value })} />}
    {device.domain === "light" && (supportsLightColor(device) || whiteLightParams(device)) && <LightColorControl device={device}
      disabled={unavailable(device) || device.state === "off"} onControl={onControl} />}
    {device.domain === "cover" && hasDetailControls(device) && <RangeControl label="开合比例" accessibleLabel={`${device.name}开合比例`} smooth
      value={numberAttribute(device, "current_position")} disabled={unavailable(device)}
      onCommit={value => onControl("set_cover_position", { position: value })} />}
    {device.domain === "cover" && <ActionButtons device={device} disabled={disabled} onControl={onControl}
      actions={[["close_cover", "关闭"], ["stop_cover", "停止"], ["open_cover", "全开"]]} />}
    {slider && <RangeControl label="温度" accessibleLabel={`${device.name}设定温度`} smooth
      value={target} min={min} max={max} step={step} formatValue={value => `${value}${stringAttribute(device, "temperature_unit") || ""}`}
      disabled={unavailable(device)} onCommit={value => onControl("set_temperature", { temperature: value })} />}
    {device.domain === "climate" && !slider && supports(device, "set_temperature", "temperature") && <label className={styles.temperatureInput}>
      设定温度
      <input key={target ?? "unknown"} type="number" aria-label={`${device.name}设定温度`}
        defaultValue={target ?? ""} min={min} max={max} step={step && step > 0 ? step : "any"}
        disabled={disabled} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={async event => {
          const input = event.currentTarget;
          const next = input.valueAsNumber;
          if (!disabled && Number.isFinite(next) && next !== target && input.reportValidity()) {
            if (!await onControl("set_temperature", { temperature: next })) {
              input.value = target === undefined ? "" : String(target);
            }
          }
        }} />
      {stringAttribute(device, "temperature_unit")}
    </label>}
    {modes.length > 0 && <div className={styles.controls}>
      {modes.map(mode => <button key={mode} type="button" aria-pressed={device.state === mode} disabled={disabled}
        onClick={() => void onControl("set_hvac_mode", { hvac_mode: mode })}>{modeLabels[mode] || mode}</button>)}
    </div>}
    {fanModes.length > 0 && <div className={styles.climateFanControl} role="group" aria-label={`${device.name}风速`}>
      <span>风速</span>
      <div className={styles.controls}>
        {fanModes.map(mode => <button key={mode} type="button" aria-pressed={stringAttribute(device, "fan_mode") === mode} disabled={disabled}
          onClick={() => void onControl("set_fan_mode", { fan_mode: mode })}>{fanLabels[mode] || mode}</button>)}
      </div>
    </div>}
    {modeControl && modeControl.options.length > 0 && <label className={styles.modeControl}>
      运行模式
      <select aria-label={`${device.name}运行模式`} value={modeControl.value ?? ""} disabled={disabled}
        onChange={event => void onControl(modeControl.action, { [modeControl.parameter]: event.target.value })}>
        {!modeControl.value && <option value="" disabled>选择模式</option>}
        {modeControl.options.map(mode => <option key={mode} value={mode}>{modeLabels[mode] || mode}</option>)}
      </select>
    </label>}
    {device.domain === "media_player" && (isSpeaker(device) ? <SpeakerControls device={device} disabled={disabled} onControl={onControl} /> :
      <ActionButtons device={device} disabled={disabled} onControl={onControl}
        actions={[["media_play", "播放"], ["media_pause", "暂停"], ["media_stop", "停止"]]} />)}
    {device.domain === "fan" && supports(device, "set_percentage", "percentage") && <RangeControl label="风速" accessibleLabel={`${device.name}风速`}
      value={numberAttribute(device, "percentage")} disabled={disabled}
      onCommit={value => onControl("set_percentage", { percentage: value })} />}
    {device.domain === "humidifier" && supports(device, "set_humidity", "humidity") && <label className={styles.temperatureInput}>
      目标湿度
      <input key={numberAttribute(device, "humidity") ?? "unknown"} type="number" aria-label={`${device.name}目标湿度`}
        defaultValue={numberAttribute(device, "humidity") ?? ""} min={numberAttribute(device, "min_humidity") ?? 0}
        max={numberAttribute(device, "max_humidity") ?? 100} step={numberAttribute(device, "target_humidity_step") ?? 1}
        disabled={disabled} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }}
        onBlur={async event => {
          const input = event.currentTarget;
          const next = input.valueAsNumber;
          if (!disabled && Number.isFinite(next) && next !== numberAttribute(device, "humidity") && input.reportValidity()) {
            if (!await onControl("set_humidity", { humidity: next })) {
              input.value = String(numberAttribute(device, "humidity") ?? "");
            }
          }
        }} />%
    </label>}
    {device.domain === "vacuum" && <ActionButtons device={device} disabled={disabled} onControl={onControl}
      actions={[["start", "开始清扫"], ["pause", "暂停"], ["stop", "停止"], ["return_to_base", "返回充电"]]} />}
  </>;
}

export function DeviceCard({ device, pending, onControl, onOpenDetail }: {
  device: Device; pending: boolean; onControl: Control; onOpenDetail: () => void;
}) {
  const disabled = pending || unavailable(device);
  const Icon = deviceIcon(device);
  const withDetail = hasDetailControls(device);
  return <article className={`${styles.deviceCard} ${styles.compactCard}`} aria-label={device.name} aria-busy={pending}>
    <div className={styles.deviceHeading}>
      <Icon size={22} strokeWidth={1.7} className={activeDevice(device) ? styles.activeIcon : styles.deviceIcon} aria-hidden="true" />
      <div className={styles.deviceName}>
        <h4>{withDetail ? <button type="button" className={styles.deviceOpen} aria-haspopup="dialog"
          aria-label={`查看${device.name}详情`} onClick={onOpenDetail}>
          <span>{device.name}</span><ChevronRight size={14} aria-hidden="true" />
        </button> : device.name}</h4>
        <CardStatus device={device} />
      </div>
      <QuickActions device={device} disabled={disabled} onControl={onControl} />
      <PowerSwitch device={device} disabled={disabled} onControl={onControl} />
    </div>
    {!specializedHomeDomains.has(device.domain) && <p className={styles.details}>暂仅支持状态查看</p>}
  </article>;
}

export function DeviceDetailPanel({ device, pending, onControl, onClose }: {
  device: Device; pending: boolean; onControl: Control; onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const disabled = pending || unavailable(device);
  const Icon = deviceIcon(device);
  const details = ["light", "cover"].includes(device.domain) ? [] : deviceDetails(device).filter(detail => device.domain !== "climate" || !detail.startsWith("设定 "));
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    function onKeyDown(event: KeyboardEvent) { if (event.key === "Escape") close.current(); }
    document.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("keydown", onKeyDown); opener?.focus(); };
  }, []);
  return createPortal(<div className={styles.detailLayer}>
    <button type="button" className={styles.detailBackdrop} aria-label="关闭详情" tabIndex={-1} onClick={onClose} />
    <div ref={panel} role="dialog" aria-modal="true" aria-label={device.name} aria-busy={pending}
      data-light-off={device.domain === "light" && device.state === "off" ? "true" : undefined}
      tabIndex={-1} className={`${styles.detailPanel} modal-pop-in`}>
      <div className={styles.deviceHeading}>
        <Icon size={28} strokeWidth={1.7} className={styles.deviceIcon} aria-hidden="true" />
        <div className={styles.deviceName}>
          <h2>{device.name}</h2>
          <p>{[device.room?.trim(), stateText(device)].filter(Boolean).join(" · ")}</p>
        </div>
        <PowerSwitch device={device} disabled={disabled} onControl={onControl} />
        <button type="button" className={styles.detailClose} aria-label="关闭详情" onClick={onClose}><X size={18} strokeWidth={1.7} /></button>
      </div>
      {details.length > 0 && <p className={styles.details}>{details.join(" · ")}</p>}
      <DetailControls device={device} disabled={disabled} onControl={onControl} />
    </div>
  </div>, document.body);
}
