import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readVoicePref, speak, speechAvailable, stopSpeaking, writeVoicePref } from './speech';

class FakeUtterance {
  text: string;
  lang = '';
  rate = 1;
  pitch = 1;
  volume = 1;
  constructor(text: string) {
    this.text = text;
  }
}

describe('speech', () => {
  const synth = { speak: vi.fn(), cancel: vi.fn() };

  beforeEach(() => {
    synth.speak.mockReset();
    synth.cancel.mockReset();
    vi.stubGlobal('window', { speechSynthesis: synth, localStorage: new Map() });
    vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('speaks calmly in the app language, cutting off the previous step', () => {
    expect(speechAvailable()).toBe(true);

    speak('Breathe in', 'uk');

    expect(synth.cancel).toHaveBeenCalled();

    const [utterance] = synth.speak.mock.calls[0]!;

    expect(utterance).toMatchObject({ text: 'Breathe in', lang: 'uk' });
    expect(utterance.rate).toBeLessThan(1);
    expect(utterance.volume).toBeLessThan(1);

    stopSpeaking();

    expect(synth.cancel).toHaveBeenCalledTimes(2);
  });

  it('does nothing where the device has no speech engine', () => {
    vi.stubGlobal('window', {});

    expect(speechAvailable()).toBe(false);
    expect(() => speak('x', 'en')).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
  });

  it('keeps voice off by default and remembers the choice', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('window', {
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    });

    expect(readVoicePref()).toBe(false);

    writeVoicePref(true);

    expect(readVoicePref()).toBe(true);

    writeVoicePref(false);

    expect(readVoicePref()).toBe(false);
  });

  it('survives blocked storage', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => {
          throw new Error('blocked');
        },
        setItem: () => {
          throw new Error('blocked');
        },
      },
    });

    expect(readVoicePref()).toBe(false);
    expect(() => writeVoicePref(true)).not.toThrow();
  });
});
