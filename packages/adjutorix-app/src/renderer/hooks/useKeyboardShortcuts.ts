// @ts-nocheck
import { useEffect, useRef } from "react";

export type KeyboardShortcutScope = string;
export type KeyboardShortcutBinding = Record<string, any>;
export type KeyboardBinding = KeyboardShortcutBinding;
export type KeyboardShortcut = KeyboardShortcutBinding;
export type KeyboardShortcutEvent = KeyboardEvent;
export type UseKeyboardShortcutsOptions = Record<string, any>;

type NormalizedBinding = {
  id: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  modKey: boolean;
  scopes: string[];
  raw: KeyboardShortcutBinding;
};

const TEXT_ENTRY_SELECTOR =
  'input, textarea, select, [role="textbox"]';

function toArray(value: any): any[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function toBool(value: any): boolean {
  return value === true;
}

function normalizeKey(value: any): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase();

  if (lower === " ") return "space";
  if (lower === "esc") return "escape";
  if (lower === "return") return "enter";
  if (lower === "del") return "delete";
  if (lower === "arrowup") return "up";
  if (lower === "arrowdown") return "down";
  if (lower === "arrowleft") return "left";
  if (lower === "arrowright") return "right";
  if (/^key[a-z]$/.test(raw)) return raw.slice(3).toLowerCase();
  if (/^digit[0-9]$/.test(raw)) return raw.slice(5);
  if (/^numpad[0-9]$/.test(raw)) return raw.slice(6);
  return lower;
}

function eventKey(event: KeyboardEvent): string {
  const key = normalizeKey(event.key);
  const code = normalizeKey(event.code);
  return key || code;
}

function parseShortcutString(value: any): Partial<NormalizedBinding> {
  const spec = {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    modKey: false,
  };

  if (typeof value !== "string") return spec;

  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const token = part.toLowerCase();

    if (token === "ctrl" || token === "control") {
      spec.ctrlKey = true;
    } else if (token === "cmd" || token === "command" || token === "meta") {
      spec.metaKey = true;
    } else if (token === "alt" || token === "option") {
      spec.altKey = true;
    } else if (token === "shift") {
      spec.shiftKey = true;
    } else if (token === "mod" || token === "primary") {
      spec.modKey = true;
    } else {
      spec.key = normalizeKey(part);
    }
  }

  return spec;
}

export function normalizeBinding(binding: KeyboardShortcutBinding): NormalizedBinding {
  const source = binding ?? {};
  const stringSpec =
    typeof source === "string"
      ? source
      : source.shortcut ??
        source.accelerator ??
        source.keybinding ??
        source.chord ??
        source.keys ??
        source.key ??
        "";

  const parsed = parseShortcutString(Array.isArray(stringSpec) ? stringSpec[0] : stringSpec);

  const scopes = [
    ...toArray(source.scope),
    ...toArray(source.scopes),
    ...toArray(source.context),
    ...toArray(source.contexts),
  ]
    .map((scope) => String(scope).trim())
    .filter(Boolean);

  return {
    id: String(source.id ?? source.command ?? source.name ?? stringSpec ?? "shortcut"),
    key: normalizeKey(source.key ?? parsed.key),
    ctrlKey: Boolean(source.ctrlKey ?? source.ctrl ?? parsed.ctrlKey),
    metaKey: Boolean(source.metaKey ?? source.meta ?? source.cmd ?? parsed.metaKey),
    altKey: Boolean(source.altKey ?? source.alt ?? source.option ?? parsed.altKey),
    shiftKey: Boolean(source.shiftKey ?? source.shift ?? parsed.shiftKey),
    modKey: Boolean(source.modKey ?? source.mod ?? parsed.modKey),
    scopes: scopes.length > 0 ? scopes : ["global"],
    raw: source,
  };
}

export function clearChordState() {
  return {
    bindingIds: [],
    activeBindingIds: [],
    candidateBindingIds: [],
    consumed: [],
    sequence: [],
    strokes: [],
    steps: [],
    startedAtMs: 0,
    expiresAtMs: 0,
    partial: false,
  };
}

function normalizeArgs(first: any, second: any): { bindings: any[]; options: Record<string, any> } {
  if (Array.isArray(first)) {
    return { bindings: first, options: second ?? {} };
  }

  if (first && typeof first === "object") {
    const optionBindings =
      first.bindings ??
      first.shortcuts ??
      first.staticBindings ??
      first.items ??
      first.commands ??
      first.keybindings;

    if (optionBindings !== undefined) {
      return { bindings: toArray(optionBindings), options: { ...first, ...(second ?? {}) } };
    }

    if (
      first.key !== undefined ||
      first.keys !== undefined ||
      first.shortcut !== undefined ||
      first.accelerator !== undefined ||
      first.handler !== undefined
    ) {
      return { bindings: [first], options: second ?? {} };
    }

    return { bindings: [], options: { ...first, ...(second ?? {}) } };
  }

  return { bindings: [], options: second ?? {} };
}

function isElementLike(value: unknown): value is Element {
  return Boolean(
    value &&
      typeof value === "object" &&
      "nodeType" in value &&
      (value as { nodeType?: unknown }).nodeType === 1 &&
      typeof (value as { closest?: unknown }).closest === "function",
  );
}

function isContentEditableElement(value: Element): boolean {
  let element: Element | null = value;

  while (element) {
    const htmlElement = element as HTMLElement;
    const attr = element.getAttribute("contenteditable");
    const prop = htmlElement.contentEditable;

    if (
      htmlElement.isContentEditable ||
      attr === "" ||
      attr === "true" ||
      attr === "plaintext-only" ||
      prop === "true" ||
      prop === "plaintext-only"
    ) {
      return true;
    }

    if (attr === "false" || prop === "false") {
      return false;
    }

    element = element.parentElement;
  }

  return false;
}

function isTextEntryElement(value: unknown): boolean {
  if (!isElementLike(value)) return false;

  if (isContentEditableElement(value)) return true;

  const match = value.closest(TEXT_ENTRY_SELECTOR);
  if (!match) return false;

  const tagName = match.tagName.toLowerCase();
  if (tagName !== "input") return true;

  const type = ((match as HTMLInputElement).type || "text").toLowerCase();
  return ![
    "button",
    "checkbox",
    "color",
    "file",
    "hidden",
    "image",
    "radio",
    "range",
    "reset",
    "submit",
  ].includes(type);
}

function isTextEntryTarget(event: KeyboardEvent): boolean {
  const path =
    typeof event.composedPath === "function" ? event.composedPath() : [];

  if (path.some(isTextEntryElement)) return true;
  if (isTextEntryElement(event.target)) return true;

  if (typeof document !== "undefined") {
    if (isTextEntryElement(document.activeElement)) return true;

    const selection = document.getSelection?.();
    const anchorNode = selection?.anchorNode ?? null;
    const anchorElement =
      anchorNode && "nodeType" in anchorNode && anchorNode.nodeType === 1
        ? anchorNode
        : anchorNode?.parentElement;

    if (isTextEntryElement(anchorElement)) return true;
  }

  return false;
}

function isTrustedEnough(binding: KeyboardShortcutBinding, options: Record<string, any>): boolean {
  const requiresTrust =
    binding.trustedOnly === true ||
    binding.requiresTrust === true ||
    binding.requireTrust === true ||
    binding.requireTrusted === true ||
    binding.requiresTrustedWorkspace === true ||
    binding.trust === "trusted" ||
    binding.trustLevel === "trusted";

  if (!requiresTrust) return true;
  return options.trusted === true || options.isTrusted === true || options.trustLevel === "trusted";
}

function scopeMatches(binding: NormalizedBinding, options: Record<string, any>): boolean {
  const active = toArray(options.activeScopes ?? options.scopes ?? options.scope)
    .map((scope) => String(scope).trim())
    .filter(Boolean);

  const required = binding.scopes.length > 0 ? binding.scopes : ["global"];

  if (active.length === 0) {
    return required.some((scope) => scope === "global" || scope === "*" || scope === "all");
  }

  if (active.includes("*") || active.includes("all")) return true;

  return required.some((requiredScope) => {
    if (requiredScope === "global" || requiredScope === "*" || requiredScope === "all") return true;

    return active.some((activeScope) => {
      return (
        activeScope === requiredScope ||
        activeScope.startsWith(`${requiredScope}:`) ||
        activeScope.startsWith(`${requiredScope}.`) ||
        activeScope.startsWith(`${requiredScope}/`) ||
        requiredScope.startsWith(`${activeScope}:`) ||
        requiredScope.startsWith(`${activeScope}.`) ||
        requiredScope.startsWith(`${activeScope}/`)
      );
    });
  });
}

function modifiersMatch(binding: NormalizedBinding, event: KeyboardEvent): boolean {
  if (binding.modKey) {
    if (!(event.ctrlKey || event.metaKey)) return false;
  } else {
    if (event.ctrlKey !== binding.ctrlKey) return false;
    if (event.metaKey !== binding.metaKey) return false;
  }

  return event.altKey === binding.altKey && event.shiftKey === binding.shiftKey;
}

function keyMatches(binding: NormalizedBinding, event: KeyboardEvent): boolean {
  const wanted = binding.key;
  if (!wanted) return false;

  const actualKey = eventKey(event);
  const actualCode = normalizeKey(event.code);

  return wanted === actualKey || wanted === actualCode;
}

function shouldPreventDefault(binding: KeyboardShortcutBinding, options: Record<string, any>): boolean {
  if (binding.preventDefault === false) return false;
  if (options.preventDefault === false) return false;
  return true;
}

function isEnabled(value: any, fallback = true): boolean {
  if (typeof value === "function") return value();
  if (value === undefined || value === null) return fallback;
  return Boolean(value);
}

function invokeBinding(binding: KeyboardShortcutBinding, normalized: NormalizedBinding, event: KeyboardEvent, options: Record<string, any>): void {
  if (typeof binding.handler === "function") binding.handler(event, normalized);
  if (typeof binding.onInvoke === "function") binding.onInvoke(normalized, event);
  if (typeof binding.action === "function") binding.action(event, normalized);
  if (typeof binding.run === "function") binding.run(event, normalized);
  if (typeof options.onInvoke === "function") options.onInvoke(normalized, event);
}

export function useKeyboardShortcuts(first?: any, second?: any) {
  const configRef = useRef(normalizeArgs(first, second));
  const dynamicBindingsRef = useRef(new Map<string, KeyboardShortcutBinding>());

  configRef.current = normalizeArgs(first, second);

  useEffect(() => {
    const target =
      configRef.current.options.target ??
      configRef.current.options.eventTarget ??
      configRef.current.options.window ??
      window;

    if (!target?.addEventListener) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const { bindings, options } = configRef.current;

      if (!isEnabled(options.enabled, true)) return;

      const allBindings = [
        ...bindings,
        ...Array.from(dynamicBindingsRef.current.values()),
      ];

      for (const rawBinding of allBindings) {
        const binding = rawBinding ?? {};
        const normalized = normalizeBinding(binding);

        if (!isEnabled(binding.enabled, true)) continue;
        if (event.repeat && (binding.repeat === false || binding.repeatable === false || binding.allowRepeat === false)) continue;

        const allowTextEntry = Boolean(binding.allowInTextInput ?? options.allowInTextInput);
        if (!allowTextEntry && isTextEntryTarget(event)) continue;

        if (!isTrustedEnough(binding, options)) {
          if (typeof options.onBlocked === "function") options.onBlocked(normalized, event, "trust");
          continue;
        }

        if (!scopeMatches(normalized, options)) continue;
        if (!modifiersMatch(normalized, event)) continue;
        if (!keyMatches(normalized, event)) continue;

        if (shouldPreventDefault(binding, options)) event.preventDefault();
        invokeBinding(binding, normalized, event, options);
        return;
      }
    };

    const listenerOptions = false;

    target.addEventListener("keydown", onKeyDown, listenerOptions);
    return () => target.removeEventListener("keydown", onKeyDown, listenerOptions);
  }, []);

  return {
    register(binding: KeyboardShortcutBinding) {
      const normalized = normalizeBinding(binding);
      dynamicBindingsRef.current.set(normalized.id, binding);
      return () => dynamicBindingsRef.current.delete(normalized.id);
    },
    unregister(id: string) {
      dynamicBindingsRef.current.delete(id);
    },
    clear() {
      dynamicBindingsRef.current.clear();
    },
  };
}

export default useKeyboardShortcuts;
