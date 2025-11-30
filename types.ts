export type Language = 'english' | 'spanish';

export interface Reaction {
  emoji: string;
  sender: Language;
}

export interface ChatMessage {
  id: string;
  sender: Language; // 'english' means sent by the English speaker (You), 'spanish' means sent by the Spanish speaker (Her)
  originalText: string;
  translatedText: string;
  timestamp: Date;
  reactions: Reaction[];
  audioUrl?: string; // Data URI for the voice memo
}

export interface TranslationResponse {
  transcription: string;
  translation: string;
}

export interface RecorderState {
  isRecording: boolean;
  recordingTime: number;
}