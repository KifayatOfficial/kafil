// TrustRing — wraps a user's avatar in a segmented progress ring that visualizes real
// verification state (phone / CNIC / local vouching / job history — the same badges
// already modeled as badgePhone/badgeCnic/badgeJobs/badgeLocal in @kafil/core). This
// gives P7 (Trust & Safety is first-class, §27 invariant) a visible, always-on presence
// on Home/Profile instead of trust living only inside a badges list on the profile page.
//
// §25.2 note this design respects: never color-alone. Each filled segment is also a
// distinct arc position (shape), and the check glyph + tooltip-on-press carry the label —
// so it degrades gracefully for colorblind users and doesn't rely on a legend.

import { Pressable, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useTheme } from '../theme';

export interface TrustSegment {
  key: 'phone' | 'cnic' | 'jobs' | 'local';
  complete: boolean;
}

interface Props {
  /** 1-2 letters/initials shown in the avatar center when no photo is available. */
  initials: string;
  photoUrl?: string | null;
  segments: TrustSegment[];
  size?: number;
  onPress?: () => void;
}

const SEGMENT_COLOR_KEY = {
  phone: 'badgePhone',
  cnic: 'badgeCnic',
  jobs: 'badgeJobs',
  local: 'badgeLocal',
} as const;

export function TrustRing({ initials, segments, size = 48, onPress }: Props) {
  const { colors } = useTheme();
  const strokeWidth = Math.max(3, size * 0.08);
  const radius = size / 2 - strokeWidth / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const gap = 4; // px gap between segment arcs
  const arcLen = circumference / segments.length - gap;
  const completeCount = segments.filter((s) => s.complete).length;
  const verified = completeCount === segments.length && segments.length > 0;

  return (
    <Pressable onPress={onPress} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track: the un-earned portion of every segment, always visible so the ring
              reads as "N of 4 earned" at a glance rather than just glowing when complete. */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.border}
            strokeWidth={strokeWidth}
            fill="none"
          />
          {segments.map((seg, i) => {
            if (!seg.complete) return null;
            const offset = (circumference / segments.length) * i;
            return (
              <Circle
                key={seg.key}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                stroke={colors[SEGMENT_COLOR_KEY[seg.key]]}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeDasharray={`${arcLen} ${circumference - arcLen}`}
                strokeDashoffset={-offset}
                fill="none"
                rotation={-90}
                origin={`${size / 2}, ${size / 2}`}
              />
            );
          })}
        </Svg>
        <View
          style={{
            position: 'absolute',
            top: strokeWidth + 2,
            left: strokeWidth + 2,
            right: strokeWidth + 2,
            bottom: strokeWidth + 2,
            borderRadius: size,
            backgroundColor: colors.primarySoft,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: size * 0.32, fontWeight: '600', color: colors.primary }}>
            {initials}
          </Text>
        </View>
        {verified ? (
          <View
            style={{
              position: 'absolute',
              bottom: -1,
              right: -1,
              width: size * 0.36,
              height: size * 0.36,
              borderRadius: size,
              backgroundColor: colors.primary,
              borderWidth: 2,
              borderColor: colors.bg,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Text style={{ fontSize: size * 0.2, color: colors.textOnPrimary, fontWeight: '700' }}>✓</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}
