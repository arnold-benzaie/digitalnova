"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Free-positioning for the chat panel's floating card — desktop only
 * (see DESKTOP_MIN_WIDTH below). Deliberately plain Pointer Events, no
 * new dependency: the whole interaction is drag-start / clamp-on-move /
 * optional-snap-on-release, well within what the platform API already
 * covers.
 *
 * Mirrors the vanilla-JS implementation in chat-widget-embed.js
 * (makeChatPanelDraggable) as closely as two very different codebases
 * reasonably allow — same threshold, same clamping, same storage key
 * shape, same snap distance — so the two widgets feel identical even
 * though nothing is shared at the code level (matches the existing
 * architecture: this app and the static site have never shared a build).
 */

const CLICK_DRAG_THRESHOLD_PX = 5;
const EDGE_MARGIN_PX = 16;
const SNAP_ZONE_PX = 140;
const STORAGE_KEY = "pm_chat_widget_position";
// Below this, the panel is CSS `fixed inset-0` (fullscreen) — dragging a
// fullscreen surface has no meaning, and free-positioning it would
// actively fight the mobile layout (keyboard, scroll, safe areas).
// Matches the panel's own `sm:` (640px) breakpoint in chat-panel.tsx.
const DESKTOP_MIN_WIDTH = 640;

type StoredPosition = { x: number; y: number };

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function readStoredPosition(): StoredPosition | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function writeStoredPosition(position: StoredPosition) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  } catch {
    // Storage full/unavailable (private browsing, etc.) — the panel still
    // drags fine within this tab session, it just won't resume its
    // position after a reload. Never blocks the interaction itself.
  }
}

export function useDraggableChatPanel(panelSize: { width: number; height: number }) {
  const [position, setPosition] = useState<StoredPosition | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  // Mutable drag-session state — refs, not state: updated on every
  // pointermove, and state updates there would re-render on every pixel
  // of movement for no benefit (the DOM position is what needs to track
  // the pointer; React re-rendering isn't required to do that smoothly).
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const panelElRef = useRef<HTMLElement | null>(null);

  const clampToViewport = useCallback(
    (x: number, y: number): StoredPosition => {
      if (typeof window === "undefined") return { x, y };
      const maxX = Math.max(EDGE_MARGIN_PX, window.innerWidth - panelSize.width - EDGE_MARGIN_PX);
      const maxY = Math.max(EDGE_MARGIN_PX, window.innerHeight - panelSize.height - EDGE_MARGIN_PX);
      return { x: clamp(x, EDGE_MARGIN_PX, maxX), y: clamp(y, EDGE_MARGIN_PX, maxY) };
    },
    [panelSize.width, panelSize.height],
  );

  // Desktop/mobile detection + revalidate any stored position against
  // the CURRENT viewport on mount and on every resize (§ "redimensionnement
  // de fenêtre" / "validation de la position sauvegardée").
  useEffect(() => {
    function evaluate() {
      const desktop = window.innerWidth >= DESKTOP_MIN_WIDTH;
      setIsDesktop(desktop);
      if (!desktop) return;
      const stored = readStoredPosition();
      if (stored) setPosition(clampToViewport(stored.x, stored.y));
    }
    evaluate();
    window.addEventListener("resize", evaluate);
    return () => window.removeEventListener("resize", evaluate);
  }, [clampToViewport]);

  // Populated in onHeaderPointerDown with the exact function references
  // that were attached, so handlePointerUp can remove them by reading
  // this ref rather than closing over its own binding (a self-reference
  // that works fine at runtime via normal closure semantics, but reads
  // as fragile — flagged by the stricter react-hooks/immutability rule).
  const activeListenersRef = useRef<{ move: (event: PointerEvent) => void; up: (event: PointerEvent) => void } | null>(null);

  const stopTrackingPointer = useCallback(() => {
    const active = activeListenersRef.current;
    if (!active) return;
    window.removeEventListener("pointermove", active.move);
    window.removeEventListener("pointerup", active.up);
    window.removeEventListener("pointercancel", active.up);
    document.body.style.userSelect = "";
    activeListenersRef.current = null;
  }, []);

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (!drag.moved && Math.hypot(dx, dy) < CLICK_DRAG_THRESHOLD_PX) return;
      if (!drag.moved) {
        drag.moved = true;
        setIsDragging(true);
        document.body.style.userSelect = "none";
        // TEMP DEBUG — remove before final commit.
        console.log("[PM_CHAT_DRAG_DEBUG] drag active (threshold crossed)");
      }
      const next = clampToViewport(drag.originX + dx, drag.originY + dy);
      // TEMP DEBUG — remove before final commit.
      console.log("[PM_CHAT_DRAG_DEBUG] pointermove -> position", next);
      setPosition(next);
    },
    [clampToViewport],
  );

  const handlePointerUp = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) return;
      // TEMP DEBUG — remove before final commit.
      console.log("[PM_CHAT_DRAG_DEBUG] pointerup, moved =", drag.moved);
      stopTrackingPointer();
      dragRef.current = null;

      // `drag.moved` (mutated synchronously in handlePointerMove), never
      // the `isDragging` state — this listener was attached back in
      // onHeaderPointerDown, before the drag (and its setIsDragging(true))
      // ever happened, so a closed-over `isDragging` here would always
      // read its stale initial value, never the state's latest one.
      if (drag.moved) {
        // Discreet snap to the nearer side, small margin, only when
        // released close enough to actually feel intentional — never a
        // large, surprising jump across the screen.
        setPosition((current) => {
          if (!current) return current;
          const viewportWidth = window.innerWidth;
          const distanceLeft = current.x;
          const distanceRight = viewportWidth - (current.x + panelSize.width);
          let snappedX = current.x;
          if (distanceLeft <= SNAP_ZONE_PX && distanceLeft <= distanceRight) snappedX = EDGE_MARGIN_PX;
          else if (distanceRight <= SNAP_ZONE_PX && distanceRight < distanceLeft) snappedX = viewportWidth - panelSize.width - EDGE_MARGIN_PX;
          const finalPosition = clampToViewport(snappedX, current.y);
          writeStoredPosition(finalPosition);
          // TEMP DEBUG — remove before final commit.
          console.log("[PM_CHAT_DRAG_DEBUG] snap/persist -> position", finalPosition);
          return finalPosition;
        });
      }
      // Reset after the click/drag distinction has been consumed —
      // deferred one tick so the header's own click handlers (there are
      // none today, but this keeps the pattern safe for the future)
      // still see a consistent isDragging value during their own turn.
      requestAnimationFrame(() => setIsDragging(false));
    },
    [stopTrackingPointer, clampToViewport, panelSize.width],
  );

  const onHeaderPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      if (!isDesktop) return;
      // Never hijacks a click on Minimize/Close (or any future header
      // control) — only a plain drag on the header's own background
      // starts tracking.
      if ((event.target as HTMLElement).closest("button")) return;
      // TEMP DEBUG — remove before final commit.
      console.log("[PM_CHAT_DRAG_DEBUG] pointerdown on header");
      // Root cause of the real-Safari bug reported after the first
      // Preview pass: without this, WebKit starts its own native
      // text-selection/drag gesture on pointerdown over the header's
      // text (confirmed via direct event instrumentation — a `selectstart`
      // fires immediately, before any pointermove) and can swallow the
      // whole gesture before it ever reaches this code, even though the
      // exact same interaction worked fine under Chromium. preventDefault()
      // here stops that native handling before it starts; setPointerCapture
      // keeps this element as the authoritative target for the rest of
      // the gesture even if the pointer momentarily leaves the header's
      // bounds during a fast drag — window-level listeners below still
      // receive the (now-captured) events via normal bubbling.
      event.preventDefault();
      const headerEl = event.currentTarget as HTMLElement;
      headerEl.setPointerCapture(event.pointerId);
      const panelEl = headerEl.closest('[role="dialog"]') as HTMLElement | null;
      panelElRef.current = panelEl;
      const rect = panelEl?.getBoundingClientRect();
      const originX = position?.x ?? rect?.left ?? 0;
      const originY = position?.y ?? rect?.top ?? 0;
      dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, originX, originY, moved: false };
      activeListenersRef.current = { move: handlePointerMove, up: handlePointerUp };
      window.addEventListener("pointermove", handlePointerMove);
      window.addEventListener("pointerup", handlePointerUp);
      window.addEventListener("pointercancel", handlePointerUp);
    },
    [isDesktop, position, handlePointerMove, handlePointerUp],
  );

  useEffect(() => {
    return () => stopTrackingPointer();
  }, [stopTrackingPointer]);

  const positionStyle: React.CSSProperties =
    isDesktop && position
      ? {
          left: position.x,
          top: position.y,
          right: "auto",
          bottom: "auto",
          transition: isDragging || prefersReducedMotion() ? "none" : "left 0.2s ease-out, top 0.2s ease-out",
        }
      : {};

  return { positionStyle, isDragging, isDesktop, onHeaderPointerDown };
}
