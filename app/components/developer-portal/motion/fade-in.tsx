"use client";

import { motion, useReducedMotion } from "framer-motion";

/**
 * Shared enter animation for net-new Developer Platform components
 * (Stage 0) — existing CSS-keyframe animations (.animate-panel-in etc. in
 * app/globals.css) stay as-is for existing components; this is only for
 * the new screens built on top of this foundation, so usage stays
 * consistent instead of ad hoc per page. Respects prefers-reduced-motion.
 */
export function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
