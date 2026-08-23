"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * Deliberately small, hand-picked set — a full searchable/categorized
 * emoji library (emoji-picker-react, emoji-mart, etc.) would be a heavy
 * new dependency for what's meant to be a discreet input helper. This is
 * plain Unicode text rendered directly, no image assets, no new package.
 */
const EMOJI_SET = [
  "😊", "🙂", "😀", "😄", "😁", "😉", "😍", "🤔",
  "👍", "👏", "🙏", "👋", "💪", "🎉", "✅", "❌",
  "❤️", "🔥", "💡", "⭐", "📈", "📅", "📞", "✉️",
  "🚀", "💬", "👌", "🏢", "🌟", "😅", "🙌", "🤝",
];

export function ChatEmojiPicker({ ariaLabel, onSelect }: { ariaLabel: string; onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Outside click/tap closes it. Escape is handled via a document-level
  // listener in the CAPTURE phase, not a plain onKeyDown on this
  // container: onSelect (below) moves focus back to the chat textarea
  // so typing can continue after picking an emoji, and that textarea is
  // a SIBLING of this container, not a descendant — once focus has
  // moved there, a keydown no longer bubbles through this div at all,
  // so a container-scoped handler would miss it. A capture-phase
  // document listener always runs before any bubble-phase ancestor
  // listener (e.g. a future panel-wide Escape-closes-panel handler)
  // regardless of where focus currently is, so stopPropagation() here
  // reliably keeps Escape from closing anything beyond this popover.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <Button
        type="button"
        size="icon"
        variant="outline"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((value) => !value)}
        className="shrink-0"
      >
        <span aria-hidden="true" className="text-base leading-none">
          😊
        </span>
      </Button>
      {open && (
        <div role="menu" aria-label={ariaLabel} className="absolute right-0 bottom-full mb-2 grid grid-cols-8 gap-1 rounded-xl border border-pm-gris-2 bg-pm-blanc p-2 shadow-pm-md">
          {EMOJI_SET.map((emoji) => (
            <button
              key={emoji}
              type="button"
              role="menuitem"
              onClick={() => onSelect(emoji)}
              className="flex size-8 items-center justify-center rounded-md text-lg hover:bg-pm-gris-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/50"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
