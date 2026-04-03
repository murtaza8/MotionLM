import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

import { useStore } from "@/store";

// ---------------------------------------------------------------------------
// SpeechRecognition type shim — not in default TS lib
// ---------------------------------------------------------------------------

interface SpeechRecognitionResultItem {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionResult {
  readonly length: number;
  item(index: number): SpeechRecognitionResultItem;
  [index: number]: SpeechRecognitionResultItem;
  isFinal: boolean;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionInstance;

interface WindowWithSpeech {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
}

// ---------------------------------------------------------------------------
// VoiceInputHandle
// ---------------------------------------------------------------------------

export interface VoiceInputHandle {
  /** Toggle recording on/off. No-op if SpeechRecognition is unavailable. */
  toggle: () => void;
}

// ---------------------------------------------------------------------------
// VoiceInput
// ---------------------------------------------------------------------------

interface VoiceInputProps {
  onTranscript: (text: string, frame: number) => void;
  onActiveChange: (active: boolean) => void;
  disabled?: boolean;
}

/**
 * Purely behavioral component — renders nothing.
 * Activates via Cmd+Shift+V (toggle) or the imperative `toggle()` handle.
 * If SpeechRecognition is unavailable, returns null and the handle is a no-op.
 */
export const VoiceInput = forwardRef<VoiceInputHandle, VoiceInputProps>(
  ({ onTranscript, onActiveChange, disabled }, ref) => {
    const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
    const capturedFrameRef = useRef<number>(0);

    // Stable refs for callbacks so event handlers never go stale
    const onTranscriptRef = useRef(onTranscript);
    const onActiveChangeRef = useRef(onActiveChange);
    const disabledRef = useRef(disabled);
    onTranscriptRef.current = onTranscript;
    onActiveChangeRef.current = onActiveChange;
    disabledRef.current = disabled;

    const getSpeechAPI = (): SpeechRecognitionConstructor | undefined => {
      const win = window as unknown as WindowWithSpeech;
      return win.SpeechRecognition ?? win.webkitSpeechRecognition;
    };

    const startRecording = (): void => {
      const SpeechRecognitionAPI = getSpeechAPI();
      if (!SpeechRecognitionAPI || recognitionRef.current) return;

      const recognition = new SpeechRecognitionAPI();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        const transcript = event.results[0]?.[0]?.transcript ?? "";
        if (transcript) {
          // Capture frame at transcript receipt so the label reflects where
          // the timeline actually was when the user finished speaking.
          capturedFrameRef.current = useStore.getState().currentFrame;
          onTranscriptRef.current(transcript, capturedFrameRef.current);
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        onActiveChangeRef.current(false);
      };

      recognition.onerror = () => {
        recognitionRef.current = null;
        onActiveChangeRef.current(false);
      };

      recognition.start();
      recognitionRef.current = recognition;
      onActiveChangeRef.current(true);
    };

    const stopRecording = (): void => {
      recognitionRef.current?.stop();
      // onend fires asynchronously and clears the ref + calls onActiveChange(false)
    };

    const toggle = (): void => {
      if (!getSpeechAPI()) return;
      if (recognitionRef.current) {
        stopRecording();
      } else {
        startRecording();
      }
    };

    useImperativeHandle(ref, () => ({ toggle }));

    useEffect(() => {
      const SpeechRecognitionAPI = getSpeechAPI();
      if (!SpeechRecognitionAPI) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (disabledRef.current) return;
        // Cmd+Shift+V (mac) or Ctrl+Shift+V (windows/linux)
        if (e.key === "v" && (e.metaKey || e.ctrlKey) && e.shiftKey) {
          e.preventDefault();
          toggle();
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        recognitionRef.current?.stop();
        recognitionRef.current = null;
      };
      // toggle is stable (defined inline) — eslint-disable-next-line exhaustive-deps is intentional
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return null;
  }
);

VoiceInput.displayName = "VoiceInput";
