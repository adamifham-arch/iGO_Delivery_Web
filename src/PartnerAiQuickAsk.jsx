import { useEffect, useState } from 'react';
import { loadAiAssistantVisibility } from './igoDatabase';
import './PartnerAiQuickAsk.css';

// Short examples rotate only while the input is empty and not focused.
// These are suggestions, never automatic requests to the AI service.
const suggestedQuestions = [
  'How do I register a package?',
  'Where can I track my packages?',
  'How do I check my invoices?',
  'How can I submit a payment?',
  'What are the delivery rates?',
  'Which areas does iGO cover?',
];
const randomSuggestion = () => Math.floor(Math.random() * suggestedQuestions.length);

export default function PartnerAiQuickAsk() {
  const [enabled, setEnabled] = useState(false);
  const [question, setQuestion] = useState('');
  const [checking, setChecking] = useState(false);
  const [focused, setFocused] = useState(false);
  const [suggestionIndex, setSuggestionIndex] = useState(randomSuggestion);

  // Change the example approximately every seven seconds without interrupting typing.
  useEffect(() => {
    if (focused || question.trim()) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      setSuggestionIndex(previous =>
        (previous + 1 + Math.floor(Math.random() * (suggestedQuestions.length - 1))) % suggestedQuestions.length
      );
    }, 7000);
    return () => window.clearInterval(timer);
  }, [focused, question]);

  // Use the same site-wide superadmin switch as the floating assistant.
  useEffect(() => {
    let mounted = true;
    const refresh = async () => {
      try {
        const allowed = await loadAiAssistantVisibility();
        if (mounted) setEnabled(Boolean(allowed));
      } catch {
        // Fail closed if visibility cannot be checked.
        if (mounted) setEnabled(false);
      }
    };
    void refresh();
    const timer = window.setInterval(refresh, 30000);
    const onFocus = () => { void refresh(); };
    const onStorage = event => {
      if (event.key === 'igo-ai-visibility-refresh') void refresh();
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    window.addEventListener('igo-ai-visibility-changed', onFocus);
    return () => {
      mounted = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('igo-ai-visibility-changed', onFocus);
    };
  }, []);

  async function ask(event) {
    event.preventDefault();
    const prompt = question.trim();
    if (!prompt || checking) return;
    setChecking(true);
    try {
      // Re-check at submission time so a newly disabled bot cannot be opened.
      const allowed = await loadAiAssistantVisibility();
      setEnabled(Boolean(allowed));
      if (!allowed) return;
      window.dispatchEvent(new CustomEvent('igo-ai-quick-ask', {
        detail: { message: prompt },
      }));
      setQuestion('');
    } catch {
      setEnabled(false);
    } finally {
      setChecking(false);
    }
  }

  if (!enabled) return null;

  return (
    <section className="partner-ai-quick-ask" aria-label="Ask iGO AI">
      <form onSubmit={ask} className="partner-ai-quick-ask-form">
        <span className="partner-ai-quick-ask-icon" aria-hidden="true">✦</span>
        <input
          id="partner-ai-question"
          type="text"
          autoComplete="off"
          aria-label="Ask iGO AI"
          placeholder={suggestedQuestions[suggestionIndex]}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          maxLength={1200}
          value={question}
          onChange={event => setQuestion(event.target.value)}
        />
        <button type="submit" disabled={checking || !question.trim()}>
          {checking ? 'Opening…' : 'Ask iGO'}
        </button>
      </form>
    </section>
  );
}
