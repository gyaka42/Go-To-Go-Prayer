import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import type { Transition } from "react-native-ease";

export function useReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) {
        setReducedMotion(enabled);
      }
    });

    const subscription = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);

    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

export function useMotionTransition(transition: Transition): Transition {
  const reducedMotion = useReducedMotion();
  return reducedMotion ? { type: "none" } : transition;
}
