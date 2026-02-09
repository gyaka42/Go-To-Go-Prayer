import { StyleSheet, Text, View } from "react-native";

interface QiblaCompassProps {
  qiblaBearingDeg: number;
  deviceHeadingDeg?: number;
  mode: "live" | "fallback";
}

function normalizeDegrees(value: number): number {
  const v = value % 360;
  return v < 0 ? v + 360 : v;
}

export function QiblaCompass({ qiblaBearingDeg, deviceHeadingDeg, mode }: QiblaCompassProps) {
  const rotation =
    mode === "live" && typeof deviceHeadingDeg === "number"
      ? normalizeDegrees(qiblaBearingDeg - deviceHeadingDeg)
      : normalizeDegrees(qiblaBearingDeg);

  const northRotation =
    mode === "live" && typeof deviceHeadingDeg === "number" ? normalizeDegrees(-deviceHeadingDeg) : 0;

  return (
    <View style={styles.wrap}>
      <View style={styles.circle}>
        <View style={[styles.northLayer, { transform: [{ rotate: `${northRotation}deg` }] }]}>
          <Text style={styles.north}>N</Text>
        </View>
        <View style={[styles.arrow, { transform: [{ rotate: `${rotation}deg` }] }]}>
          <View style={styles.arrowHead} />
          <View style={styles.arrowTail} />
        </View>
        <View style={styles.centerDot} />
        <Text style={styles.centerLabel}>{Math.round(qiblaBearingDeg)}deg</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center"
  },
  circle: {
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "#112436",
    borderWidth: 2,
    borderColor: "#294764",
    alignItems: "center",
    justifyContent: "center"
  },
  northLayer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center"
  },
  north: {
    position: "absolute",
    top: 14,
    fontSize: 14,
    fontWeight: "700",
    color: "#9FC0E0"
  },
  arrow: {
    position: "absolute",
    alignItems: "center"
  },
  arrowHead: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 68,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#2B8CEE",
    marginBottom: 2
  },
  arrowTail: {
    width: 4,
    height: 70,
    backgroundColor: "#2B8CEE",
    borderRadius: 2
  },
  centerDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#EAF2FF",
    borderWidth: 2,
    borderColor: "#2B8CEE"
  },
  centerLabel: {
    position: "absolute",
    bottom: 24,
    fontSize: 14,
    color: "#CFE3FA",
    fontWeight: "700"
  }
});
