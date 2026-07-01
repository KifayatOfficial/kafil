// §27/1.2 — a small unread/notification count badge, meant to overlay an icon (chat,
// tabs). Renders nothing when count is 0 (so callers can drop it in unconditionally).
// Counts above 9 show "9+" to keep the pill compact on a crowded header/tab bar.
import { Text, View } from 'react-native';
import { makeStyles } from '../theme';

export function Badge({ count }: { count: number }) {
  const styles = useStyles();
  if (count <= 0) return null;
  const label = count > 9 ? '9+' : String(count);
  return (
    <View style={styles.badge} accessibilityLabel={`${count} unread`} pointerEvents="none">
      <Text style={styles.text} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  badge: {
    position: 'absolute',
    top: -6,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: 8,
    backgroundColor: t.colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    // A ring in the surface color so the badge reads cleanly over any icon.
    borderWidth: 1.5,
    borderColor: t.colors.bg,
  },
  text: { color: t.colors.textOnPrimary, fontSize: 10, fontWeight: '700', lineHeight: 13 },
}));
