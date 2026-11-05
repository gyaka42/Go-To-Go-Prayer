import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { RamadanDayEntry, RamadanDailyPlanEntry, RamadanDailyPlanKey, RamadanFastStatus } from "@/services/storage";

export type RamadanPreviewDay = 1 | 15 | 29 | null;

type RamadanPreviewContextValue = {
  previewDay: RamadanPreviewDay;
  setPreviewDay: (day: RamadanPreviewDay) => void;
  previewFastEntries: Record<string, RamadanDayEntry>;
  setPreviewFastStatus: (dateKey: string, status: RamadanFastStatus | null) => void;
  previewDailyPlans: Record<string, RamadanDailyPlanEntry>;
  togglePreviewDailyPlanItem: (dateKey: string, key: RamadanDailyPlanKey) => void;
};

const RamadanPreviewContext = createContext<RamadanPreviewContextValue | null>(null);

export function RamadanPreviewProvider({ children }: { children: ReactNode }) {
  const [previewDay, setPreviewDay] = useState<RamadanPreviewDay>(null);
  const [previewFastEntries, setPreviewFastEntries] = useState<Record<string, RamadanDayEntry>>({});
  const [previewDailyPlans, setPreviewDailyPlans] = useState<Record<string, RamadanDailyPlanEntry>>({});

  const value = useMemo<RamadanPreviewContextValue>(() => ({
    previewDay,
    setPreviewDay,
    previewFastEntries,
    setPreviewFastStatus: (dateKey, status) => {
      setPreviewFastEntries((current) => {
        const next = { ...current };
        if (status) {
          next[dateKey] = { status, updatedAt: Date.now() };
        } else {
          delete next[dateKey];
        }
        return next;
      });
    },
    previewDailyPlans,
    togglePreviewDailyPlanItem: (dateKey, key) => {
      setPreviewDailyPlans((current) => {
        const previous = current[dateKey] ?? {
          quran: false,
          zikr: false,
          dua: false,
          charity: false,
          updatedAt: Date.now()
        };
        return {
          ...current,
          [dateKey]: {
            ...previous,
            [key]: !previous[key],
            updatedAt: Date.now()
          }
        };
      });
    }
  }), [previewDailyPlans, previewDay, previewFastEntries]);

  return (
    <RamadanPreviewContext.Provider value={value}>
      {children}
    </RamadanPreviewContext.Provider>
  );
}

export function useRamadanPreview(): RamadanPreviewContextValue {
  const value = useContext(RamadanPreviewContext);
  if (!value) {
    throw new Error("useRamadanPreview must be used within RamadanPreviewProvider");
  }
  return value;
}
