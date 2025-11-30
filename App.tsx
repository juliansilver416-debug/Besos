import React, { useState, useRef, useEffect } from 'react';
import { translateAudioContent, translateText } from './services/gemini';
import { ChatMessage, Language, Reaction } from './types';

// triggering redeploy

function useAudioRecorder(): {
  isRecording: boolean;
  audioBlob: Blob | null;
  startRecording: () => void;
  stopRecording: () => void;
  resetRecording: () => void;
} {
  const [isRecording, setIsRecording] = useState(false);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);

  const startRecording = () => {
    setIsRecording(true);
  };

  const stopRecording = () => {
    setIsRecording(false);
  };

  const resetRecording = () => {
    setIsRecording(false);
    setAudioBlob(null);
  };

  return {
    isRecording,
    audioBlob,
    startRecording,
    stopRecording,
    resetRecording,
  };
}

const ACCESS_CODE = "BESOS";
const BROADCAST_CHANNEL_NAME = 'besos_chat_channel';
const AVAILABLE_EMOJIS = ['❤️', '😂', '😮', '😢', '🔥', '👍'];

type AuthStage = 'LOCK' | 'ROLE_SELECT' | 'CHAT';

const App: React.FC = () => {
  // --- Auth State ---
  const [authStage, setAuthStage] = useState<AuthStage>('LOCK');
  const [accessInput, setAccessInput] = useState<string>('');
  const [authError, setAuthError] = useState<boolean>(false);
  const [myRole, setMyRole] = useState<Language | null>(null); // 'english' (Julian) or 'spanish' (Sami)

  // --- App State ---
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeReactionId, setActiveReactionId] = useState<string | null>(null);
  
  // Audio Playback State
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [audioAnnounce, setAudioAnnounce] = useState<string>(''); // For screen reader announcements
  const audioPlayerRef = useRef<HTMLAudioElement | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const { isRecording, startRecording, stopRecording, recordingTime } = useAudioRecorder();
  const channelRef = useRef<BroadcastChannel | null>(null);

  // UI State for Copy Feedback
  const [copiedLink, setCopiedLink] = useState<Language | null>(null);

  // --- Effects ---

  useEffect(() => {
    // 1. Check URL params for invite link first
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    const codeParam = params.get('code');

    if (codeParam === ACCESS_CODE && (roleParam === 'english' || roleParam === 'spanish')) {
      localStorage.setItem('besos_access_granted', 'true');
      setMyRole(roleParam as Language);
      setAuthStage('CHAT');
      // Clean URL to look nicer
      window.history.replaceState({}, '', window.location.pathname);
      return; 
    }

    // 2. Check for previous access in local storage if no URL params
    const storedAccess = localStorage.getItem('besos_access_granted');
    if (storedAccess === 'true') {
      setAuthStage('ROLE_SELECT');
    }

    // Setup Broadcast Channel for tab syncing (Simulates real-time for demo)
    const channel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    channelRef.current = channel;

    channel.onmessage = (event) => {
      const incomingMessage = event.data as ChatMessage;
      setMessages((prev) => {
        const index = prev.findIndex(m => m.id === incomingMessage.id);
        if (index !== -1) {
          // Update existing message (e.g. added reaction)
          const newArr = [...prev];
          newArr[index] = incomingMessage;
          return newArr;
        }
        // Add new message
        return [...prev, incomingMessage];
      });
    };

    return () => {
      channel.close();
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
      }
    };
  }, []);

  useEffect(() => {
    if (authStage === 'CHAT') {
      scrollToBottom();
    }
  }, [messages, authStage]);

  // Click outside listener to close emoji picker
  useEffect(() => {
    const handleClickOutside = () => setActiveReactionId(null);
    if (activeReactionId) {
      window.addEventListener('click', handleClickOutside);
    }
    return () => {
      window.removeEventListener('click', handleClickOutside);
    };
  }, [activeReactionId]);

  // --- Auth Handlers ---

  const handleUnlock = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    
    if (accessInput.trim().toUpperCase() === ACCESS_CODE) {
      localStorage.setItem('besos_access_granted', 'true');
      setAuthStage('ROLE_SELECT');
      setAuthError(false);
    } else {
      setAuthError(true);
      setAccessInput('');
      setTimeout(() => setAuthError(false), 2000);
    }
  };

  const selectRole = (role: Language) => {
    setMyRole(role);
    setAuthStage('CHAT');
  };

  const handleLogout = () => {
    setMyRole(null);
    setAuthStage('ROLE_SELECT');
  };

  const handleCopyInvite = (e: React.MouseEvent, role: Language) => {
    e.stopPropagation();
    const baseUrl = window.location.origin + window.location.pathname;
    const link = `${baseUrl}?role=${role}&code=${ACCESS_CODE}`;
    
    navigator.clipboard.writeText(link).then(() => {
      setCopiedLink(role);
      setTimeout(() => setCopiedLink(null), 2000);
    }).catch(err => {
      console.error("Failed to copy link", err);
    });
  };

  // --- Chat Handlers ---

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleStartRecording = async () => {
    if (isProcessing || inputText.trim().length > 0) return;
    await startRecording();
  };

  const handleStopRecording = async () => {
    if (inputText.trim().length > 0 || !myRole) return;
    
    try {
      setIsProcessing(true);
      const audioBase64 = await stopRecording() as string;
      const audioUrl = `data:audio/wav;base64,${audioBase64}`;
      
      const result = await translateAudioContent(audioBase64, myRole);
      await handleTranslationResult(result, myRole, audioUrl);
    } catch (error) {
      console.error("Voice Interaction failed", error);
      alert("Something went wrong with the voice translation. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  // Keyboard handlers for recording
  const handleKeyDownRecording = (e: React.KeyboardEvent) => {
    if (inputText.trim().length > 0 || isProcessing) return;
    if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
      e.preventDefault();
      handleStartRecording();
    }
  };

  const handleKeyUpRecording = (e: React.KeyboardEvent) => {
    if (inputText.trim().length > 0 || isProcessing) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      handleStopRecording();
    }
  };

  const handleSendText = async () => {
    if (!inputText.trim() || isProcessing || !myRole) return;

    try {
      setIsProcessing(true);
      const textToSend = inputText;
      setInputText(''); 
      const result = await translateText(textToSend, myRole);
      await handleTranslationResult(result, myRole);
    } catch (error) {
      console.error("Text Interaction failed", error);
      alert("Something went wrong with the text translation. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleTranslationResult = async (result: { transcription: string, translation: string }, sourceLang: Language, audioUrl?: string) => {
    const newMessage: ChatMessage = {
      id: Date.now().toString(),
      sender: sourceLang,
      originalText: result.transcription,
      translatedText: result.translation,
      timestamp: new Date(),
      reactions: [],
      audioUrl: audioUrl
    };
    
    // Update local state
    setMessages((prev) => [...prev, newMessage]);
    
    // Broadcast to other tabs
    channelRef.current?.postMessage(newMessage);
  };

  const handleToggleReaction = (e: React.MouseEvent, msgId: string, emoji: string) => {
    e.stopPropagation(); // Prevent closing the picker immediately
    if (!myRole) return;

    const updatedMessages = messages.map(msg => {
      if (msg.id !== msgId) return msg;

      const existingReactionIndex = msg.reactions.findIndex(
        r => r.emoji === emoji && r.sender === myRole
      );

      let newReactions = [...msg.reactions];
      if (existingReactionIndex > -1) {
        // Remove reaction
        newReactions.splice(existingReactionIndex, 1);
      } else {
        // Add reaction
        newReactions.push({ emoji, sender: myRole });
      }

      const updatedMsg = { ...msg, reactions: newReactions };
      // Broadcast update
      channelRef.current?.postMessage(updatedMsg);
      return updatedMsg;
    });

    setMessages(updatedMessages);
    setActiveReactionId(null);
  };

  const toggleAudio = (msgId: string, url: string) => {
    if (playingAudioId === msgId) {
      // Pause current
      audioPlayerRef.current?.pause();
      setPlayingAudioId(null);
      setAudioAnnounce("Voice memo paused");
    } else {
      // Stop previous if playing
      if (audioPlayerRef.current) {
        audioPlayerRef.current.pause();
        setPlayingAudioId(null);
      }
      
      // Play new
      const audio = new Audio(url);
      audio.onended = () => {
        setPlayingAudioId(null);
        setAudioAnnounce("Voice memo finished");
      };
      
      audio.play()
        .then(() => setAudioAnnounce("Voice memo playing"))
        .catch(e => {
            console.error("Playback failed", e);
            setAudioAnnounce("Error playing voice memo");
            setPlayingAudioId(null);
        });
      
      audioPlayerRef.current = audio;
      setPlayingAudioId(msgId);
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // UI State Helpers
  const isJulian = myRole === 'english';
  const hasText = inputText.trim().length > 0;
  
  // Theme helpers based on ROLE (not just sender)
  // We use these for the static UI elements like header/footer
  const themeColor = isJulian ? 'indigo' : 'rose';
  const gradientText = isJulian 
    ? 'from-indigo-600 to-blue-600' 
    : 'from-rose-600 to-pink-600';
  const buttonBg = isJulian 
    ? 'bg-indigo-600 hover:bg-indigo-700' 
    : 'bg-rose-500 hover:bg-rose-600';
  const ringFocus = isJulian
    ? 'focus:ring-indigo-200 focus:border-indigo-300'
    : 'focus:ring-rose-200 focus:border-rose-300';

  // --- Render Lock Screen ---
  
  if (authStage === 'LOCK') {
    return (
      <div className="flex items-center justify-center h-screen w-full bg-gradient-to-br from-indigo-50 via-white to-rose-50 p-6">
        <div className="w-full max-w-sm glass-panel p-8 rounded-3xl shadow-2xl flex flex-col items-center animate-in fade-in zoom-in duration-500">
          <div className="mb-6 p-4 rounded-full bg-gradient-to-tr from-indigo-500 to-rose-500 shadow-lg">
            <Lock className="w-8 h-8 text-white" aria-hidden="true" />
          </div>
          
          <h1 className="text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-rose-600 mb-2">
            Besos
          </h1>
          <p className="text-xs text-gray-500 mb-8 text-center">
            Enter the access code to continue.
          </p>

          <form onSubmit={handleUnlock} className="w-full flex flex-col gap-4">
            <div className="relative">
              <label htmlFor="access-code" className="sr-only">Access Code</label>
              <input
                id="access-code"
                type="password"
                value={accessInput}
                onChange={(e) => {
                  setAccessInput(e.target.value);
                  setAuthError(false);
                }}
                placeholder="Access Code"
                className={`
                  w-full text-center tracking-widest bg-white/50 border text-gray-800 text-sm rounded-xl px-4 py-3 
                  focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all shadow-inner
                  ${authError ? 'border-red-400 bg-red-50' : 'border-gray-200'}
                `}
                autoFocus
                aria-invalid={authError}
                aria-describedby={authError ? "auth-error" : undefined}
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gray-900 hover:bg-black text-white rounded-xl py-3 text-sm font-medium transition-all shadow-md active:scale-95 flex items-center justify-center gap-2 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-900"
            >
              <span>Enter</span>
              <ArrowRight className="w-4 h-4" />
            </button>
            
            {authError && (
              <p 
                id="auth-error" 
                role="alert" 
                className="text-[10px] text-red-500 font-medium text-center animate-pulse"
              >
                Incorrect access code
              </p>
            )}
          </form>
        </div>
      </div>
    );
  }

  // --- Render Role Selection ---

  if (authStage === 'ROLE_SELECT') {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-full bg-gradient-to-br from-gray-50 to-gray-100 p-6">
        <div className="text-center mb-8 animate-in slide-in-from-top-4 duration-700">
           <h1 className="text-3xl font-bold text-gray-800 mb-2">Welcome</h1>
           <p className="text-gray-500 text-sm">Who are you joining as?</p>
        </div>
        
        <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl justify-center items-stretch">
          
          {/* Julian Card */}
          <div className="flex-1 group relative bg-white rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-indigo-50 overflow-hidden flex flex-col">
            <div className="absolute top-0 right-0 p-32 bg-indigo-50 rounded-full -mr-16 -mt-16 group-hover:bg-indigo-100 transition-colors pointer-events-none"></div>
            
            {/* Share Button - Positioned top right */}
            <button 
              onClick={(e) => handleCopyInvite(e, 'english')}
              className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-white/60 hover:bg-white text-indigo-500 shadow-sm backdrop-blur-sm transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              title="Copy invite link for Julian"
              aria-label="Copy invite link for Julian"
            >
              {copiedLink === 'english' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
            </button>

            {/* Main Selection Button */}
            <button 
              onClick={() => selectRole('english')}
              className="flex-1 w-full p-6 flex flex-col items-center gap-4 text-center focus:outline-none focus:ring-4 focus:ring-indigo-200 focus:ring-inset relative z-10"
              aria-label="Join as Julian"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-indigo-500 to-blue-600 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300 mt-6">
                <User className="w-10 h-10 text-white" />
              </div>
              <div className="text-center mb-2">
                <h3 className="text-xl font-bold text-gray-800 mb-1">Julian</h3>
              </div>
              <div className="mt-auto w-8 h-8 rounded-full border-2 border-indigo-100 flex items-center justify-center group-hover:border-indigo-500 group-hover:bg-indigo-500 transition-all">
                <CheckCircle2 className="w-5 h-5 text-transparent group-hover:text-white transition-colors" />
              </div>
            </button>
          </div>

          {/* Sami Card */}
          <div className="flex-1 group relative bg-white rounded-3xl shadow-xl hover:shadow-2xl transition-all duration-300 hover:-translate-y-1 border border-rose-50 overflow-hidden flex flex-col">
            <div className="absolute top-0 right-0 p-32 bg-rose-50 rounded-full -mr-16 -mt-16 group-hover:bg-rose-100 transition-colors pointer-events-none"></div>

            {/* Share Button */}
            <button 
              onClick={(e) => handleCopyInvite(e, 'spanish')}
              className="absolute top-4 right-4 z-20 p-2.5 rounded-full bg-white/60 hover:bg-white text-rose-500 shadow-sm backdrop-blur-sm transition-all hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-rose-300"
              title="Copy invite link for Sami"
              aria-label="Copy invite link for Sami"
            >
              {copiedLink === 'spanish' ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Share2 className="w-4 h-4" />
              )}
            </button>

            {/* Main Selection Button */}
            <button 
              onClick={() => selectRole('spanish')}
              className="flex-1 w-full p-6 flex flex-col items-center gap-4 text-center focus:outline-none focus:ring-4 focus:ring-rose-200 focus:ring-inset relative z-10"
              aria-label="Join as Sami"
            >
              <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-rose-500 to-pink-500 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-300 mt-6">
                <Heart className="w-10 h-10 text-white fill-white" />
              </div>
              <div className="text-center mb-2">
                <h3 className="text-xl font-bold text-gray-800 mb-1">Sami</h3>
              </div>
              <div className="mt-auto w-8 h-8 rounded-full border-2 border-rose-100 flex items-center justify-center group-hover:border-rose-500 group-hover:bg-rose-500 transition-all">
                <CheckCircle2 className="w-5 h-5 text-transparent group-hover:text-white transition-colors" />
              </div>
            </button>
          </div>
        </div>
        
        {/* Help Text */}
        <p className="mt-8 text-[10px] text-gray-400 max-w-xs text-center">
          Tap the <Share2 className="w-3 h-3 inline mx-0.5 align-middle" /> icon to generate a magic link for yourself or your partner.
        </p>
      </div>
    );
  }

  // --- Render Main App ---

  return (
    <div className={`flex flex-col h-screen bg-gradient-to-br transition-colors duration-500 ease-in-out ${isJulian ? 'from-indigo-50 via-blue-50 to-white' : 'from-rose-50 via-pink-50 to-white'} text-gray-800 font-sans overflow-hidden`}>
      
      {/* Header */}
      <header className="flex-none p-3 glass-panel border-b border-white/40 shadow-sm z-10 transition-colors duration-300">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-lg shadow-lg transition-colors duration-500 bg-gradient-to-tr ${isJulian ? 'from-indigo-500 to-blue-400' : 'from-rose-500 to-pink-400'}`}>
              <Heart className="w-5 h-5 text-white fill-current" aria-hidden="true" />
            </div>
            <div>
              <h1 className={`text-lg font-bold bg-clip-text text-transparent bg-gradient-to-r ${gradientText} transition-all duration-500`}>
                Besos
              </h1>
              <p className="text-[10px] text-gray-500 font-medium flex items-center gap-1">
                <Globe className="w-2.5 h-2.5" aria-hidden="true" />
                {isJulian ? 'Logged in as Julian' : 'Logged in as Sami'}
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="hidden sm:block text-xs text-gray-400 font-medium bg-white/50 px-2 py-0.5 rounded-full mr-2">
              Gemini 2.5
            </div>
            <button
              onClick={handleLogout}
              className="p-2 rounded-full hover:bg-black/5 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
              title="Switch User"
              aria-label="Log out and switch user"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-3 scrollbar-hide relative" aria-live="polite">
        <div className="max-w-3xl mx-auto flex flex-col gap-4 pb-4">
          
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center mt-20 text-center opacity-40 select-none pointer-events-none transition-all duration-500">
              <User className={`w-16 h-16 mb-4 ${isJulian ? 'text-indigo-300' : 'text-rose-300'}`} aria-hidden="true" />
              <p className={`text-lg font-semibold ${isJulian ? 'text-indigo-900' : 'text-rose-900'}`}>Start the conversation</p>
              <p className={`text-xs max-w-xs mt-2 ${isJulian ? 'text-indigo-800/60' : 'text-rose-800/60'}`}>
                {isJulian ? "You are speaking as Julian." : "You are speaking as Sami."}
              </p>
            </div>
          )}

          {messages.map((msg) => {
            // "Me" is the logged in role. "Them" is the other role.
            const isMe = msg.sender === myRole;
            
            // Visual Styles for the *sender* of the message (regardless of who is viewing)
            // Julian's messages are ALWAYS Indigo. Sami's messages are ALWAYS Rose.
            const isMsgFromJulian = msg.sender === 'english';
            const isPlaying = playingAudioId === msg.id;

            // Aggregate reactions
            const uniqueReactions = Array.from(new Set(msg.reactions.map(r => r.emoji))).map(emoji => {
               const reactors = msg.reactions.filter(r => r.emoji === emoji).map(r => r.sender);
               const isMyReaction = reactors.includes(myRole!);
               return { emoji, isMyReaction, count: reactors.length };
            });

            return (
              <div 
                key={msg.id} 
                className={`flex w-full group ${isMe ? 'justify-start' : 'justify-end'}`}
              >
                <div className={`
                  relative max-w-[80%] sm:max-w-[65%] 
                  flex flex-col gap-1
                  ${isMe ? 'items-start' : 'items-end'}
                `}>
                  
                  {/* Name Label */}
                  <span className={`text-[9px] font-bold uppercase tracking-wider mb-0.5 px-1 ${isMsgFromJulian ? 'text-indigo-500' : 'text-rose-500'}`}>
                    {isMsgFromJulian ? 'Julian' : 'Sami'}
                  </span>

                  {/* Message Bubble + Reaction Trigger */}
                  <div className="relative group/bubble">
                    <div className={`
                      p-3 rounded-xl shadow-sm border border-white/50 backdrop-blur-sm transition-all duration-300 relative z-0
                      ${isMsgFromJulian 
                        ? 'bg-gradient-to-br from-indigo-500 to-blue-600 text-white' 
                        : 'bg-white text-gray-800 border-rose-100'}
                      ${isMe ? 'rounded-tl-none' : 'rounded-tr-none'}
                    `}>
                      
                      {/* Audio Player (Voice Memo) */}
                      {msg.audioUrl && (
                        <div 
                           className={`flex items-center gap-3 mb-2 pb-2 border-b ${isMsgFromJulian ? 'border-white/20' : 'border-gray-100'}`}
                           role="group"
                           aria-label={`Voice memo from ${isMsgFromJulian ? 'Julian' : 'Sami'}`}
                        >
                           <button 
                             onClick={(e) => {
                               e.stopPropagation();
                               toggleAudio(msg.id, msg.audioUrl!);
                             }}
                             className={`
                               w-8 h-8 rounded-full flex items-center justify-center transition-all focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-current
                               ${isMsgFromJulian 
                                 ? 'bg-white text-indigo-600 hover:bg-indigo-50' 
                                 : 'bg-rose-500 text-white hover:bg-rose-600'}
                             `}
                             aria-label={isPlaying ? "Pause voice memo" : "Play voice memo"}
                             aria-pressed={isPlaying}
                           >
                             {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current ml-0.5" />}
                           </button>
                           <div className="flex flex-col">
                             <span className={`text-[10px] font-bold uppercase ${isMsgFromJulian ? 'text-indigo-100' : 'text-gray-500'} flex items-center gap-2`}>
                               Voice Memo
                               {isPlaying && (
                                  <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[8px] bg-white/20 animate-pulse font-medium">
                                     Playing
                                  </span>
                               )}
                             </span>
                             <div className="flex gap-0.5 items-end h-3 mt-0.5" aria-hidden="true">
                               {[1,2,3,4,3,2,1,2,3].map((h, i) => (
                                 <div 
                                    key={i} 
                                    className={`w-0.5 rounded-full ${isMsgFromJulian ? 'bg-white/60' : 'bg-gray-300'} ${isPlaying ? 'animate-pulse' : ''}`}
                                    style={{ height: `${h * 2}px` }}
                                 />
                               ))}
                             </div>
                           </div>
                        </div>
                      )}

                      {/* Translated Text (Primary Focus) */}
                      <div className="text-sm font-medium leading-relaxed">
                        {msg.translatedText}
                      </div>

                      {/* Original Text (Subtle) */}
                      <div className={`
                        text-[10px] mt-1 pt-1 border-t 
                        ${isMsgFromJulian ? 'border-white/20 text-indigo-100' : 'border-gray-100 text-gray-400'}
                      `}>
                        Original: "{msg.originalText}"
                      </div>
                    </div>
                    
                    {/* Reaction Button (Visible on hover or focus) */}
                    <div className={`
                        absolute top-0 bottom-0 ${isMe ? '-right-8' : '-left-8'} 
                        flex items-center 
                        opacity-0 group-hover/bubble:opacity-100 focus-within:opacity-100 transition-opacity
                        ${activeReactionId === msg.id ? 'opacity-100' : ''}
                    `}>
                        <button 
                            onClick={(e) => {
                                e.stopPropagation();
                                setActiveReactionId(activeReactionId === msg.id ? null : msg.id);
                            }}
                            className="p-1 rounded-full bg-white/50 hover:bg-white text-gray-500 shadow-sm backdrop-blur-sm focus:outline-none focus:ring-2 focus:ring-gray-300 focus:bg-white"
                            aria-label="Add reaction to message"
                            aria-expanded={activeReactionId === msg.id}
                        >
                            <Smile className="w-3 h-3" aria-hidden="true" />
                        </button>
                    </div>

                    {/* Emoji Picker Popover */}
                    {activeReactionId === msg.id && (
                        <div 
                          className={`
                            absolute bottom-full mb-2 ${isMe ? 'left-0' : 'right-0'}
                            bg-white rounded-full shadow-xl border border-gray-100 p-1.5 flex gap-1 z-50 animate-in zoom-in-90 duration-200
                          `}
                          role="dialog"
                          aria-label="Choose an emoji"
                        >
                            {AVAILABLE_EMOJIS.map(emoji => (
                                <button
                                    key={emoji}
                                    onClick={(e) => handleToggleReaction(e, msg.id, emoji)}
                                    className="w-7 h-7 flex items-center justify-center text-lg hover:bg-gray-100 rounded-full transition-colors hover:scale-125 duration-200 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                                    aria-label={`React with ${emoji}`}
                                >
                                    {emoji}
                                </button>
                            ))}
                        </div>
                    )}
                  </div>

                  {/* Reactions Display */}
                  {uniqueReactions.length > 0 && (
                      <div className={`flex flex-wrap gap-1 mt-0.5 ${isMe ? 'justify-start' : 'justify-end'}`}>
                          {uniqueReactions.map((reaction, idx) => (
                              <button
                                key={idx}
                                onClick={(e) => handleToggleReaction(e, msg.id, reaction.emoji)}
                                className={`
                                    px-1.5 py-0.5 rounded-full text-[10px] flex items-center gap-0.5 shadow-sm border
                                    transition-all hover:scale-110 focus:outline-none focus:ring-2
                                    ${reaction.isMyReaction 
                                        ? (isJulian ? 'bg-indigo-50 border-indigo-200 text-indigo-600 focus:ring-indigo-300' : 'bg-rose-50 border-rose-200 text-rose-600 focus:ring-rose-300') 
                                        : 'bg-white border-gray-100 text-gray-500 focus:ring-gray-300'}
                                `}
                                aria-label={`${reaction.count} person${reaction.count > 1 ? 's' : ''} reacted with ${reaction.emoji}. Click to ${reaction.isMyReaction ? 'remove' : 'add'} reaction.`}
                              >
                                  <span>{reaction.emoji}</span>
                                  {reaction.count > 1 && <span className="font-bold opacity-70">{reaction.count}</span>}
                              </button>
                          ))}
                      </div>
                  )}

                  {/* Timestamp */}
                  <span className="text-[9px] text-gray-400 px-1">
                    {msg.timestamp instanceof Date ? msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            );
          })}
          
          {/* Loading Indicator */}
          {isProcessing && (
            <div className="flex justify-center w-full py-4 animate-pulse" aria-live="polite">
               <div className="bg-white/60 px-3 py-1.5 rounded-full flex items-center gap-2 shadow-sm">
                 <Loader2 className={`w-3.5 h-3.5 animate-spin ${isJulian ? 'text-indigo-600' : 'text-rose-600'}`} aria-hidden="true" />
                 <span className={`text-[10px] font-medium ${isJulian ? 'text-indigo-800' : 'text-rose-800'}`}>Translating...</span>
               </div>
            </div>
          )}
          
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Controls Footer */}
      <footer className="flex-none p-3 bg-white/80 backdrop-blur-md border-t border-gray-200/50 shadow-xl z-20">
        <div className="max-w-3xl mx-auto flex flex-col gap-3">
          
          {/* Input & Action Row */}
          <div className="flex items-end gap-2 relative">
            
            {/* Input Field */}
            <div className={`
              flex-1 relative transition-all duration-300
              ${isRecording ? 'opacity-50 blur-[1px]' : 'opacity-100'}
            `}>
               <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                 <Keyboard className="w-4 h-4 text-gray-300" aria-hidden="true" />
              </div>
              <label htmlFor="message-input" className="sr-only">Type your message</label>
              <input
                id="message-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={isRecording ? 'Listening...' : `Message as ${isJulian ? 'Julian' : 'Sami'}...`}
                disabled={isRecording || isProcessing}
                className={`w-full bg-gray-5 border border-gray-200 text-gray-800 text-sm rounded-2xl pl-10 pr-4 py-3 focus:outline-none focus:ring-2 shadow-inner transition-all placeholder:text-gray-400 ${ringFocus}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
                aria-label="Message input"
              />
               {isRecording && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-red-500 animate-pulse" role="status">
                  {formatTime(recordingTime)}
                </div>
              )}
            </div>

            {/* Main Action Button */}
            <button
              disabled={isProcessing}
              // Voice Events (Only if NO text)
              onMouseDown={!hasText ? handleStartRecording : undefined}
              onMouseUp={!hasText ? handleStopRecording : undefined}
              onTouchStart={!hasText ? handleStartRecording : undefined}
              onTouchEnd={!hasText ? handleStopRecording : undefined}
              
              // Keyboard Recording Events
              onKeyDown={!hasText ? handleKeyDownRecording : undefined}
              onKeyUp={!hasText ? handleKeyUpRecording : undefined}

              // Text Event (Only if HAS text)
              onClick={hasText ? handleSendText : undefined}
              
              className={`
                flex-none w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300 shadow-lg text-white
                focus:outline-none focus:ring-4 focus:ring-offset-2
                ${buttonBg}
                ${isProcessing ? 'opacity-70 cursor-wait' : 'cursor-pointer active:scale-95'}
                ${isRecording ? 'scale-110 ring-4 ring-offset-2 ring-red-200 !bg-red-500' : ''}
                ${isJulian ? 'focus:ring-indigo-200' : 'focus:ring-rose-200'}
              `}
              aria-label={hasText ? "Send message" : "Hold to record audio"}
            >
               {hasText ? (
                  <Send className="w-5 h-5 ml-0.5" aria-hidden="true" />
               ) : (
                  <Mic className={`w-5 h-5 ${isRecording ? 'animate-bounce' : ''}`} aria-hidden="true" />
               )}
            </button>
          </div>
        </div>
      </footer>
      
      {/* Hidden Live Region for Audio Status */}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {audioAnnounce}
      </div>

    </div>
  );
};

export default App;
