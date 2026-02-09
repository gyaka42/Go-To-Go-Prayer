import { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";

interface QiblaCompassProps {
  qiblaBearingDeg: number;
  deviceHeadingDeg?: number;
  mode: "live" | "fallback";
  lightMode?: boolean;
}

function normalizeDegrees(value: number): number {
  const v = value % 360;
  return v < 0 ? v + 360 : v;
}

function closestAngle(current: number, target: number): number {
  const delta = ((target - current + 540) % 360) - 180;
  return current + delta;
}

export function QiblaCompass({ qiblaBearingDeg, deviceHeadingDeg, mode, lightMode = false }: QiblaCompassProps) {
  const rotation =
    mode === "live" && typeof deviceHeadingDeg === "number"
      ? normalizeDegrees(qiblaBearingDeg - deviceHeadingDeg)
      : normalizeDegrees(qiblaBearingDeg);

  const northRotation =
    mode === "live" && typeof deviceHeadingDeg === "number" ? normalizeDegrees(-deviceHeadingDeg) : 0;

  const animatedNeedle = useRef(new Animated.Value(rotation)).current;
  const animatedNorth = useRef(new Animated.Value(northRotation)).current;
  const needleRef = useRef(rotation);
  const northRef = useRef(northRotation);

  useEffect(() => {
    const next = closestAngle(needleRef.current, rotation);
    needleRef.current = next;
    Animated.timing(animatedNeedle, {
      toValue: next,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [animatedNeedle, rotation]);

  useEffect(() => {
    const next = closestAngle(northRef.current, northRotation);
    northRef.current = next;
    Animated.timing(animatedNorth, {
      toValue: next,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true
    }).start();
  }, [animatedNorth, northRotation]);

  const animatedNeedleRotate = useMemo(
    () =>
      animatedNeedle.interpolate({
        inputRange: [-3600, 3600],
        outputRange: ["-3600deg", "3600deg"]
      }),
    [animatedNeedle]
  );

  const animatedNorthRotate = useMemo(
    () =>
      animatedNorth.interpolate({
        inputRange: [-3600, 3600],
        outputRange: ["-3600deg", "3600deg"]
      }),
    [animatedNorth]
  );

  const palette = lightMode
    ? {
        shell: "#F7FBFF",
        shellBorder: "#D1E2F3",
        outer: "#EEF5FD",
        outerBorder: "#C7DCEF",
        inner: "#E3EFFC",
        innerBorder: "#BFD4EA",
        tickMajor: "#8FA9C2",
        tickMinor: "#A8BED3",
        north: "#3E5E7D",
        degree: "#3F5F7F",
        needle: "#1F7CDC",
        needleGlow: "#1F7CDC33",
        center: "#FFFFFF"
      }
    : {
        shell: "#0E2234",
        shellBorder: "#2A4865",
        outer: "#13293D",
        outerBorder: "#2B4D6B",
        inner: "#18344B",
        innerBorder: "#335B7E",
        tickMajor: "#9AB8D7",
        tickMinor: "#7C9AB8",
        north: "#A7C7E7",
        degree: "#CFE3FA",
        needle: "#2B8CEE",
        needleGlow: "#2B8CEE33",
        center: "#EAF2FF"
      };

  return (
    <View style={styles.wrap}>
      <View
        style={[
          styles.shell,
          {
            backgroundColor: palette.shell,
            borderColor: palette.shellBorder
          }
        ]}
      >
        <View style={[styles.aura, { borderColor: palette.outerBorder }]} />
        <View style={[styles.crossHair, styles.crossHairV, { backgroundColor: palette.tickMinor }]} />
        <View style={[styles.crossHair, styles.crossHairH, { backgroundColor: palette.tickMinor }]} />

        <View
          style={[
            styles.circleOuter,
            { backgroundColor: palette.outer, borderColor: palette.outerBorder }
          ]}
        >
          <View
            style={[
              styles.circleInner,
              { backgroundColor: palette.inner, borderColor: palette.innerBorder }
            ]}
          />
        </View>

        <Animated.View style={[styles.roseLayer, { transform: [{ rotate: animatedNorthRotate }] }]}>
          <Text style={[styles.cardinal, styles.cardinalN, { color: palette.north }]}>N</Text>
          <Text style={[styles.cardinal, styles.cardinalE, { color: palette.north }]}>E</Text>
          <Text style={[styles.cardinal, styles.cardinalS, { color: palette.north }]}>S</Text>
          <Text style={[styles.cardinal, styles.cardinalW, { color: palette.north }]}>W</Text>
        </Animated.View>

        <Animated.View style={[styles.arrow, { transform: [{ rotate: animatedNeedleRotate }] }]}>
          <View style={[styles.arrowHeadRing, { borderColor: palette.needleGlow }]} />
          <View style={[styles.arrowGlow, { backgroundColor: palette.needleGlow }]} />
          <View
            style={[
              styles.arrowHead,
              { borderBottomColor: palette.needle }
            ]}
          />
          <View style={[styles.arrowTail, { backgroundColor: palette.needle }]} />
          <View style={[styles.arrowCounterWeight, { backgroundColor: palette.needleGlow }]} />
        </Animated.View>

        <View style={[styles.centerDot, { backgroundColor: palette.center, borderColor: palette.needle }]} />
        <View style={[styles.degreeBadge, { borderColor: palette.outerBorder }]}>
          <Text style={[styles.centerLabel, { color: palette.degree }]}>{Math.round(qiblaBearingDeg)}deg</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center"
  },
  shell: {
    width: 260,
    height: 260,
    borderRadius: 130,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#2B8CEE",
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 }
  },
  aura: {
    position: "absolute",
    width: 246,
    height: 246,
    borderRadius: 123,
    borderWidth: 1,
    opacity: 0.4
  },
  crossHair: {
    position: "absolute",
    opacity: 0.14
  },
  crossHairV: {
    width: 1,
    height: 182
  },
  crossHairH: {
    height: 1,
    width: 182
  },
  circleOuter: {
    position: "absolute",
    width: 228,
    height: 228,
    borderRadius: 114,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  circleInner: {
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 1
  },
  roseLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center"
  },
  cardinal: {
    position: "absolute",
    fontSize: 13,
    fontWeight: "700"
  },
  cardinalN: {
    top: 18
  },
  cardinalE: {
    right: 22,
    top: "50%",
    marginTop: -8
  },
  cardinalS: {
    bottom: 18
  },
  cardinalW: {
    left: 22,
    top: "50%",
    marginTop: -8
  },
  arrow: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center"
  },
  arrowGlow: {
    position: "absolute",
    width: 28,
    height: 28,
    borderRadius: 14,
    top: -6
  },
  arrowHeadRing: {
    position: "absolute",
    top: -14,
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2
  },
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 11,
    borderRightWidth: 11,
    borderBottomWidth: 74,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    marginBottom: 2
  },
  arrowTail: {
    width: 3,
    height: 52,
    borderRadius: 2
  },
  arrowCounterWeight: {
    marginTop: 5,
    width: 16,
    height: 16,
    borderRadius: 8
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    zIndex: 3
  },
  degreeBadge: {
    position: "absolute",
    bottom: 22,
    minWidth: 72,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#00000012"
  },
  centerLabel: {
    fontSize: 14,
    fontWeight: "700"
  }
});
