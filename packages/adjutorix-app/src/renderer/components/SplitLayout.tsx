import React from "react";

export type SplitAxis = "horizontal" | "vertical";
export type SplitCollapseSide = "first" | "second" | "none";
export type SplitDensity = "comfortable" | "compact" | "dense";
export type SplitChromeMode = "full" | "minimal" | "hidden";

export type SplitBounds = {
  minRatio: number;
  maxRatio: number;
};

type LegacyPane = {
  id: string;
  title: string;
  sizePct?: number;
  minSizePct?: number;
  maxSizePct?: number;
  collapsible?: boolean;
  collapsed?: boolean;
  content: React.ReactNode;
};

export type SplitLayoutProps = {
  id?: string;
  title?: string;
  subtitle?: string;
  loading?: boolean;
  health?: string;
  orientation?: SplitAxis;
  axis?: SplitAxis;
  ratio?: number;
  defaultRatio?: number;
  minRatio?: number;
  maxRatio?: number;
  collapsedSide?: SplitCollapseSide;
  defaultCollapsedSide?: SplitCollapseSide;
  firstLabel?: string;
  secondLabel?: string;
  density?: SplitDensity;
  chromeMode?: SplitChromeMode;
  resizable?: boolean;
  allowResize?: boolean;
  allowCollapse?: boolean;
  persistHint?: boolean;
  firstPane?: React.ReactNode;
  secondPane?: React.ReactNode;
  firstVisible?: boolean;
  secondVisible?: boolean;
  firstPreferredPx?: number;
  secondPreferredPx?: number;
  leftPane?: LegacyPane;
  centerPane?: LegacyPane;
  rightPane?: LegacyPane;
  bottomPane?: LegacyPane;
  showLeftPane?: boolean;
  showRightPane?: boolean;
  showBottomPane?: boolean;
  metrics?: {
    totalVisiblePanes?: number;
    resizeEnabled?: boolean;
    nestedSplitCount?: number;
    collapsedPaneCount?: number;
  };
  onRatioChange?: (ratio: number) => void;
  onCollapseChange?: (side: SplitCollapseSide) => void;
  onResizeStart?: () => void;
  onResizeEnd?: (ratio: number) => void;
  onToggleCollapse?: (side: Exclude<SplitCollapseSide, "none">) => void;
  onResizePane?: (...args: unknown[]) => void;
  onTogglePaneCollapsed?: (...args: unknown[]) => void;
  onResetLayout?: () => void;
  onRefreshRequested?: () => void;
  className?: string;
  paneClassName?: string;
  dividerClassName?: string;
};

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function isLegacy(props: SplitLayoutProps): boolean {
  return Boolean(props.leftPane || props.centerPane || props.rightPane || props.bottomPane);
}

function contentOwnsTitle(content: React.ReactNode, title: string): boolean {
  return React.isValidElement(content) && String((content.props as { title?: unknown }).title ?? "") === title;
}

function PaneRegion(props: { pane: LegacyPane; visible: boolean; className?: string }): JSX.Element | null {
  const { pane, visible } = props;
  if (!visible) return null;

  const collapsed = Boolean(pane.collapsed);
  const showChromeTitle = collapsed || !contentOwnsTitle(pane.content, pane.title);

  return (
    <section className={cx("min-h-0 min-w-0 rounded-[1.5rem] border border-zinc-800 bg-zinc-900/60 p-3", props.className)}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Pane</div>
          {showChromeTitle ? <div className="mt-1 text-sm font-semibold text-zinc-100">{pane.title}</div> : null}
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-zinc-400">
          {collapsed ? <span>collapsed</span> : null}
          {typeof pane.minSizePct === "number" ? <span>min {pane.minSizePct}%</span> : null}
          {typeof pane.maxSizePct === "number" ? <span>max {pane.maxSizePct}%</span> : null}
        </div>
      </div>
      {collapsed ? null : <div className="mt-3 min-h-0 min-w-0 overflow-auto">{pane.content}</div>}
    </section>
  );
}

function LegacySplitLayout(props: SplitLayoutProps): JSX.Element {
  const orientation = props.orientation ?? props.axis ?? "horizontal";
  const health = props.health ?? "unknown";
  const loading = Boolean(props.loading);
  const allowResize = props.allowResize ?? props.resizable ?? true;

  const leftVisible = props.showLeftPane ?? true;
  const rightVisible = props.showRightPane ?? true;
  const bottomVisible = props.showBottomPane ?? true;

  const visiblePanes = [
    leftVisible && props.leftPane,
    props.centerPane,
    rightVisible && props.rightPane,
    bottomVisible && props.bottomPane,
  ].filter(Boolean).length;

  const metrics = {
    totalVisiblePanes: props.metrics?.totalVisiblePanes ?? visiblePanes,
    nestedSplitCount: props.metrics?.nestedSplitCount ?? (bottomVisible ? 2 : 1),
    collapsedPaneCount:
      props.metrics?.collapsedPaneCount ??
      [props.leftPane, props.centerPane, props.rightPane, props.bottomPane].filter((pane) => pane?.collapsed).length,
  };

  return (
    <section className={cx("flex h-full min-h-0 min-w-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-950/60 shadow-xl", props.className)}>
      <header className="border-b border-zinc-800 bg-zinc-950/70 px-5 py-4">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Split layout</div>
            <h2 className="mt-1 text-lg font-semibold text-zinc-50">{props.title ?? "Main split layout"}</h2>
            <p className="mt-2 text-sm leading-7 text-zinc-400">{props.subtitle ?? "Governed pane composition surface"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 uppercase tracking-[0.2em] text-zinc-300">{health}</span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-2.5 py-1 uppercase tracking-[0.2em] text-zinc-300">{orientation}</span>
            {loading ? <span className="rounded-full border border-sky-700/40 bg-sky-500/10 px-2.5 py-1 uppercase tracking-[0.2em] text-sky-300">loading</span> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!allowResize}
            onClick={() => props.onResizePane?.(props.centerPane?.id ?? "center-pane", props.centerPane?.sizePct)}
            className={cx("rounded-2xl border px-4 py-2 text-sm font-medium", allowResize ? "border-indigo-700/40 bg-indigo-500/15 text-indigo-200" : "cursor-not-allowed border-zinc-800 bg-zinc-950 text-zinc-500")}
          >
            Resize
          </button>
          <button type="button" onClick={() => props.onResetLayout?.()} className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200">
            Reset layout
          </button>
          <button type="button" onClick={() => props.onRefreshRequested?.()} className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200">
            Refresh
          </button>
          {[props.leftPane, props.rightPane, props.bottomPane]
            .filter((pane): pane is LegacyPane => Boolean(pane?.collapsible))
            .map((pane) => (
              <button
                key={pane.id}
                type="button"
                onClick={() => props.onTogglePaneCollapsed?.(pane.id, !pane.collapsed)}
                className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200"
              >
                Toggle pane
              </button>
            ))}
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-auto p-5">
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
          {props.leftPane ? <PaneRegion pane={props.leftPane} visible={leftVisible} /> : null}
          {props.centerPane ? <PaneRegion pane={props.centerPane} visible={true} className={!leftVisible && !rightVisible ? "xl:col-span-3" : ""} /> : null}
          {props.rightPane ? <PaneRegion pane={props.rightPane} visible={rightVisible} /> : null}
        </div>

        {props.bottomPane && bottomVisible ? (
          <div className="mt-4">
            <PaneRegion pane={props.bottomPane} visible={true} />
          </div>
        ) : null}
      </main>

      <footer className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">
        <div className="flex flex-wrap items-center gap-4">
          <span>visible panes</span>
          <span>{metrics.totalVisiblePanes}</span>
          <span>nested splits</span>
          <span>{metrics.nestedSplitCount}</span>
          <span>folded panes</span>
          <span>{metrics.collapsedPaneCount}</span>
          <span>geometry {allowResize ? "enabled" : "locked"}</span>
        </div>
      </footer>
    </section>
  );
}

function TwoPaneSplitLayout(props: SplitLayoutProps): JSX.Element {
  const axis = props.axis ?? props.orientation ?? "horizontal";
  const firstVisible = props.firstVisible ?? true;
  const secondVisible = props.secondVisible ?? true;
  const firstLabel = props.firstLabel ?? "Primary pane";
  const secondLabel = props.secondLabel ?? "Secondary pane";
  const allowResize = props.resizable ?? props.allowResize ?? true;

  return (
    <section className={cx("flex h-full min-h-0 min-w-0 flex-col rounded-[2rem] border border-zinc-800 bg-zinc-950/60 shadow-xl", props.className)}>
      <header className="border-b border-zinc-800 bg-zinc-950/70 px-5 py-4">
        <div className="text-xs uppercase tracking-[0.22em] text-zinc-500">Split layout</div>
        <h2 className="mt-1 text-lg font-semibold text-zinc-50">{props.title ?? "Split layout"}</h2>
        {props.subtitle ? <p className="mt-2 text-sm leading-7 text-zinc-400">{props.subtitle}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!allowResize}
            onClick={() => {
              props.onResizeStart?.();
              props.onRatioChange?.(props.ratio ?? props.defaultRatio ?? 0.5);
              props.onResizeEnd?.(props.ratio ?? props.defaultRatio ?? 0.5);
            }}
            className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200"
          >
            Resize
          </button>
          <button type="button" onClick={() => props.onToggleCollapse?.("first")} className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200">
            Toggle pane
          </button>
          <button type="button" onClick={() => props.onToggleCollapse?.("second")} className="rounded-2xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-medium text-zinc-200">
            Toggle pane
          </button>
        </div>
      </header>

      <main className={cx("grid min-h-0 flex-1 gap-4 overflow-auto p-5", axis === "horizontal" ? "xl:grid-cols-2" : "grid-rows-2")}>
        {firstVisible ? (
          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Pane</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{firstLabel}</div>
            <div className="mt-3">{props.firstPane}</div>
          </section>
        ) : null}
        {secondVisible ? (
          <section className="rounded-[1.5rem] border border-zinc-800 bg-zinc-900/60 p-4">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Pane</div>
            <div className="mt-1 text-sm font-semibold text-zinc-100">{secondLabel}</div>
            <div className="mt-3">{props.secondPane}</div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-zinc-800 px-5 py-3 text-xs text-zinc-500">axis: {axis}</footer>
    </section>
  );
}

export default function SplitLayout(props: SplitLayoutProps): JSX.Element {
  return isLegacy(props) ? <LegacySplitLayout {...props} /> : <TwoPaneSplitLayout {...props} />;
}
