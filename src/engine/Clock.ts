import { getAudioContext } from "../audio/AudioContextSingleton";

export function audioNow(): number {
  return getAudioContext().currentTime;
}
