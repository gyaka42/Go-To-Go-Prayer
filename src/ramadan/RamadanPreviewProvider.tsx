import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type RamadanPreviewDay = 1 | 15 | 29 | null;

type RamadanPreviewContextValue = {
  previewDay: RamadanPreviewDay;
  setPreviewDay: (day: RamadanPreviewDay) => void;
};

const RamadanPreviewContext = createContext<RamadanPreviewContextValue | null>(null);

export function RamadanPreviewProvider({ children }: { children: ReactNode }) {
  const [previewDay, setPreviewDay] = useState<RamadanPreviewDay>(null);
  const value = useMemo(() => ({ previewDay, setPreviewDay }), [previewDay]);

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
