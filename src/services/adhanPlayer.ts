import { Audio, AVPlaybackStatus } from "expo-av";

let currentSound: Audio.Sound | null = null;

async function cleanupCurrentSound(): Promise<void> {
  if (!currentSound) {
    return;
  }

  try {
    await currentSound.stopAsync();
  } catch {
    // Ignore cleanup errors.
  }

  try {
    await currentSound.unloadAsync();
  } catch {
    // Ignore cleanup errors.
  }

  currentSound = null;
}

export async function playFullAdhan(): Promise<void> {
  await cleanupCurrentSound();

  await Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    staysActiveInBackground: false
  });

  const { sound } = await Audio.Sound.createAsync(
    require("../../assets/sounds/majid_al_hamthany.wav"),
    { shouldPlay: true }
  );

  currentSound = sound;
  sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
    if (!status.isLoaded) {
      return;
    }
    if (status.didJustFinish) {
      void cleanupCurrentSound();
    }
  });
}

export async function stopAdhanPlayback(): Promise<void> {
  await cleanupCurrentSound();
}

