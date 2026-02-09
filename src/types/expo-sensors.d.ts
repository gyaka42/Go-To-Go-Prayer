declare module "expo-sensors" {
  export const Magnetometer: {
    isAvailableAsync: () => Promise<boolean>;
    setUpdateInterval: (intervalMs: number) => void;
    addListener: (listener: (data: { x: number; y: number; z: number }) => void) => { remove: () => void };
  };
}
