export function ChatTypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-1" role="status" aria-live="polite">
      <span className="flex gap-1">
        <span className="size-1.5 animate-bounce rounded-full bg-pm-gris [animation-delay:-0.3s] motion-reduce:animate-none" />
        <span className="size-1.5 animate-bounce rounded-full bg-pm-gris [animation-delay:-0.15s] motion-reduce:animate-none" />
        <span className="size-1.5 animate-bounce rounded-full bg-pm-gris motion-reduce:animate-none" />
      </span>
      <span className="text-xs text-pm-gris">{label}</span>
    </div>
  );
}
