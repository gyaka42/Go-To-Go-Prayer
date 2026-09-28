import {
  AudioPlayer,
  AudioSource,
  AudioStatus,
  createAudioPlayer,
  setAudioModeAsync
} from "expo-audio";

export type PlaybackStatus = {
  isLoaded: boolean;
  isPlaying: boolean;
  positionMillis: number;
  durationMillis: number;
  didJustFinish: boolean;
};

type PlaybackSubscription = { remove(): void };
type ObservableAudioPlayer = AudioPlayer & {
  addListener(
    event: "playbackStatusUpdate",
    listener: (status: AudioStatus) => void
  ): PlaybackSubscription;
};

function toPlaybackStatus(status: AudioStatus): PlaybackStatus {
  return {
    isLoaded: status.isLoaded,
    isPlaying: status.playing,
    positionMillis: Math.max(0, Math.round(status.currentTime * 1000)),
    durationMillis: Math.max(0, Math.round(status.duration * 1000)),
    didJustFinish: status.didJustFinish
  };
}

export async function configurePlaybackAudio(): Promise<void> {
  await setAudioModeAsync({
    playsInSilentMode: true,
    shouldPlayInBackground: false
  });
}

export class ManagedAudioPlayer {
  private subscription: PlaybackSubscription | null = null;
  private released = false;

  constructor(private readonly player: ObservableAudioPlayer) {}

  setOnPlaybackStatusUpdate(listener: ((status: PlaybackStatus) => void) | null): void {
    this.subscription?.remove();
    this.subscription = null;
    if (!listener || this.released) {
      return;
    }
    this.subscription = this.player.addListener("playbackStatusUpdate", (status) => {
      listener(toPlaybackStatus(status));
    });
  }

  async getStatusAsync(): Promise<PlaybackStatus> {
    return toPlaybackStatus(this.player.currentStatus);
  }

  async playAsync(): Promise<void> {
    this.player.play();
  }

  async pauseAsync(): Promise<void> {
    this.player.pause();
  }

  async stopAsync(): Promise<void> {
    this.player.pause();
    await this.player.seekTo(0);
  }

  async setPositionAsync(positionMillis: number): Promise<void> {
    await this.player.seekTo(Math.max(0, positionMillis) / 1000);
  }

  async unloadAsync(): Promise<void> {
    if (this.released) {
      return;
    }
    this.subscription?.remove();
    this.subscription = null;
    this.released = true;
    this.player.remove();
  }
}

export async function createManagedAudioPlayer(source: AudioSource): Promise<ManagedAudioPlayer> {
  const player = createAudioPlayer(source, { updateInterval: 500 }) as ObservableAudioPlayer;
  return new ManagedAudioPlayer(player);
}
