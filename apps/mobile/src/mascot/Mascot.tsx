// <Mascot> — the character primitive. A thin, pose-aware wrapper over KafilLottie so
// screens say `<Mascot pose="wave" size={120} />` instead of wiring Lottie + asset +
// loop logic each time. Honors reduce-motion (renders a still frame, no loop) and the
// device-tier story KafilLottie already encodes (§27.5).

import { motion } from '@kafil/core';
import { KafilLottie } from '../motion/KafilLottie';
import { useReduceMotion } from '../theme';
import { poseAsset, poseLoops, type MascotPose } from './poses';

interface Props {
  pose?: MascotPose;
  size?: number;
  /** Force a single play (e.g. a coach-mark point that shouldn't loop forever). */
  loop?: boolean;
}

export function Mascot({ pose = 'idle', size = 96, loop }: Props) {
  const reduceMotion = useReduceMotion();
  const shouldLoop = loop ?? poseLoops(pose);
  return (
    <KafilLottie
      source={poseAsset(pose) as never}
      motionClass={motion.MotionClass.E_MASCOT}
      // reduce-motion → still frame (no autoplay, no loop): the character is present
      // but calm, never animating for a user who asked the OS to minimize motion.
      autoPlay={!reduceMotion}
      loop={!reduceMotion && shouldLoop}
      style={{ width: size, height: size }}
    />
  );
}

export type { MascotPose };
