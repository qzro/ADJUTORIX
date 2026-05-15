export type ShortcutModifier = "ctrl" | "meta" | "alt" | "shift";

export type ShortcutObject = {
  key: string;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

export type ShortcutLike =
  | string
  | ShortcutObject
  | {
      key: string;
      modifiers?: ShortcutModifier[];
      ctrl?: boolean;
      meta?: boolean;
      alt?: boolean;
      shift?: boolean;
    };

const MODIFIER_ORDER: ShortcutModifier[] = ["ctrl", "meta", "alt", "shift"];

const MODIFIER_ALIASES: Record<string, ShortcutModifier> = {
  ctrl: "ctrl",
  control: "ctrl",
  cmd: "meta",
  command: "meta",
  meta: "meta",
  win: "meta",
  windows: "meta",
  option: "alt",
  opt: "alt",
  alt: "alt",
  shift: "shift",
};

const KEY_ALIASES: Record<string, string> = {
  esc: "escape",
  escape: "escape",
  return: "enter",
  enter: "enter",
  del: "delete",
  delete: "delete",
  backspace: "backspace",
  spacebar: "space",
  space: "space",
  " ": "space",
  arrowup: "arrowup",
  up: "arrowup",
  arrowdown: "arrowdown",
  down: "arrowdown",
  arrowleft: "arrowleft",
  left: "arrowleft",
  arrowright: "arrowright",
  right: "arrowright",
};

const KEY_LABELS: Record<string, string> = {
  escape: "Escape",
  enter: "Enter",
  delete: "Delete",
  backspace: "Backspace",
  tab: "Tab",
  space: "Space",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
};

function emptyShortcut(key: string): ShortcutObject {
  return { key, ctrl: false, meta: false, alt: false, shift: false };
}

export function normalizeKey(input: string): string {
  const raw = String(input ?? "");
  const trimmed = raw === " " ? " " : raw.trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();

  if (KEY_ALIASES[lower]) return KEY_ALIASES[lower];

  if (/^f\d{1,2}$/.test(lower)) return lower;
  if (lower.length === 1) return lower;

  return lower;
}

export function sortShortcutModifiers(modifiers: readonly ShortcutModifier[]): ShortcutModifier[] {
  const set = new Set(modifiers);
  return MODIFIER_ORDER.filter((modifier) => set.has(modifier));
}

export function parseShortcut(chord: string): ShortcutObject {
  if (typeof chord !== "string") {
    throw new Error("Shortcut chord must be a string.");
  }

  if (chord.trim() === "") {
    throw new Error("Shortcut chord cannot be empty.");
  }

  const parts = chord.split("+");
  if (parts.some((part) => part.trim() === "")) {
    throw new Error(`Malformed shortcut chord: ${chord}`);
  }

  const modifiers = new Set<ShortcutModifier>();
  const keys: string[] = [];

  for (const part of parts) {
    const token = part.trim();
    const lower = token.toLowerCase();
    const modifier = MODIFIER_ALIASES[lower];

    if (modifier) {
      modifiers.add(modifier);
      continue;
    }

    if (parts.length > 1 && /^[a-z][a-z0-9_-]*$/i.test(token) && token.length > 1 && !KEY_ALIASES[lower] && !/^f\d{1,2}$/i.test(token)) {
      throw new Error(`Unknown shortcut modifier or key token: ${token}`);
    }

    keys.push(normalizeKey(token));
  }

  if (keys.length !== 1 || !keys[0]) {
    throw new Error(`Shortcut chord must contain exactly one key: ${chord}`);
  }

  return {
    key: keys[0],
    ctrl: modifiers.has("ctrl"),
    meta: modifiers.has("meta"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  };
}

export function normalizeShortcut(shortcut: ShortcutLike): ShortcutObject {
  if (typeof shortcut === "string") return parseShortcut(shortcut);

  const normalized = emptyShortcut(normalizeKey(shortcut.key));

  const modifierList = "modifiers" in shortcut ? shortcut.modifiers : undefined;

  if (Array.isArray(modifierList)) {
    const modifiers = new Set(sortShortcutModifiers(modifierList));
    normalized.ctrl = modifiers.has("ctrl");
    normalized.meta = modifiers.has("meta");
    normalized.alt = modifiers.has("alt");
    normalized.shift = modifiers.has("shift");
  }

  normalized.ctrl = Boolean(shortcut.ctrl ?? normalized.ctrl);
  normalized.meta = Boolean(shortcut.meta ?? normalized.meta);
  normalized.alt = Boolean(shortcut.alt ?? normalized.alt);
  normalized.shift = Boolean(shortcut.shift ?? normalized.shift);

  if (!normalized.key) {
    throw new Error("Shortcut key cannot be empty.");
  }

  return normalized;
}

function keyLabel(key: string): string {
  const normalized = normalizeKey(key);
  if (KEY_LABELS[normalized]) return KEY_LABELS[normalized];
  if (/^f\d{1,2}$/.test(normalized)) return normalized.toUpperCase();
  if (normalized.length === 1) return normalized.toUpperCase();
  return normalized;
}

export function stringifyShortcut(shortcut: ShortcutLike): string {
  const normalized = normalizeShortcut(shortcut);
  const parts: string[] = [];

  if (normalized.ctrl) parts.push("Ctrl");
  if (normalized.meta) parts.push("Meta");
  if (normalized.alt) parts.push("Alt");
  if (normalized.shift) parts.push("Shift");

  parts.push(keyLabel(normalized.key));
  return parts.join("+");
}

export function equalShortcut(left: ShortcutLike, right: ShortcutLike): boolean {
  const a = normalizeShortcut(left);
  const b = normalizeShortcut(right);

  return (
    a.key === b.key &&
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.alt === b.alt &&
    a.shift === b.shift
  );
}

export function eventToShortcut(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): ShortcutObject {
  return {
    key: normalizeKey(event.key),
    ctrl: Boolean(event.ctrlKey),
    meta: Boolean(event.metaKey),
    alt: Boolean(event.altKey),
    shift: Boolean(event.shiftKey),
  };
}

export function matchesShortcut(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
  shortcut: ShortcutLike,
): boolean {
  return equalShortcut(eventToShortcut(event), shortcut);
}

export function isTextInputLikeTarget(target: EventTarget | null): boolean {
  let node = target as HTMLElement | null;

  while (node) {
    const tagName = node.tagName?.toLowerCase();

    if (tagName === "input" || tagName === "textarea" || tagName === "select") {
      return true;
    }

    if (node.isContentEditable || node.getAttribute?.("contenteditable") === "true") {
      return true;
    }

    node = node.parentElement;
  }

  return false;
}
