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

  // Outside click/tap closes it (document-level — needs to see clicks
  // anywhere on the page). Escape is intentionally handled via the
  // container's own onKeyDown + stopPropagation below, NOT a
  // document-level listener: a future ancestor (e.g. the panel itself)
  // could reasonably add its own Escape-closes-panel handler, and two
  // document-level Escape listeners on the same keypress would both
  // fire — closing the picker AND the whole panel at once. Scoping to
  // the container plus stopPropagation guarantees the picker (the
  // innermost popover) always gets Escape first and the keypress never
  // reaches further up.
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, [open]);

  return (
    <div
      ref={containerRef}
      className="relative shrink-0"
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.stopPropagation();
          setOpen(false);
        }
      }}
    >
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
