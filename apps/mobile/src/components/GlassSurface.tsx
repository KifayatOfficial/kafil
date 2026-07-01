// GlassSurface — the floating "chrome" material for nav-layer elements only (bottom tab
// bar, floating top bar). Per current platform glass guidance (2026 Liquid Glass HIG):
// glass is reserved for controls that float ABOVE content, never for content itself
// (lists, cards, scrollable surfaces stay opaque on the regular `surface` tokens).
// Do not reach for this component outside PortalShell / a sticky header.
//
// Renders a real hardware-accelerated blur via expo-blur, tinted with the theme's
// `glassTint` so it samples as "warm cream" / "charcoal" rather than a generic gray.
// expo-blur's BlurView is supported on both platforms as of SDK 51 (Android uses the
// experimental blur method under the hood); no manual fallback is needed here.

import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { useTheme } from '../theme';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Blur strength 1-100. Nav bars read best around 40-60 — enough to separate from
   * content without smearing the icons sitting inside the glass itself. */
  intensity?: number;
  borderRadius?: number;
}

export function GlassSurface({ children, style, intensity = 50, borderRadius = 26 }: Props) {
  const { colors, scheme } = useTheme();

  const shell: ViewStyle = {
    borderRadius,
    borderWidth: 0.5,
    borderColor: colors.glassBorder,
    overflow: 'hidden',
  };

  return (
    <View style={[shell, style]}>
      <BlurView
        intensity={intensity}
        tint={scheme === 'dark' ? 'dark' : 'light'}
        style={StyleSheet.absoluteFillObject}
      />
      {/* Tint layer on top of the blur — expo-blur's system tint alone reads too neutral;
          this is what makes the glass feel like *KAFIL's* cream/charcoal, not iOS's. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.glassTint }]} />
      {/* Specular top-edge sheen — a static stand-in for real light-bending. */}
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: 0,
          left: borderRadius,
          right: borderRadius,
          height: 1,
          backgroundColor: colors.glassHighlight,
        }}
      />
      {children}
    </View>
  );
}
