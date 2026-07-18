import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const LEGACY_SURFACE_SELECTOR = '[id^="adjutorix-ai-runway-"]';
const COMMAND_DECK_EVENT = "adjutorix:product-command-deck:toggle";

type SurfaceCategory =
  | "Current"
  | "Verify"
  | "Archive"
  | "Finality"
  | "Certificate"
  | "Publication"
  | "Authority";

type ProductSurface = {
  id: string;
  title: string;
  description: string;
  category: SurfaceCategory;
  isCurrent: boolean;
  order: number;
};

const CATEGORY_ORDER: SurfaceCategory[] = [
  "Current",
  "Verify",
  "Archive",
  "Finality",
  "Certificate",
  "Publication",
  "Authority",
];

function compactText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/gu, " ").trim();
}

function titleFromIdentifier(identifier: string): string {
  return identifier
    .replace(/^adjutorix-ai-runway-/u, "")
    .split("-")
    .filter(Boolean)
    .map((word) => {
      if (word === "ai") return "AI";
      if (word === "sha256") return "SHA-256";
      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function categoryFor(identifier: string): SurfaceCategory {
  if (identifier.includes("distribution-publication-publication")) {
    return "Current";
  }

  if (identifier.includes("verifier")) {
    return "Verify";
  }

  if (
    identifier.includes("archive-seal") ||
    identifier.includes("archive-bundle")
  ) {
    return "Archive";
  }

  if (identifier.includes("finality")) {
    return "Finality";
  }

  if (identifier.includes("certificate")) {
    return "Certificate";
  }

  if (identifier.includes("manifest") || identifier.includes("publication")) {
    return "Publication";
  }

  return "Authority";
}

function productSurfaceFromElement(
  element: HTMLElement,
  order: number,
): ProductSurface {
  const heading = compactText(
    element.querySelector<HTMLElement>("h2, h1")?.textContent,
  );

  const description = compactText(
    element.querySelector<HTMLElement>("p")?.textContent,
  );

  const isCurrent = element.id.includes("distribution-publication-publication");

  return {
    id: element.id,
    title: heading || titleFromIdentifier(element.id),
    description:
      description ||
      "Mounted Adjutorix authority surface with governed runtime power.",
    category: isCurrent ? "Current" : categoryFor(element.id),
    isCurrent,
    order,
  };
}

function surfaceSignature(surfaces: ProductSurface[]): string {
  return surfaces
    .map((surface) => `${surface.id}|${surface.title}|${surface.description}`)
    .join("\n");
}

export function ProductSurfaceOrchestrator(): JSX.Element {
  const [deckOpen, setDeckOpen] = useState(false);
  const [surfaces, setSurfaces] = useState<ProductSurface[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SurfaceCategory | "All">("Current");

  const signatureRef = useRef("");
  const lastDiscoveryCountRef = useRef(-1);

  const discoverSurfaces = useCallback(() => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>(LEGACY_SURFACE_SELECTOR),
    );

    const discovered = elements.map((element, order) => {
      element.dataset.adjutorixSurfaceManaged = "true";

      if (!element.dataset.adjutorixSurfaceActive) {
        element.dataset.adjutorixSurfaceActive = "false";
      }

      element.setAttribute("tabindex", "-1");

      return productSurfaceFromElement(element, order);
    });

    const nextSignature = surfaceSignature(discovered);

    if (nextSignature !== signatureRef.current) {
      signatureRef.current = nextSignature;
      setSurfaces(discovered);
    }

    setActiveId((current) => {
      if (current && !discovered.some((surface) => surface.id === current)) {
        return null;
      }

      return current;
    });

    if (
      discovered.length !== lastDiscoveryCountRef.current &&
      discovered.length > 0
    ) {
      lastDiscoveryCountRef.current = discovered.length;

      console.info(
        "ADJUTORIX_PRODUCT_SURFACES_DISCOVERED",
        JSON.stringify({
          source: "adjutorix-product-command-deck",
          count: discovered.length,
          current: discovered.filter((surface) => surface.isCurrent).length,
          selector: LEGACY_SURFACE_SELECTOR,
        }),
      );
    }
  }, []);

  const closeActiveSurface = useCallback(() => {
    setActiveId(null);
  }, []);

  const toggleDeck = useCallback(() => {
    setDeckOpen((current) => !current);
  }, []);

  const activateSurface = useCallback((identifier: string) => {
    setActiveId(identifier);
    setDeckOpen(false);

    window.setTimeout(() => {
      document.getElementById(identifier)?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    document.body.classList.add("adjutorix-product-command-deck-mode");

    console.info(
      "ADJUTORIX_PRODUCT_COMMAND_DECK_MOUNTED",
      JSON.stringify({
        source: "adjutorix-product-command-deck",
        manages: LEGACY_SURFACE_SELECTOR,
        mode: "single-active-surface",
        shortcut: "Meta+Shift+P",
        preservesMountedAuthority: true,
      }),
    );

    return () => {
      document.body.classList.remove("adjutorix-product-command-deck-mode");
    };
  }, []);

  useEffect(() => {
    discoverSurfaces();

    const observer = new MutationObserver(() => {
      discoverSurfaces();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [discoverSurfaces]);

  useEffect(() => {
    const elements = document.querySelectorAll<HTMLElement>(
      LEGACY_SURFACE_SELECTOR,
    );

    elements.forEach((element) => {
      const isActive = element.id === activeId;

      element.dataset.adjutorixSurfaceManaged = "true";
      element.dataset.adjutorixSurfaceActive = isActive ? "true" : "false";

      element.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }, [activeId, surfaces]);

  useEffect(() => {
    const handleDeckEvent = (): void => {
      toggleDeck();
    };

    const handleKeyboard = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "p") {
        event.preventDefault();
        toggleDeck();
        return;
      }

      if (event.key === "Escape") {
        if (activeId) {
          closeActiveSurface();
          return;
        }

        setDeckOpen(false);
      }
    };

    window.addEventListener(COMMAND_DECK_EVENT, handleDeckEvent);
    window.addEventListener("keydown", handleKeyboard);

    return () => {
      window.removeEventListener(COMMAND_DECK_EVENT, handleDeckEvent);
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, [activeId, closeActiveSurface, toggleDeck]);

  const orderedSurfaces = useMemo(() => {
    return [...surfaces].sort((left, right) => {
      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      const leftCategory = CATEGORY_ORDER.indexOf(left.category);
      const rightCategory = CATEGORY_ORDER.indexOf(right.category);

      if (leftCategory !== rightCategory) {
        return leftCategory - rightCategory;
      }

      return right.order - left.order;
    });
  }, [surfaces]);

  const visibleSurfaces = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return orderedSurfaces.filter((surface) => {
      const categoryMatches =
        category === "All" ||
        surface.category === category ||
        (category === "Current" && surface.isCurrent);

      if (!categoryMatches) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return [surface.title, surface.description, surface.id, surface.category]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [category, orderedSurfaces, query]);

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.id === activeId) || null,
    [activeId, surfaces],
  );

  const currentCount = useMemo(
    () => surfaces.filter((surface) => surface.isCurrent).length,
    [surfaces],
  );

  return (
    <>
      {activeSurface ? (
        <button
          type="button"
          className="adjutorix-product-surface-backdrop"
          aria-label="Close active power surface"
          onClick={closeActiveSurface}
        />
      ) : null}

      <nav
        className="adjutorix-product-command-dock"
        aria-label="Adjutorix product power controls"
      >
        <button
          type="button"
          className="adjutorix-product-command-dock__power"
          aria-label="Open Adjutorix power deck"
          data-open={deckOpen ? "true" : "false"}
          onClick={toggleDeck}
        >
          <span>Power</span>
          <strong>{surfaces.length}</strong>
        </button>

        {activeSurface ? (
          <button
            type="button"
            className="adjutorix-product-command-dock__active"
            aria-label="Close active Adjutorix power surface"
            onClick={closeActiveSurface}
          >
            <span>Active</span>
            <strong>{activeSurface.title}</strong>
            <b>Close</b>
          </button>
        ) : null}
      </nav>

      {deckOpen ? (
        <aside
          className="adjutorix-product-command-deck"
          aria-label="Adjutorix power command deck"
        >
          <header className="adjutorix-product-command-deck__header">
            <div>
              <span>ADJUTORIX PRODUCT OS</span>
              <h2>Power Command Deck</h2>
              <p>Every mounted authority surface. One controlled workspace.</p>
            </div>

            <button
              type="button"
              aria-label="Close Adjutorix power deck"
              onClick={() => setDeckOpen(false)}
            >
              ×
            </button>
          </header>

          <section className="adjutorix-product-command-deck__metrics">
            <article>
              <strong>{surfaces.length}</strong>
              <span>Mounted powers</span>
            </article>

            <article>
              <strong>{currentCount}</strong>
              <span>Current chain</span>
            </article>

            <article>
              <strong>{activeSurface ? "1" : "0"}</strong>
              <span>Active surface</span>
            </article>
          </section>

          <section className="adjutorix-product-command-deck__search">
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search every Adjutorix power..."
              aria-label="Search Adjutorix power surfaces"
              autoFocus
            />

            {query ? (
              <button
                type="button"
                aria-label="Clear power-surface search"
                onClick={() => setQuery("")}
              >
                Clear
              </button>
            ) : null}
          </section>

          <nav
            className="adjutorix-product-command-deck__filters"
            aria-label="Power-surface categories"
          >
            {(["All", ...CATEGORY_ORDER] as const).map((item) => (
              <button
                key={item}
                type="button"
                data-active={category === item ? "true" : "false"}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </nav>

          <section
            className="adjutorix-product-command-deck__list"
            aria-live="polite"
          >
            {visibleSurfaces.length ? (
              visibleSurfaces.map((surface) => (
                <button
                  key={surface.id}
                  type="button"
                  className="adjutorix-product-command-deck__surface"
                  data-current={surface.isCurrent ? "true" : "false"}
                  data-active={activeId === surface.id ? "true" : "false"}
                  aria-label={`Open ${surface.title}`}
                  onClick={() => activateSurface(surface.id)}
                >
                  <span className="adjutorix-product-command-deck__surface-category">
                    {surface.category}
                  </span>

                  <strong>{surface.title}</strong>

                  <p>{surface.description}</p>

                  <small>
                    {surface.isCurrent
                      ? "Current publication authority"
                      : "Mounted authority power"}
                  </small>
                </button>
              ))
            ) : (
              <article className="adjutorix-product-command-deck__empty">
                <strong>No matching power surface</strong>
                <p>
                  Change the search or category. Mounted authority remains
                  preserved.
                </p>
              </article>
            )}
          </section>

          <footer className="adjutorix-product-command-deck__footer">
            <span>⌘⇧P</span>
            <p>Toggle deck · Escape closes the active surface</p>
          </footer>
        </aside>
      ) : null}
    </>
  );
}
