import { Ionicons } from "@expo/vector-icons";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

export default function QiblaScreen() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Ionicons name="compass" size={48} color="#2B8CEE" />
          <Text style={styles.title}>Qibla</Text>
          <Text style={styles.subtitle}>Qibla finder komt in v1.1. Deze tab staat alvast klaar.</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#081321"
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 860,
    alignSelf: "center",
    padding: 20,
    justifyContent: "center"
  },
  card: {
    borderRadius: 20,
    backgroundColor: "#162638",
    borderWidth: 1,
    borderColor: "#1D3349",
    padding: 24,
    alignItems: "center"
  },
  title: {
    marginTop: 12,
    fontSize: 24,
    fontWeight: "800",
    color: "#EDF4FF"
  },
  subtitle: {
    marginTop: 8,
    fontSize: 14,
    color: "#8EA4BF",
    textAlign: "center"
  }
});
