// §27.8 — haptic + sound tokens degrade gracefully (silent no-op on tier_c).
import * as Haptics from 'expo-haptics';
import { motion } from '@kafil/core';

export async function haptic(token: motion.HapticToken | string): Promise<void> {
  try {
    switch (token) {
      case motion.hapticToken.TAP_LIGHT:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        return;
      case motion.hapticToken.TAP_MEDIUM:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        return;
      case motion.hapticToken.SUCCESS:
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      case motion.hapticToken.WARNING:
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      case motion.hapticToken.ERROR:
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        return;
      case motion.hapticToken.STREAK:
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        return;
      default:
        // Unknown token → no-op (motion system intentionally graceful).
        return;
    }
  } catch {
    // Device without haptics → silent no-op (§27.5 tier_c).
  }
}
