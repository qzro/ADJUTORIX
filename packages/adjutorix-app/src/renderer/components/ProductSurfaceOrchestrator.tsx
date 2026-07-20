import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

const LEGACY_RUNWAY_SELECTOR = '[id^="adjutorix-ai-runway-"]';
const PRODUCT_SURFACE_SELECTOR = '[id^="adjutorix-ai-"]';

const COMMAND_DECK_EVENT = "adjutorix:product-command-deck:toggle";
const GUIDED_SHELL_EVENT = "adjutorix:guided-product-shell:open";
const GUIDED_MISSION_EVENT = "adjutorix:guided-mission:launch";
const GUIDED_MISSION_STORAGE_KEY = "adjutorix.guided_mission.v1";

// MOVE214_WORKFLOW_ACCESSIBILITY_FIXED=true

const WORKFLOW_MODES = [
  "Understand",
  "Plan",
  "Build",
  "Verify",
  "Ship",
] as const;

type WorkflowMode = (typeof WORKFLOW_MODES)[number];
type WorkflowFilter = WorkflowMode | "All";

const SURFACE_CATEGORIES = [
  "Chat",
  "Context",
  "Change",
  "Verify",
  "Run",
  "Evidence",
  "Archive",
  "Finality",
  "Certificate",
  "Publication",
  "Authority",
] as const;

type SurfaceCategory = (typeof SURFACE_CATEGORIES)[number];

const CATEGORY_FILTERS = [
  "All",
  "Primary",
  "Current",
  ...SURFACE_CATEGORIES,
] as const;

type CategoryFilter = (typeof CATEGORY_FILTERS)[number];

const PRIMARY_SURFACE_IDS = {
  providerBridge: "adjutorix-ai-provider-bridge",
  contextPack: "adjutorix-ai-workspace-context-pack",
  patchRunway: "adjutorix-ai-patch-runway",
  patchVerify: "adjutorix-ai-patch-verify-runway",
} as const;

// MOVE214_SEMANTIC_PRIMARY_ROLE_DISCOVERY=true
type PrimarySurfaceRole = keyof typeof PRIMARY_SURFACE_IDS;

type ProductSurface = {
  id: string;
  title: string;
  description: string;
  category: SurfaceCategory;
  workflow: WorkflowMode;
  isCurrent: boolean;
  isPrimary: boolean;
  primaryRole: PrimarySurfaceRole | null;
  isLegacyRunway: boolean;
  order: number;
};

type WorkflowGuide = {
  eyebrow: string;
  title: string;
  description: string;
};

type GuidedMission = {
  schema: "adjutorix.guided_mission.v1";
  id: string;
  task: string;
  workflow: WorkflowMode;
  targetSurfaceId: string;
  targetSurfaceTitle: string;
  source: "adjutorix-guided-mission-composer";
  createdAt: string;
  preservesMountedAuthority: true;
};

const WORKFLOW_GUIDES: Record<WorkflowFilter, WorkflowGuide> = {
  All: {
    eyebrow: "ONE PRODUCT",
    title: "Choose the outcome, not the subsystem",
    description:
      "Adjutorix keeps every advanced authority surface available while presenting one clear task at a time.",
  },
  Understand: {
    eyebrow: "STEP 1",
    title: "Understand the workspace",
    description:
      "Ask questions, inspect project context, discover relevant files, and understand the existing system before changing it.",
  },
  Plan: {
    eyebrow: "STEP 2",
    title: "Create a governed plan",
    description:
      "Define intent, affected files, execution order, constraints, and verification requirements before mutation.",
  },
  Build: {
    eyebrow: "STEP 3",
    title: "Build the change",
    description:
      "Generate or apply a bounded patch through the controlled mutation runway with explicit human authority.",
  },
  Verify: {
    eyebrow: "STEP 4",
    title: "Verify before acceptance",
    description:
      "Run tests, checks, diff review, policy gates, and evidence generation before accepting any result.",
  },
  Ship: {
    eyebrow: "STEP 5",
    title: "Ship with proof",
    description:
      "Produce finality, certificate, archive, publication, distribution, and replayable evidence artifacts.",
  },
};

function compactText(value: string | null | undefined): string {
  return (value || "").replace(/\s+/gu, " ").trim();
}

function titleFromIdentifier(identifier: string): string {
  return identifier
    .replace(/^adjutorix-ai-(?:runway-)?/u, "")
    .split("-")
    .filter(Boolean)
    .map((word) => {
      if (word === "ai") return "AI";
      if (word === "sha256") return "SHA-256";
      if (word === "json") return "JSON";
      if (word === "os") return "OS";

      return `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;
    })
    .join(" ");
}

function primarySurfaceRole(element: HTMLElement): PrimarySurfaceRole | null {
  const identifier = element.id.toLowerCase();

  for (const [role, canonicalIdentifier] of Object.entries(
    PRIMARY_SURFACE_IDS,
  )) {
    if (identifier === canonicalIdentifier) {
      return role as PrimarySurfaceRole;
    }
  }

  const heading = compactText(
    element.querySelector<HTMLElement>("h2, h1, h3")?.textContent,
  ).toLowerCase();

  const accessibleIdentity = [
    identifier,
    heading,
    compactText(element.getAttribute("aria-label")).toLowerCase(),
    compactText(element.getAttribute("title")).toLowerCase(),
  ].join(" ");

  if (
    accessibleIdentity.includes("ai workbench bridge") ||
    accessibleIdentity.includes("ai provider bridge") ||
    accessibleIdentity.includes("workbench-bridge") ||
    accessibleIdentity.includes("provider-bridge")
  ) {
    return "providerBridge";
  }

  if (
    accessibleIdentity.includes("workspace context") ||
    accessibleIdentity.includes("workspace-context-pack")
  ) {
    return "contextPack";
  }

  if (
    accessibleIdentity.includes("patch verify") ||
    accessibleIdentity.includes("patch-verify-runway")
  ) {
    return "patchVerify";
  }

  if (
    accessibleIdentity.includes("ai patch runway") ||
    accessibleIdentity.includes("patch-runway")
  ) {
    return "patchRunway";
  }

  // MOVE214_PROVIDER_TOPOLOGY_FALLBACK=true
  //
  // After canonical and semantic matching, the only remaining
  // non-runway Adjutorix AI surface is the integrated assistant.
  // Legacy runway authority is explicitly excluded.
  if (
    !element.matches(LEGACY_RUNWAY_SELECTOR) &&
    identifier.startsWith("adjutorix-ai-")
  ) {
    return "providerBridge";
  }

  return null;
}

// MOVE215_GUIDED_MISSION_COMPOSER=true
function inferMissionWorkflow(value: string): WorkflowMode {
  const task = compactText(value).toLowerCase();

  if (
    /\b(verify|test|check|audit|validate|review|diagnose failure|prove)\b/u.test(
      task,
    )
  ) {
    return "Verify";
  }

  if (
    /\b(ship|release|publish|deploy|distribute|archive|finalize|certificate)\b/u.test(
      task,
    )
  ) {
    return "Ship";
  }

  if (
    /\b(build|implement|create|fix|change|modify|refactor|write|add|remove|upgrade)\b/u.test(
      task,
    )
  ) {
    return "Build";
  }

  if (
    /\b(plan|design|architect|strategy|scope|sequence|roadmap|proposal)\b/u.test(
      task,
    )
  ) {
    return "Plan";
  }

  return "Understand";
}

function recommendedSurfaceForWorkflow(
  surfaces: ProductSurface[],
  workflow: WorkflowFilter,
): ProductSurface | null {
  const candidates =
    workflow === "All"
      ? surfaces
      : surfaces.filter((surface) => surface.workflow === workflow);

  if (workflow === "Understand") {
    return (
      candidates.find((surface) => surface.primaryRole === "providerBridge") ||
      candidates.find((surface) => surface.primaryRole === "contextPack") ||
      candidates[0] ||
      null
    );
  }

  if (workflow === "Plan") {
    return (
      candidates.find((surface) => surface.primaryRole === "contextPack") ||
      candidates.find((surface) => surface.id.includes("mission-control")) ||
      candidates[0] ||
      null
    );
  }

  if (workflow === "Build") {
    return (
      candidates.find((surface) => surface.primaryRole === "patchRunway") ||
      candidates[0] ||
      null
    );
  }

  if (workflow === "Verify") {
    return (
      candidates.find((surface) => surface.primaryRole === "patchVerify") ||
      candidates[0] ||
      null
    );
  }

  if (workflow === "Ship") {
    return (
      candidates.find((surface) => surface.isCurrent) || candidates[0] || null
    );
  }

  return (
    candidates.find((surface) => surface.primaryRole === "providerBridge") ||
    candidates.find((surface) => surface.isPrimary) ||
    candidates[0] ||
    null
  );
}
function workflowFor(
  identifier: string,
  primaryRole: PrimarySurfaceRole | null,
): WorkflowMode {
  if (primaryRole === "providerBridge" || primaryRole === "contextPack") {
    return "Understand";
  }

  if (primaryRole === "patchVerify") {
    return "Verify";
  }

  if (primaryRole === "patchRunway") {
    return "Build";
  }

  if (identifier.includes("verifier") || identifier.includes("verify")) {
    return "Verify";
  }

  if (
    identifier.includes("publication") ||
    identifier.includes("distribution") ||
    identifier.includes("release") ||
    identifier.includes("archive") ||
    identifier.includes("finality") ||
    identifier.includes("certificate") ||
    identifier.includes("attestation") ||
    identifier.includes("seal") ||
    identifier.includes("bundle")
  ) {
    return "Ship";
  }

  if (
    identifier.includes("mission-control") ||
    identifier.includes("control-board") ||
    identifier.includes("context") ||
    identifier.includes("intent") ||
    identifier.includes("plan")
  ) {
    return "Plan";
  }

  if (
    identifier.includes("patch") ||
    identifier.includes("apply") ||
    identifier.includes("mutation")
  ) {
    return "Build";
  }

  return "Plan";
}

function categoryFor(
  identifier: string,
  isCurrent: boolean,
  primaryRole: PrimarySurfaceRole | null,
): SurfaceCategory {
  if (primaryRole === "providerBridge") {
    return "Chat";
  }

  if (primaryRole === "contextPack") {
    return "Context";
  }

  if (primaryRole === "patchRunway") {
    return "Change";
  }

  if (primaryRole === "patchVerify") {
    return "Verify";
  }

  if (isCurrent) {
    return "Publication";
  }

  if (identifier.includes("verifier") || identifier.includes("verify")) {
    return "Verify";
  }

  if (
    identifier.includes("mission-control") ||
    identifier.includes("control-board") ||
    identifier.includes("terminal")
  ) {
    return "Run";
  }

  if (
    identifier.includes("evidence") ||
    identifier.includes("ledger") ||
    identifier.includes("receipt") ||
    identifier.includes("attestation")
  ) {
    return "Evidence";
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

  if (
    identifier.includes("manifest") ||
    identifier.includes("publication") ||
    identifier.includes("distribution")
  ) {
    return "Publication";
  }

  if (
    identifier.includes("patch") ||
    identifier.includes("apply") ||
    identifier.includes("mutation")
  ) {
    return "Change";
  }

  return "Authority";
}

function isManagedSurfaceCandidate(element: HTMLElement): boolean {
  if (primarySurfaceRole(element)) {
    return true;
  }

  if (element.matches(LEGACY_RUNWAY_SELECTOR)) {
    return true;
  }

  const position = window.getComputedStyle(element).position;

  return position === "fixed";
}

function productSurfaceElements(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(PRODUCT_SURFACE_SELECTOR),
  ).filter(isManagedSurfaceCandidate);
}

function productSurfaceFromElement(
  element: HTMLElement,
  order: number,
): ProductSurface {
  const heading = compactText(
    element.querySelector<HTMLElement>("h2, h1, h3")?.textContent,
  );

  const description = compactText(
    element.querySelector<HTMLElement>("p")?.textContent,
  );

  const isCurrent = element.id.includes("distribution-publication-publication");

  const primaryRole = primarySurfaceRole(element);
  const isPrimary = primaryRole !== null;

  const isLegacyRunway = element.matches(LEGACY_RUNWAY_SELECTOR);

  return {
    id: element.id,
    title: heading || titleFromIdentifier(element.id),
    description:
      description ||
      "Governed Adjutorix capability preserved inside the unified product workspace.",
    category: categoryFor(element.id, isCurrent, primaryRole),
    workflow: workflowFor(element.id, primaryRole),
    isCurrent,
    isPrimary,
    primaryRole,
    isLegacyRunway,
    order,
  };
}

function surfaceSignature(surfaces: ProductSurface[]): string {
  return surfaces
    .map((surface) =>
      [
        surface.id,
        surface.title,
        surface.description,
        surface.category,
        surface.workflow,
        surface.primaryRole || "",
      ].join("|"),
    )
    .join("\n");
}

function requiredPrimaryState(): Record<PrimarySurfaceRole, boolean> {
  const discoveredRoles = new Set<PrimarySurfaceRole>();

  for (const element of productSurfaceElements()) {
    const role = primarySurfaceRole(element);

    if (role) {
      discoveredRoles.add(role);
    }
  }

  return {
    providerBridge: discoveredRoles.has("providerBridge"),
    contextPack: discoveredRoles.has("contextPack"),
    patchRunway: discoveredRoles.has("patchRunway"),
    patchVerify: discoveredRoles.has("patchVerify"),
  };
}

function workflowRank(workflow: WorkflowMode): number {
  return WORKFLOW_MODES.indexOf(workflow);
}

function categoryRank(category: SurfaceCategory): number {
  return SURFACE_CATEGORIES.indexOf(category);
}

export function ProductSurfaceOrchestrator(): JSX.Element {
  const [deckOpen, setDeckOpen] = useState(false);
  const [surfaces, setSurfaces] = useState<ProductSurface[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowFilter>("All");
  const [category, setCategory] = useState<CategoryFilter>("Primary");
  const [missionTask, setMissionTask] = useState("");

  const searchRef = useRef<HTMLInputElement | null>(null);
  const signatureRef = useRef("");
  const lastLegacyCountRef = useRef(-1);
  const lastGuidedSignatureRef = useRef("");

  const focusSearch = useCallback(() => {
    window.setTimeout(() => {
      searchRef.current?.focus();
    }, 0);
  }, []);

  const discoverSurfaces = useCallback(() => {
    const elements = productSurfaceElements();

    const discovered = elements.map((element, order) => {
      element.dataset.adjutorixSurfaceManaged = "true";
      element.dataset.adjutorixProductSurface = "true";

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

    const legacySurfaces = discovered.filter(
      (surface) => surface.isLegacyRunway,
    );

    if (
      legacySurfaces.length !== lastLegacyCountRef.current &&
      legacySurfaces.length > 0
    ) {
      lastLegacyCountRef.current = legacySurfaces.length;

      console.info(
        "ADJUTORIX_PRODUCT_SURFACES_DISCOVERED",
        JSON.stringify({
          source: "adjutorix-product-command-deck",
          count: legacySurfaces.length,
          current: legacySurfaces.filter((surface) => surface.isCurrent).length,
          selector: LEGACY_RUNWAY_SELECTOR,
        }),
      );
    }

    const requiredPrimary = requiredPrimaryState();

    const guidedPayload = {
      source: "adjutorix-guided-product-shell",
      count: discovered.length,
      legacyRunway: legacySurfaces.length,
      primary: discovered.filter((surface) => surface.isPrimary).length,
      current: discovered.filter((surface) => surface.isCurrent).length,
      active: discovered.filter(
        (surface) => surface.id === activeId && activeId !== null,
      ).length,
      selector: PRODUCT_SURFACE_SELECTOR,
      requiredPrimary,
      primaryIdentities: {
        providerBridge:
          discovered.find((surface) => surface.primaryRole === "providerBridge")
            ?.id || null,
        contextPack:
          discovered.find((surface) => surface.primaryRole === "contextPack")
            ?.id || null,
        patchRunway:
          discovered.find((surface) => surface.primaryRole === "patchRunway")
            ?.id || null,
        patchVerify:
          discovered.find((surface) => surface.primaryRole === "patchVerify")
            ?.id || null,
      },
      workflowModes: WORKFLOW_MODES,
      defaultPolicy: "all-hidden-until-selected",
    };

    const guidedSignature = JSON.stringify(guidedPayload);

    if (guidedSignature !== lastGuidedSignatureRef.current) {
      lastGuidedSignatureRef.current = guidedSignature;

      console.info(
        "ADJUTORIX_GUIDED_PRODUCT_SURFACES_DISCOVERED",
        guidedSignature,
      );
    }
  }, [activeId]);

  const closeActiveSurface = useCallback(() => {
    setActiveId(null);
  }, []);

  const toggleDeck = useCallback(() => {
    setDeckOpen((current) => !current);
  }, []);

  const openGuidedWorkspace = useCallback(() => {
    setWorkflow("All");
    setCategory("Primary");
    setQuery("");
    setDeckOpen(true);
    focusSearch();
  }, [focusSearch]);

  const activateSurface = useCallback((identifier: string) => {
    setActiveId(identifier);
    setDeckOpen(false);

    window.setTimeout(() => {
      document.getElementById(identifier)?.focus();
    }, 0);
  }, []);

  useEffect(() => {
    document.body.classList.add("adjutorix-product-command-deck-mode");
    document.body.classList.add("adjutorix-product-experience-mode");

    console.info(
      "ADJUTORIX_PRODUCT_COMMAND_DECK_MOUNTED",
      JSON.stringify({
        source: "adjutorix-product-command-deck",
        manages: LEGACY_RUNWAY_SELECTOR,
        mode: "single-active-surface",
        shortcut: "Meta+Shift+P",
        preservesMountedAuthority: true,
      }),
    );

    console.info(
      "ADJUTORIX_GUIDED_PRODUCT_SHELL_MOUNTED",
      JSON.stringify({
        source: "adjutorix-guided-product-shell",
        manages: PRODUCT_SURFACE_SELECTOR,
        legacyManages: LEGACY_RUNWAY_SELECTOR,
        mode: "guided-single-surface",
        workflowModes: WORKFLOW_MODES,
        shortcuts: ["Meta+K", "Meta+Shift+P"],
        preservesMountedAuthority: true,
        progressiveDisclosure: true,
      }),
    );

    console.info(
      "ADJUTORIX_GUIDED_MISSION_COMPOSER_MOUNTED",
      JSON.stringify({
        source: "adjutorix-guided-mission-composer",
        launchEvent: GUIDED_MISSION_EVENT,
        storageKey: GUIDED_MISSION_STORAGE_KEY,
        workflows: WORKFLOW_MODES,
        shortcut: "Meta+Enter",
        inference: "plain-language-keyword-routing",
        routesToManagedSurface: true,
        preservesMountedAuthority: true,
      }),
    );

    return () => {
      document.body.classList.remove("adjutorix-product-command-deck-mode");
      document.body.classList.remove("adjutorix-product-experience-mode");
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
    productSurfaceElements().forEach((element) => {
      const isActive = element.id === activeId;

      element.dataset.adjutorixSurfaceManaged = "true";
      element.dataset.adjutorixProductSurface = "true";
      element.dataset.adjutorixSurfaceActive = isActive ? "true" : "false";

      element.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }, [activeId, surfaces]);

  useEffect(() => {
    const handleDeckEvent = (): void => {
      toggleDeck();
    };

    const handleGuidedEvent = (): void => {
      openGuidedWorkspace();
    };

    const handleKeyboard = (event: KeyboardEvent): void => {
      const key = event.key.toLowerCase();
      const commandKey = event.metaKey || event.ctrlKey;

      if (commandKey && event.shiftKey && key === "p") {
        event.preventDefault();
        toggleDeck();
        return;
      }

      if (commandKey && !event.shiftKey && key === "k") {
        event.preventDefault();
        setDeckOpen(true);
        focusSearch();
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
    window.addEventListener(GUIDED_SHELL_EVENT, handleGuidedEvent);
    window.addEventListener("keydown", handleKeyboard);

    return () => {
      window.removeEventListener(COMMAND_DECK_EVENT, handleDeckEvent);
      window.removeEventListener(GUIDED_SHELL_EVENT, handleGuidedEvent);
      window.removeEventListener("keydown", handleKeyboard);
    };
  }, [
    activeId,
    closeActiveSurface,
    focusSearch,
    openGuidedWorkspace,
    toggleDeck,
  ]);

  const orderedSurfaces = useMemo(() => {
    return [...surfaces].sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      if (left.isCurrent !== right.isCurrent) {
        return left.isCurrent ? -1 : 1;
      }

      const workflowDifference =
        workflowRank(left.workflow) - workflowRank(right.workflow);

      if (workflowDifference !== 0) {
        return workflowDifference;
      }

      const categoryDifference =
        categoryRank(left.category) - categoryRank(right.category);

      if (categoryDifference !== 0) {
        return categoryDifference;
      }

      return right.order - left.order;
    });
  }, [surfaces]);

  const visibleSurfaces = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return orderedSurfaces.filter((surface) => {
      const workflowMatches =
        workflow === "All" || surface.workflow === workflow;

      if (!workflowMatches) {
        return false;
      }

      const categoryMatches =
        category === "All" ||
        (category === "Primary" && surface.isPrimary) ||
        (category === "Current" && surface.isCurrent) ||
        surface.category === category;

      if (!categoryMatches) {
        return false;
      }

      if (!needle) {
        return true;
      }

      return [
        surface.title,
        surface.description,
        surface.id,
        surface.category,
        surface.workflow,
      ]
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [category, orderedSurfaces, query, workflow]);

  const activeSurface = useMemo(
    () => surfaces.find((surface) => surface.id === activeId) || null,
    [activeId, surfaces],
  );

  const primaryCount = useMemo(
    () => surfaces.filter((surface) => surface.isPrimary).length,
    [surfaces],
  );

  const currentCount = useMemo(
    () => surfaces.filter((surface) => surface.isCurrent).length,
    [surfaces],
  );

  const recommendedSurface = useMemo(
    () => recommendedSurfaceForWorkflow(orderedSurfaces, workflow),
    [orderedSurfaces, workflow],
  );

  const inferredMissionWorkflow = useMemo(
    () => inferMissionWorkflow(missionTask),
    [missionTask],
  );

  const missionTarget = useMemo(
    () =>
      recommendedSurfaceForWorkflow(orderedSurfaces, inferredMissionWorkflow),
    [inferredMissionWorkflow, orderedSurfaces],
  );

  const launchMission = useCallback(() => {
    const task = missionTask.trim();

    if (!task || !missionTarget) {
      return;
    }

    const mission: GuidedMission = {
      schema: "adjutorix.guided_mission.v1",
      id: `adjutorix-mission-${Date.now()}`,
      task,
      workflow: inferredMissionWorkflow,
      targetSurfaceId: missionTarget.id,
      targetSurfaceTitle: missionTarget.title,
      source: "adjutorix-guided-mission-composer",
      createdAt: new Date().toISOString(),
      preservesMountedAuthority: true,
    };

    try {
      window.localStorage.setItem(
        GUIDED_MISSION_STORAGE_KEY,
        JSON.stringify(mission),
      );
    } catch {
      // Launch remains available when persistence is blocked.
    }

    window.dispatchEvent(
      new CustomEvent<GuidedMission>(GUIDED_MISSION_EVENT, {
        detail: mission,
      }),
    );

    console.info("ADJUTORIX_GUIDED_MISSION_LAUNCHED", JSON.stringify(mission));

    setWorkflow(inferredMissionWorkflow);
    setCategory("All");
    setQuery("");
    activateSurface(missionTarget.id);
  }, [activateSurface, inferredMissionWorkflow, missionTarget, missionTask]);

  const guide = WORKFLOW_GUIDES[workflow];

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
        aria-label="Adjutorix product controls"
      >
        <button
          type="button"
          className="adjutorix-product-command-dock__start"
          aria-label="Open Adjutorix guided workspace"
          onClick={openGuidedWorkspace}
        >
          <span>Start</span>
          <strong>Guided</strong>
        </button>

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
          aria-label="Adjutorix guided product shell"
        >
          <header className="adjutorix-product-command-deck__header">
            <div>
              <span>ADJUTORIX PRODUCT OS</span>
              <h2>Guided Mission Control</h2>
              <p>One clear workflow. Every advanced power preserved.</p>
            </div>

            <button
              type="button"
              aria-label="Close Adjutorix power deck"
              onClick={() => setDeckOpen(false)}
            >
              ×
            </button>
          </header>

          <section
            className="adjutorix-guided-mission-composer"
            aria-label="Adjutorix mission composer"
            data-workflow={inferredMissionWorkflow}
          >
            <div className="adjutorix-guided-mission-composer__intro">
              <span>ONE COMMAND</span>
              <strong>Describe the outcome</strong>
              <p>
                Adjutorix determines the workflow, selects the governed tool,
                preserves authority, and carries the mission forward.
              </p>
            </div>

            <textarea
              value={missionTask}
              aria-label="Describe the Adjutorix mission"
              placeholder="Example: Implement the requested change, verify it, and preserve an evidence trail."
              onChange={(event) => setMissionTask(event.target.value)}
              onKeyDown={(event) => {
                const commandKey = event.metaKey || event.ctrlKey;

                if (commandKey && event.key === "Enter") {
                  event.preventDefault();
                  launchMission();
                }
              }}
            />

            <div className="adjutorix-guided-mission-composer__route">
              <span>Detected route</span>
              <strong>{inferredMissionWorkflow}</strong>
              <p>
                {missionTarget
                  ? missionTarget.title
                  : "Waiting for a compatible governed surface"}
              </p>
            </div>

            <button
              type="button"
              aria-label={`Launch ${inferredMissionWorkflow} mission`}
              disabled={!missionTask.trim() || !missionTarget}
              onClick={launchMission}
            >
              <span>Launch mission</span>
              <kbd>⌘↵</kbd>
            </button>
          </section>

          <section
            className="adjutorix-guided-workflow"
            aria-label="Adjutorix guided workflow"
          >
            {WORKFLOW_MODES.map((item, index) => (
              <button
                key={item}
                type="button"
                aria-label={`Select ${item} workflow`}
                data-active={workflow === item ? "true" : "false"}
                onClick={() => {
                  setWorkflow(item);
                  setCategory("All");
                  setQuery("");
                }}
              >
                <small>{index + 1}</small>
                <strong>{item}</strong>
              </button>
            ))}
          </section>

          <section className="adjutorix-guided-summary">
            <div>
              <span>{guide.eyebrow}</span>
              <strong>{guide.title}</strong>
              <p>{guide.description}</p>
            </div>

            {recommendedSurface ? (
              <button
                type="button"
                aria-label={`Open recommended ${workflow} tool`}
                onClick={() => activateSurface(recommendedSurface.id)}
              >
                Open recommended tool
              </button>
            ) : null}
          </section>

          <section className="adjutorix-product-command-deck__metrics">
            <article>
              <strong>{primaryCount}</strong>
              <span>Primary tools</span>
            </article>

            <article>
              <strong>{surfaces.length}</strong>
              <span>Total powers</span>
            </article>

            <article>
              <strong>{currentCount}</strong>
              <span>Current chain</span>
            </article>
          </section>

          <section className="adjutorix-product-command-deck__search">
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Ask for a capability, task, or authority..."
              aria-label="Search Adjutorix power surfaces"
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
            {CATEGORY_FILTERS.map((item) => (
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
                  data-active={surface.id === activeId ? "true" : "false"}
                  data-primary={surface.isPrimary ? "true" : "false"}
                  data-current={surface.isCurrent ? "true" : "false"}
                  aria-label={`Open ${surface.title}`}
                  onClick={() => activateSurface(surface.id)}
                >
                  <span className="adjutorix-product-command-deck__surface-meta">
                    <b>{surface.workflow}</b>
                    <i>{surface.category}</i>
                  </span>

                  <strong>{surface.title}</strong>
                  <p>{surface.description}</p>

                  <small>
                    {surface.isPrimary
                      ? "Primary product tool"
                      : surface.isCurrent
                        ? "Current publication authority"
                        : "Governed authority capability"}
                  </small>
                </button>
              ))
            ) : (
              <article className="adjutorix-product-command-deck__empty">
                <strong>No matching capability</strong>
                <p>
                  Change the workflow, category, or search. Every mounted
                  authority remains preserved.
                </p>
              </article>
            )}
          </section>

          <footer className="adjutorix-product-command-deck__footer">
            <span>⌘K</span>
            <p>Search · ⌘⇧P toggles power · Escape returns to the workspace</p>
          </footer>
        </aside>
      ) : null}
    </>
  );
}
