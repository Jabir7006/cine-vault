export const MAX_CAPTION_BYTES = 512 * 1_024;
export type CaptionFormat = "srt" | "vtt";

export class CaptionError extends Error {
  constructor() {
    super("Invalid or unsupported caption");
    this.name = "CaptionError";
  }
}

function invalid(): never { throw new CaptionError(); }

function decode(input: string | Uint8Array): string {
  let text: string;
  if (typeof input === "string") {
    if (input.length > MAX_CAPTION_BYTES || Buffer.byteLength(input, "utf8") > MAX_CAPTION_BYTES) invalid();
    // Do not silently turn malformed UTF-16 into replacement characters.
    if (Buffer.from(input, "utf8").toString("utf8") !== input) invalid();
    text = input;
  } else {
    if (!(input instanceof Uint8Array) || input.byteLength > MAX_CAPTION_BYTES) invalid();
    try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(input); } catch { return invalid(); }
  }
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
}

interface Time { milliseconds: number; canonical: string }

function parseTime(value: string, format: CaptionFormat): Time {
  const match = format === "srt"
    ? /^(\d{2,6}):([0-5]\d):([0-5]\d),(\d{3})$/.exec(value)
    : /^(?:(\d{2,6}):)?([0-5]\d):([0-5]\d)\.(\d{3})$/.exec(value);
  if (!match) invalid();
  const hours = Number(match[1] ?? "0");
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const fraction = Number(match[4]);
  return {
    milliseconds: ((hours * 60 + minutes) * 60 + seconds) * 1_000 + fraction,
    canonical: `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(fraction).padStart(3, "0")}`,
  };
}

function percentage(value: string): boolean {
  return /^(?:\d{1,3})(?:\.\d+)?%$/.test(value) && Number(value.slice(0, -1)) <= 100;
}

function validateSettings(settings: string): void {
  const seen = new Set<string>();
  for (const setting of settings.trim().split(/[ \t]+/)) {
    const separator = setting.indexOf(":");
    if (separator < 1) invalid();
    const key = setting.slice(0, separator);
    const value = setting.slice(separator + 1);
    if (seen.has(key)) invalid();
    seen.add(key);
    const [position, alignment] = value.split(",");
    if (!position || value.split(",").length > 2) invalid();
    switch (key) {
      case "vertical": if (!/^(rl|lr)$/.test(value)) invalid(); break;
      case "align": if (!/^(start|center|end|left|right)$/.test(value)) invalid(); break;
      case "size": if (!percentage(value)) invalid(); break;
      case "position":
        if (!percentage(position) || (alignment !== undefined && !/^(line-left|center|line-right|auto)$/.test(alignment))) invalid();
        break;
      case "line":
        if (!(position === "auto" || /^-?\d{1,6}$/.test(position) || percentage(position)) ||
            (alignment !== undefined && !/^(start|center|end)$/.test(alignment))) invalid();
        break;
      case "region": if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) invalid(); break;
      default: invalid();
    }
  }
}

function timeline(line: string, format: CaptionFormat): string {
  const match = /^([^ \t]+)[ \t]+-->[ \t]+([^ \t]+)(?:[ \t]+(.+))?$/.exec(line);
  if (!match?.[1] || !match[2]) invalid();
  const start = parseTime(match[1], format);
  const end = parseTime(match[2], format);
  if (start.milliseconds > end.milliseconds) invalid();
  if (match[3] !== undefined) {
    if (format !== "vtt") invalid();
    validateSettings(match[3]);
  }
  // Never retain input cue settings, identifiers or positioning metadata.
  return `${start.canonical} --> ${end.canonical}`;
}

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&", lt: "<", gt: ">", nbsp: " ", lrm: "‎", rlm: "‏", quot: '"', apos: "'",
};

function stripMarkup(text: string): string {
  const pieces: string[] = [];
  let position = 0;
  let suppressed: string | undefined;
  // A linear scan avoids quadratic regex searches on unterminated '<' tags.
  while (position < text.length) {
    const start = text.indexOf("<", position);
    if (start === -1) {
      if (!suppressed) pieces.push(text.slice(position));
      break;
    }
    if (!suppressed) pieces.push(text.slice(position, start));
    const end = text.indexOf(">", start + 1);
    if (end === -1) break; // Drop an unfinished tag, never emit its remainder.
    const tag = text.slice(start + 1, end);
    const executable = /^\s*(\/?)\s*(script|style)\b/i.exec(tag);
    if (executable) {
      const name = executable[2]!.toLowerCase();
      if (!executable[1] && !suppressed) suppressed = name;
      else if (executable[1] && suppressed === name) suppressed = undefined;
    }
    position = end + 1;
  }
  return pieces.join("");
}

function plainText(lines: string[]): string {
  let text = lines.join(" ").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|nbsp|lrm|rlm|quot|apos);/gi, (entity: string, code: string) => {
    if (!code.startsWith("#")) return ENTITIES[code.toLowerCase()] ?? entity;
    const value = code[1]?.toLowerCase() === "x" ? Number.parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isSafeInteger(value) && value >= 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value) : "";
  });
  text = stripMarkup(text)
    .replace(/-->/g, "→")
    .replace(/[<>]/g, "")
    // Includes C0/C1 controls, Unicode format/bidi controls and line separators.
    .replace(/[\p{Cc}\p{Cf}]/gu, " ")
    .replace(/\s+/gu, " ").trim();
  // Flatten to one line and destroy timeline delimiters, even entity-encoded ones.
  // Escaping '&' prevents remaining entities from acquiring markup semantics.
  text = text.replace(/-->/g, "→").replace(/&/g, "&amp;");
  if (!text) invalid();
  return text;
}

/** Offline, bounded UTF-8 SRT/WebVTT conversion; never fetches a caption URL. */
export function convertCaptionToWebVtt(input: string | Uint8Array, format: CaptionFormat): string {
  if (format !== "srt" && format !== "vtt") invalid();
  let text = decode(input);
  if (format === "vtt") {
    const lines = text.split("\n");
    const header = lines.shift();
    if (!header || !/^WEBVTT(?:[ \t][^\x00-\x1f]*)?$/.test(header) || header.includes("-->")) invalid();
    if (lines.length && lines.shift() !== "") invalid();
    text = lines.join("\n");
  } else if (text.startsWith("WEBVTT")) invalid();

  const cues: string[] = [];
  for (const block of text.split(/\n[ \t]*\n+/)) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    // These WebVTT metadata blocks are deliberately omitted, never copied.
    if (format === "vtt" && /^(NOTE(?:[ \t].*)?|STYLE|REGION)$/.test(lines[0] ?? "")) continue;
    if (format === "srt") {
      const index = lines.shift();
      if (!index || !/^\d{1,10}$/.test(index)) invalid();
    } else if (!lines[0]?.includes("-->")) {
      const identifier = lines.shift();
      if (!identifier || /[\p{Cc}\p{Cf}]/u.test(identifier)) invalid();
    }
    const timing = lines.shift();
    if (!timing || lines.length === 0) invalid();
    // Trailing line terminators are harmless; blank lines split cue blocks.
    while (lines[lines.length - 1] === "") lines.pop();
    if (!lines.length) invalid();
    cues.push(`${timeline(timing, format)}\n${plainText(lines)}`);
  }
  // An empty valid WebVTT file is valid; an empty SRT has no valid cue syntax.
  if (format === "srt" && cues.length === 0) invalid();
  const output = `WEBVTT\n\n${cues.length ? `${cues.join("\n\n")}\n` : ""}`;
  if (Buffer.byteLength(output, "utf8") > MAX_CAPTION_BYTES) invalid();
  return output;
}
