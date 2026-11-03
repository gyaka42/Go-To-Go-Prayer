import { useBottomTabBarHeight } from "expo-router/js-tabs";
import { RamadanScreen } from "../ramadan";

export default function RamadanTabScreen() {
  const tabBarHeight = useBottomTabBarHeight();
  return <RamadanScreen asTab tabBarHeight={tabBarHeight} />;
}
