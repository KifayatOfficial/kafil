'use client';

// Web motion primitives — the client-side animation layer for the (otherwise
// server-rendered) admin/desktop app. Built on Motion (motion/react, formerly
// Framer Motion) 12.x, which is React-19 / Next-16 native and runs on the Web
// Animations API for compositor-thread playback.
//
// Design contract: these mirror the SHARED motion tokens in @kafil/core (the same
// Cloudscape-aligned curves + timing roles the mobile app uses via Reanimated), so
// web and mobile motion read as one system. Curve A (responsive) for entrances, the
// spring for interactive lifts. Everything here degrades to instant under the OS
// "reduce motion" setting via <MotionConfig reducedMotion="user"> at the root, plus a
// belt-and-braces useReducedMotion guard on the stagger delays.
//
// Why wrappers instead of sprinkling motion.div everywhere: pages stay Server
// Components (fast first paint, no client data-fetching); only these small leaf
// components ship to the client. Import them into a server page and pass server data
// as children/props.

import { motion, useReducedMotion, type Variants } from 'motion/react';
import type { ReactNode } from 'react';

// @kafil/core curve A = [0,0,0,1] "responsive". Motion takes cubic-bezier as an array.
const CURVE_A = [0, 0, 0, 1] as const;
const CURVE_C = [0.84, 0, 0.16, 1] as const; // "expressive" — attention reveals

/**
 * FadeRise — the workhorse entrance. Fades + lifts a block into place on mount.
 * Use for page sections, hero blocks, standalone cards.
 */
export function FadeRise({
  children,
  delay = 0,
  y = 12,
  className,
}: {
  children: ReactNode;
  delay?: number;
  y?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: reduce ? 0 : y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: CURVE_A, delay: reduce ? 0 : delay }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Stagger — a container whose direct <StaggerItem> children animate in sequence.
 * This is what makes a job grid or stat strip feel "alive" on load instead of
 * snapping in all at once. Delay per child is capped by variants, so a 200-item
 * grid doesn't take 40s to finish revealing.
 */
const containerVariants: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.05, delayChildren: 0.04 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: CURVE_A } },
};

export function Stagger({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      variants={reduce ? undefined : containerVariants}
      initial={reduce ? undefined : 'hidden'}
      animate={reduce ? undefined : 'show'}
    >
      {children}
    </motion.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div className={className} variants={reduce ? undefined : itemVariants}>
      {children}
    </motion.div>
  );
}

/**
 * Lift — an interactive hover/press wrapper. Scales up a hair and lifts on hover,
 * dips on tap. Spring-based so it feels physical, not linear. Wrap a card/link.
 * (Complements the CSS :hover shadow already on .card — this adds the transform.)
 */
export function Lift({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href?: string;
}) {
  const reduce = useReducedMotion();
  const hover = reduce ? {} : { y: -3, scale: 1.012 };
  const tap = reduce ? {} : { scale: 0.98 };
  const spring = { type: 'spring' as const, stiffness: 320, damping: 24, mass: 0.9 };

  if (href) {
    return (
      <motion.a href={href} className={className} whileHover={hover} whileTap={tap} transition={spring}>
        {children}
      </motion.a>
    );
  }
  return (
    <motion.div className={className} whileHover={hover} whileTap={tap} transition={spring}>
      {children}
    </motion.div>
  );
}

/**
 * CountUp — animates a number from 0 to its value on first view. Used on the stat
 * strip so the dashboard "boots up" its figures. Pure client, respects reduce-motion
 * (jumps straight to the final value). Renders with Intl grouping for PKR legibility.
 */
export function CountUp({ value, className }: { value: number; className?: string }) {
  const reduce = useReducedMotion();
  if (reduce) {
    return <span className={className}>{new Intl.NumberFormat('en-PK').format(value)}</span>;
  }
  return (
    <motion.span
      className={className}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Counter to={value} />
    </motion.span>
  );
}

// Internal: drives the actual digit interpolation.
import { animate as animateValue, useMotionValue, useTransform, useMotionValueEvent } from 'motion/react';
import { useEffect, useState } from 'react';

function Counter({ to }: { to: number }) {
  const mv = useMotionValue(0);
  const rounded = useTransform(mv, (v) => Math.round(v));
  const [display, setDisplay] = useState(0);
  useMotionValueEvent(rounded, 'change', (v) => setDisplay(v));
  useEffect(() => {
    const controls = animateValue(mv, to, { duration: 0.9, ease: CURVE_C });
    return () => controls.stop();
  }, [mv, to]);
  return <>{new Intl.NumberFormat('en-PK').format(display)}</>;
}
