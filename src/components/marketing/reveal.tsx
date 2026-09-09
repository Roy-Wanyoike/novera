'use client'

import { motion, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

/**
 * Marketing scroll-reveal wrapper — fades / rises content into view once.
 * Used sparingly: sections and cards only, never text-heavy paragraphs mid-flow.
 */
export function Reveal({
  children,
  className,
  delay = 0,
  y = 20,
  once = true,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  once?: boolean
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? undefined : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-60px' }}
      transition={{ duration: 0.6, delay, ease: [0.21, 0.47, 0.32, 0.98] }}
    >
      {children}
    </motion.div>
  )
}

/**
 * Gentle infinite float for hero accent chips. Honors prefers-reduced-motion.
 */
export function Float({
  children,
  className,
  delay = 0,
  distance = 6,
  duration = 6,
}: {
  children: ReactNode
  className?: string
  delay?: number
  distance?: number
  duration?: number
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      animate={reduce ? undefined : { y: [0, -distance, 0] }}
      transition={{ duration, delay, repeat: Infinity, ease: 'easeInOut' }}
    >
      {children}
    </motion.div>
  )
}
