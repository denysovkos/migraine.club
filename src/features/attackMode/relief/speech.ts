'use client';

/**
 * Spoken guidance through the device's own speech engine (Web Speech API).
 * Works offline on most phones, needs no audio files, and speaks whatever
 * language the app is in. Every call is a no-op where speech is missing.
 */

const VOICE_PREF_KEY = 'mc-relief-voice';

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export function speechAvailable(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== 'undefined';
}

/** Speak `text` calmly, replacing anything still being spoken. */
export function speak(text: string, lang: string) {
  const s = synth();
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') {
    return;
  }
  s.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = lang;
  utterance.rate = 0.85;
  utterance.pitch = 0.9;
  utterance.volume = 0.8;
  s.speak(utterance);
}

export function stopSpeaking() {
  synth()?.cancel();
}

/** Voice is off unless the user turned it on: sound can hurt during an attack. */
export function readVoicePref(): boolean {
  try {
    return window.localStorage.getItem(VOICE_PREF_KEY) === 'on';
  } catch {
    return false;
  }
}

export function writeVoicePref(on: boolean) {
  try {
    window.localStorage.setItem(VOICE_PREF_KEY, on ? 'on' : 'off');
  } catch {
    // Private mode or blocked storage: the choice just isn't remembered.
  }
}
