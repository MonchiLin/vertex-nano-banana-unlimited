import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';

export const useKeyboardShortcuts = () => {
  const {
    setShowHistory,
    showHistory,
    setShowPromptPanel,
    showPromptPanel,
    currentPrompt,
    isGenerating
  } = useAppStore();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (event.target instanceof HTMLInputElement || 
          event.target instanceof HTMLTextAreaElement) {
        // Only handle Cmd/Ctrl + Enter for generation
        if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
          event.preventDefault();
          if (!isGenerating && currentPrompt.trim()) {
            console.log('Generate via keyboard shortcut');
          }
        }
        return;
      }

      switch (event.key.toLowerCase()) {
        case 'h':
          event.preventDefault();
          setShowHistory(!showHistory);
          break;
        case 'p':
          event.preventDefault();
          setShowPromptPanel(!showPromptPanel);
          break;
        case 'r':
          if (event.shiftKey) {
            event.preventDefault();
            console.log('Re-roll variants');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setShowHistory, showHistory, setShowPromptPanel, showPromptPanel, currentPrompt, isGenerating]);
};