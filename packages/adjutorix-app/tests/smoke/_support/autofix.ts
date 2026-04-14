const g = globalThis as any;

if (typeof g.structuredClone !== "function") {
  g.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
}

if (typeof g.ResizeObserver === "undefined") {
  g.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

if (typeof g.IntersectionObserver === "undefined") {
  g.IntersectionObserver = class IntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): never[] { return []; }
    readonly root = null;
    readonly rootMargin = "";
    readonly thresholds = [];
  };
}

if (typeof window !== "undefined") {
  const w = window as any;

  if (typeof w.matchMedia !== "function") {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener(): void {},
      removeListener(): void {},
      addEventListener(): void {},
      removeEventListener(): void {},
      dispatchEvent(): boolean { return false; },
    });
  }

  if (typeof w.scrollTo !== "function") {
    w.scrollTo = (): void => {};
  }

  if (typeof w.open !== "function") {
    w.open = (): null => null;
  }
}

if (typeof HTMLElement !== "undefined" && !HTMLElement.prototype.scrollIntoView) {
  HTMLElement.prototype.scrollIntoView = function scrollIntoView(): void {};
}

if (typeof Element !== "undefined") {
  const proto = Element.prototype as any;

  if (typeof proto.hasPointerCapture !== "function") {
    proto.hasPointerCapture = (): boolean => false;
  }
  if (typeof proto.setPointerCapture !== "function") {
    proto.setPointerCapture = (): void => {};
  }
  if (typeof proto.releasePointerCapture !== "function") {
    proto.releasePointerCapture = (): void => {};
  }
}

export {};
