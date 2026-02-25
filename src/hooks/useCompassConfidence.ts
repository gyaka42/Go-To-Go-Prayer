import { useEffect, useMemo, useRef, useState } from "react";
import { Magnetometer } from "expo-sensors";

export type CompassConfidenceStatus = "good" | "meh" | "bad";

export type CompassConfidence = {
  status: CompassConfidenceStatus;
  fieldStrength: number | null;
  headingStdDev: number | null;
  messageKey: string;
  debug?: { samples: number };
};

type UseCompassConfidenceArgs = {
  headingDeg: number | null;
  enabled: boolean;
};

const WINDOW_SIZE = 14;
const MAGNETOMETER_INTERVAL_MS = 150;

function normalizeDegrees(value: number): number {
  const v = value % 360;
  return v < 0 ? v + 360 : v;
}

function shortestDelta(prev: number, next: number): number {
  return ((next - prev + 540) % 360) - 180;
}

function stdDev(values: number[]): number | null {
  if (values.length < 2) {
    return null;
  }

  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function useCompassConfidence({ headingDeg, enabled }: UseCompassConfidenceArgs): CompassConfidence {
  const [fieldStrength, setFieldStrength] = useState<number | null>(null);
  const [headingStdDev, setHeadingStdDev] = useState<number | null>(null);
  const [magSamplesCount, setMagSamplesCount] = useState(0);
  const [headingSamplesCount, setHeadingSamplesCount] = useState(0);

  const fieldWindowRef = useRef<number[]>([]);
  const headingWindowRef = useRef<number[]>([]);
  const previousHeadingRef = useRef<number | null>(null);
  const unwrappedHeadingRef = useRef<number | null>(null);
  const statusLogRef = useRef<CompassConfidenceStatus | null>(null);

  useEffect(() => {
    if (!enabled) {
      fieldWindowRef.current = [];
      headingWindowRef.current = [];
      previousHeadingRef.current = null;
      unwrappedHeadingRef.current = null;
      setFieldStrength(null);
      setHeadingStdDev(null);
      setMagSamplesCount(0);
      setHeadingSamplesCount(0);
      return;
    }

    let active = true;
    let subscription: { remove: () => void } | null = null;

    const subscribe = async () => {
      try {
        const available = await Magnetometer.isAvailableAsync();
        if (!active) {
          return;
        }

        if (!available) {
          if (__DEV__) {
            console.warn("[qibla-confidence] magnetometer unavailable");
          }
          setFieldStrength(null);
          setMagSamplesCount(0);
          return;
        }

        Magnetometer.setUpdateInterval(MAGNETOMETER_INTERVAL_MS);
        subscription = Magnetometer.addListener(({ x, y, z }) => {
          if (!active) {
            return;
          }

          const field = Math.sqrt(x * x + y * y + z * z);
          if (!Number.isFinite(field)) {
            return;
          }

          const nextWindow = [...fieldWindowRef.current, field].slice(-WINDOW_SIZE);
          fieldWindowRef.current = nextWindow;
          const meanField = nextWindow.reduce((sum, value) => sum + value, 0) / nextWindow.length;

          setFieldStrength(Number.isFinite(meanField) ? meanField : null);
          setMagSamplesCount(nextWindow.length);
        });
      } catch (error) {
        if (__DEV__) {
          console.warn(`[qibla-confidence] magnetometer subscribe failed: ${String(error)}`);
        }
        setFieldStrength(null);
        setMagSamplesCount(0);
      }
    };

    void subscribe();

    return () => {
      active = false;
      if (subscription) {
        subscription.remove();
      }
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled || typeof headingDeg !== "number" || Number.isNaN(headingDeg)) {
      return;
    }

    const normalized = normalizeDegrees(headingDeg);
    const previous = previousHeadingRef.current;

    if (previous == null || unwrappedHeadingRef.current == null) {
      previousHeadingRef.current = normalized;
      unwrappedHeadingRef.current = normalized;
      headingWindowRef.current = [normalized];
      setHeadingStdDev(null);
      setHeadingSamplesCount(1);
      return;
    }

    const delta = shortestDelta(previous, normalized);
    const unwrapped = unwrappedHeadingRef.current + delta;

    previousHeadingRef.current = normalized;
    unwrappedHeadingRef.current = unwrapped;

    const nextWindow = [...headingWindowRef.current, unwrapped].slice(-WINDOW_SIZE);
    headingWindowRef.current = nextWindow;

    setHeadingStdDev(stdDev(nextWindow));
    setHeadingSamplesCount(nextWindow.length);
  }, [headingDeg, enabled]);

  const status = useMemo<CompassConfidenceStatus>(() => {
    if (!enabled) {
      return "meh";
    }

    if (fieldStrength == null || headingStdDev == null) {
      return "meh";
    }

    const fieldBad = fieldStrength < 15 || fieldStrength > 85;
    const fieldMeh = (fieldStrength >= 15 && fieldStrength < 25) || (fieldStrength > 65 && fieldStrength <= 85);

    if (fieldBad || headingStdDev > 25) {
      return "bad";
    }

    if (fieldMeh || (headingStdDev > 12 && headingStdDev <= 25)) {
      return "meh";
    }

    if (headingStdDev <= 12 && fieldStrength >= 25 && fieldStrength <= 65) {
      return "good";
    }

    return "meh";
  }, [enabled, fieldStrength, headingStdDev]);

  const messageKey = useMemo(() => {
    if (status === "good") {
      return "qibla.confidence.good";
    }
    if (status === "bad") {
      return "qibla.confidence.bad";
    }
    return "qibla.confidence.meh";
  }, [status]);

  useEffect(() => {
    if (!__DEV__) {
      return;
    }

    if (statusLogRef.current === status) {
      return;
    }

    statusLogRef.current = status;
    const fieldText = fieldStrength == null ? "null" : fieldStrength.toFixed(1);
    const stdText = headingStdDev == null ? "null" : headingStdDev.toFixed(1);
    const samples = Math.max(magSamplesCount, headingSamplesCount);
    console.log(`[qibla-confidence] status=${status} field=${fieldText} std=${stdText} samples=${samples}`);
  }, [fieldStrength, headingSamplesCount, headingStdDev, magSamplesCount, status]);

  return {
    status,
    fieldStrength,
    headingStdDev,
    messageKey,
    debug: {
      samples: Math.max(magSamplesCount, headingSamplesCount)
    }
  };
}
