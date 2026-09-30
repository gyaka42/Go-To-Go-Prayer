import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getOnboardingSeen, saveOnboardingSeen } from "@/services/storage";

type OnboardingContextValue = {
  onboardingSeen: boolean | null;
  completeOnboarding: () => Promise<void>;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [onboardingSeen, setOnboardingSeen] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      const seen = await getOnboardingSeen();
      if (active) {
        setOnboardingSeen(seen);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const completeOnboarding = useCallback(async () => {
    await saveOnboardingSeen(true);
    setOnboardingSeen(true);
  }, []);

  const value = useMemo(
    () => ({ onboardingSeen, completeOnboarding }),
    [completeOnboarding, onboardingSeen]
  );

  return <OnboardingContext.Provider value={value}>{children}</OnboardingContext.Provider>;
}

export function useOnboarding(): OnboardingContextValue {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error("useOnboarding must be used within OnboardingProvider");
  }
  return context;
}
