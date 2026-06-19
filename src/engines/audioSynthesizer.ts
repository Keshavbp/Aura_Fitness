import { Platform } from 'react-native';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';

// Cooldown safety tracker for vocal alerts
let lastSpeechTimestamp = 0;
const SPEECH_COOLDOWN_MS = 4500;

// Dynamic Base64 encoder for the WAV ArrayBuffer
function base64Encode(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  let i = 0;
  while (i < bytes.length) {
    const byte1 = bytes[i++];
    const byte2 = i < bytes.length ? bytes[i++] : NaN;
    const byte3 = i < bytes.length ? bytes[i++] : NaN;

    const enc1 = byte1 >> 2;
    const enc2 = ((byte1 & 3) << 4) | (isNaN(byte2) ? 0 : byte2 >> 4);
    const enc3 = isNaN(byte2) ? 64 : ((byte2 & 15) << 2) | (isNaN(byte3) ? 0 : byte3 >> 6);
    const enc4 = isNaN(byte3) ? 64 : byte3 & 63;

    result += chars[enc1] + chars[enc2] + (enc3 === 64 ? '=' : chars[enc3]) + (enc4 === 64 ? '=' : chars[enc4]);
  }
  return result;
}

// Generates a 16-bit Mono PCM WAV file of 587.33Hz (D5) with exponential decay
function generateD5ChimeWavBase64(): string {
  const sampleRate = 8000; // 8 kHz
  const duration = 0.15; // 0.15s decay
  const numSamples = sampleRate * duration;
  const frequency = 587.33; // D5 frequency

  const buffer = new ArrayBuffer(44 + numSamples * 2);
  const view = new DataView(buffer);

  // RIFF header
  view.setUint8(0, 'R'.charCodeAt(0));
  view.setUint8(1, 'I'.charCodeAt(0));
  view.setUint8(2, 'F'.charCodeAt(0));
  view.setUint8(3, 'F'.charCodeAt(0));
  view.setUint32(4, 36 + numSamples * 2, true);
  
  view.setUint8(8, 'W'.charCodeAt(0));
  view.setUint8(9, 'A'.charCodeAt(0));
  view.setUint8(10, 'V'.charCodeAt(0));
  view.setUint8(11, 'E'.charCodeAt(0));

  // fmt chunk
  view.setUint8(12, 'f'.charCodeAt(0));
  view.setUint8(13, 'm'.charCodeAt(0));
  view.setUint8(14, 't'.charCodeAt(0));
  view.setUint8(15, ' '.charCodeAt(0));
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate (sampleRate * 2)
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // 16 bits per sample

  // data chunk
  view.setUint8(36, 'd'.charCodeAt(0));
  view.setUint8(37, 'a'.charCodeAt(0));
  view.setUint8(38, 't'.charCodeAt(0));
  view.setUint8(39, 'a'.charCodeAt(0));
  view.setUint32(40, numSamples * 2, true);

  // Write sine wave samples with exponential decay
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const decay = Math.exp(-t / 0.04); // exponential decay over 0.15s
    const amplitude = 32767 * 0.8; // 80% volume
    const val = Math.sin(2 * Math.PI * frequency * t) * decay * amplitude;
    view.setInt16(44 + i * 2, Math.round(val), true);
  }

  return base64Encode(buffer);
}

const d5ChimeBase64 = generateD5ChimeWavBase64();
let chimeSound: Audio.Sound | null = null;

// Initialize sound object
async function loadChime() {
  if (Platform.OS === 'web') return; // Web uses native HTML5 Audio directly in playRepCompletionChime
  if (!chimeSound) {
    try {
      const uri = `data:audio/wav;base64,${d5ChimeBase64}`;
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: false }
      );
      chimeSound = sound;
    } catch (error) {
      console.warn("Failed to load D5 audio chime", error);
    }
  }
}

// Play D5 chime (resolves rep validation)
export async function playRepCompletionChime() {
  try {
    if (Platform.OS === 'web') {
      const audio = new (window as any).Audio(`data:audio/wav;base64,${d5ChimeBase64}`);
      await audio.play();
      return;
    }
    await loadChime();
    if (chimeSound) {
      await chimeSound.replayAsync();
    }
  } catch (error) {
    console.warn("Failed to play rep completion chime", error);
  }
}

// Speak warning string with 4.5s cooldown guard
export function speakVocalCoachingAlert(alertMessage: string) {
  const now = Date.now();
  if (now - lastSpeechTimestamp >= SPEECH_COOLDOWN_MS) {
    lastSpeechTimestamp = now;
    if (Platform.OS === 'web') {
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(alertMessage);
          utterance.lang = 'en-US';
          window.speechSynthesis.speak(utterance);
        }
      } catch (err) {
        console.warn("Web SpeechSynthesis failed", err);
      }
      return;
    }
    Speech.speak(alertMessage, {
      language: 'en',
      rate: 1.0,
      pitch: 1.0,
      onError: (err) => console.warn("TTS Error", err)
    });
  }
}
