import {
  configurePlaybackAudio,
  createManagedAudioPlayer,
  ManagedAudioPlayer,
  PlaybackStatus
} from "@/services/audioPlayer";

let currentSound: ManagedAudioPlayer | null = null;

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

  await configurePlaybackAudio();

  const sound = await createManagedAudioPlayer(require("../../assets/sounds/majid_al_hamthany.wav"));

  currentSound = sound;
  sound.setOnPlaybackStatusUpdate((status: PlaybackStatus) => {
    if (!status.isLoaded) {
      return;
    }
    if (status.didJustFinish) {
      void cleanupCurrentSound();
    }
  });
  await sound.playAsync();
}

export async function stopAdhanPlayback(): Promise<void> {
  await cleanupCurrentSound();
}

