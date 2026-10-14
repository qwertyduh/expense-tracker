import { useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, {
  Circle,
  Defs,
  FeColorMatrix,
  FeComposite,
  FeFlood,
  FeGaussianBlur,
  Filter,
  G,
} from 'react-native-svg';

import { WalletArrowIn, WalletArrowOut } from '@/components/icons/wallet-arrow';
import { BottomTabInset, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

type DropletMenuProps = {
  /** Opens the add-expense flow (manual entry). */
  onAddPress: () => void;
  /** Opens the receive flow (manual entry). */
  onReceivePress: () => void;
};

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const EDGE = Spacing.four;
const TRIGGER_D = 56;
const TRIGGER_R = TRIGGER_D / 2;
const SAT_D = 60;
const SAT_R = SAT_D / 2;
const GAP = 10;
const TOP_PAD = 10;

// Fixed cluster geometry. Everything (SVG goo circles + real buttons) is placed
// inside this box so the liquid layer and the tappable controls stay aligned.
const CLUSTER_W = Math.max(TRIGGER_D, SAT_D) + EDGE;
const CLUSTER_H =
  TOP_PAD + TRIGGER_D + GAP + SAT_D + GAP + SAT_D;

const TRIGGER_CX = CLUSTER_W - TRIGGER_R;
const TRIGGER_CY = CLUSTER_H - TRIGGER_R;

const SAT_CX = CLUSTER_W - SAT_R;
// Add sits on top, Receive sits just above the trigger.
const SAT_TOP_CY = TOP_PAD + SAT_R;
const SAT_BOTTOM_CY = SAT_TOP_CY + SAT_D + GAP;

/**
 * DropletMenu — a circular “+” anchored to the side of the screen. Tapping it
 * plays a liquid droplet split: an SVG goo layer merges the trigger and two
 * satellite bubbles into one metaball that stretches and pinches into three
 * separate droplets. Each satellite carries a wallet arrow and a small label.
 *
 * - Tap the “+” → open.
 * - Tap the “×” (the rotated “+”) or the scrim → close.
 * - Tap a satellite → close, then run its action.
 *
 * A single 0→1 value drives every layer so the goo (SVG) and the buttons (RN)
 * move together. It uses the JS driver so the SVG circles animate too.
 */
export function DropletMenu({ onAddPress, onReceivePress }: DropletMenuProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [progress] = useState(() => new Animated.Value(0));

  const openMenu = () => {
    setMounted(true);
    setOpen(true);
    Animated.spring(progress, {
      toValue: 1,
      useNativeDriver: false,
      friction: 6,
      tension: 110,
    }).start();
  };

  const closeMenu = (after?: () => void) => {
    setOpen(false);
    Animated.timing(progress, {
      toValue: 0,
      duration: 200,
      useNativeDriver: false,
    }).start(() => {
      setMounted(false);
      after?.();
    });
  };

  // Trigger
  const triggerScale = progress.interpolate({ inputRange: [0, 1], outputRange: [1, 30 / 28] });
  const plusRotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '45deg'],
  });

  // Satellites: rise out of the trigger centre and grow.
  const satScale = progress.interpolate({ inputRange: [0, 1], outputRange: [24 / SAT_R, 1] });
  const topTranslate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TRIGGER_CY - SAT_TOP_CY, 0],
  });
  const bottomTranslate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TRIGGER_CY - SAT_BOTTOM_CY, 0],
  });
  const satOpacity = progress.interpolate({
    inputRange: [0, 0.3, 1],
    outputRange: [0, 0, 1],
  });

  // Goo circles (behind the real buttons) — same motion as the buttons, but
  // they balloon slightly past the button edge while the blob is stretching so
  // the split reads as one liquid mass, then pull back *inside* the buttons as
  // the split settles. Once the goo is smaller than the buttons the necks
  // pinch off, so the idle expanded state is clean, separate circles instead of
  // three bubbles still fused together.
  const gooTriggerR = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [TRIGGER_R, TRIGGER_R + 4, TRIGGER_R - 6],
    extrapolate: 'clamp',
  });
  const gooSatR = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [24, SAT_R + 3, SAT_R - 10],
    extrapolate: 'clamp',
  });
  const gooTopCy = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TRIGGER_CY, SAT_TOP_CY],
  });
  const gooBottomCy = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [TRIGGER_CY, SAT_BOTTOM_CY],
  });

  // Lift clear of the native tab bar + home indicator.
  const clusterBottom = BottomTabInset + insets.bottom + Spacing.four;

  return (
    <View pointerEvents="box-none" style={styles.root}>
      {mounted ? <Pressable onPress={() => closeMenu()} style={styles.scrim} /> : null}

      {/* Cluster: SVG goo layer + real buttons share this coordinate space */}
      <View
        pointerEvents="box-none"
        style={[styles.cluster, { right: EDGE, bottom: clusterBottom }]}>
        {/* Liquid metaball layer */}
        {mounted ? (
          <Svg
            pointerEvents="none"
            width={CLUSTER_W}
            height={CLUSTER_H}
            style={styles.goo}>
            <Defs>
              <Filter id="droplet-goo" x="-50%" y="-50%" width="200%" height="200%">
                <FeGaussianBlur in="SourceGraphic" stdDeviation={7} result="blur" />
                {/*
                  Threshold the blurred alpha into a hard metaball edge. The
                  alpha coefficient is deliberately > 1 (the classic goo trick),
                  so on iOS the shape's RGB gets repremultiplied by that >1 alpha
                  and clips to white. Zero the colour channels and keep this
                  primitive as an alpha-only silhouette.
                */}
                <FeColorMatrix
                  in="blur"
                  type="matrix"
                  values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 20 -9"
                  result="goo"
                />
                {/* Re-fill the silhouette with the exact accent — only the
                    shape's alpha is consumed, so the colour stays correct. */}
                <FeFlood floodColor={theme.accentDeep} result="tint" />
                <FeComposite in="tint" in2="goo" operator="in" />
              </Filter>
            </Defs>
            <G filter="url(#droplet-goo)">
              <AnimatedCircle cx={TRIGGER_CX} cy={TRIGGER_CY} r={gooTriggerR} fill="#000000" />
              <AnimatedCircle cx={SAT_CX} cy={gooTopCy} r={gooSatR} fill="#000000" />
              <AnimatedCircle cx={SAT_CX} cy={gooBottomCy} r={gooSatR} fill="#000000" />
            </G>
          </Svg>
        ) : null}

        {/* Add (top) */}
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          style={[
            styles.satellite,
            {
              top: SAT_TOP_CY - SAT_R,
              left: SAT_CX - SAT_R,
              backgroundColor: theme.accent,
              opacity: satOpacity,
              transform: [{ translateY: topTranslate }, { scale: satScale }],
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add expense"
            onPress={() => closeMenu(onAddPress)}
            style={styles.satellitePress}>
            <WalletArrowOut size={22} color="#FFFFFF" />
            <Text style={styles.satelliteLabel}>Add</Text>
          </Pressable>
        </Animated.View>

        {/* Receive (bottom) */}
        <Animated.View
          pointerEvents={open ? 'auto' : 'none'}
          style={[
            styles.satellite,
            {
              top: SAT_BOTTOM_CY - SAT_R,
              left: SAT_CX - SAT_R,
              backgroundColor: theme.accent,
              opacity: satOpacity,
              transform: [{ translateY: bottomTranslate }, { scale: satScale }],
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Receive money"
            onPress={() => closeMenu(onReceivePress)}
            style={styles.satellitePress}>
            <WalletArrowIn size={22} color="#FFFFFF" />
            <Text style={styles.satelliteLabel}>Receive</Text>
          </Pressable>
        </Animated.View>

        {/* Trigger */}
        <Animated.View
          style={[
            styles.trigger,
            {
              top: TRIGGER_CY - TRIGGER_R,
              left: TRIGGER_CX - TRIGGER_R,
              backgroundColor: theme.accent,
              transform: [{ scale: triggerScale }],
            },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? 'Close add menu' : 'Open add menu'}
            onPress={() => (open ? closeMenu() : openMenu())}
            style={styles.triggerPress}>
            <Animated.Text style={[styles.plus, { transform: [{ rotate: plusRotate }] }]}>
              +
            </Animated.Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  cluster: {
    position: 'absolute',
    width: CLUSTER_W,
    height: CLUSTER_H,
  },
  goo: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  trigger: {
    position: 'absolute',
    width: TRIGGER_D,
    height: TRIGGER_D,
    borderRadius: TRIGGER_R,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  triggerPress: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plus: {
    color: '#FFFFFF',
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '600',
  },
  satellite: {
    position: 'absolute',
    width: SAT_D,
    height: SAT_D,
    borderRadius: SAT_R,
    alignItems: 'center',
    justifyContent: 'center',
  },
  satellitePress: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  satelliteLabel: {
    color: '#FFFFFF',
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 12,
  },
});
