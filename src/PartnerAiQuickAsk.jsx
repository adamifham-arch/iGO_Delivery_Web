import { useEffect, useState } from 'react';
import { loadAiAssistantVisibility } from './igoDatabase';
import './PartnerAiQuickAsk.css';

export default function PartnerAiQuickAsk() {
  const [enabled, setEnabled] = useState(false);
  const [question, setQuestion] = useState('');
  const [checking, setChecking] = useState(false);

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
    <section className="partner-ai-quick-ask" aria-label="Ask iGO AI about your deliveries">
      <div className="partner-ai-quick-ask-heading">
        <div className="partner-ai-quick-ask-icon" aria-hidden="true">✦</div>
        <div>
          <h2>How can iGO AI help?</h2>
          <p>Ask about a delivery, your invoices or registering a package.</p>
        </div>
      </div>
      <form onSubmit={ask} className="partner-ai-quick-ask-form">
        <label className="partner-ai-quick-ask-label" htmlFor="partner-ai-question">
          Ask iGO AI
        </label>
        <div className="partner-ai-quick-ask-controls">
          <input
            id="partner-ai-question"
            type="text"
            autoComplete="off"
            aria-label="What would you like to ask iGO AI?"
            placeholder="What would you like help with?"
            maxLength={1200}
            value={question}
            onChange={event => setQuestion(event.target.value)}
          />
          <button type="submit" disabled={checking || !question.trim()}>
            {checking ? 'Opening…' : 'Ask iGO'}
          </button>
        </div>
      </form>
      <p className="partner-ai-quick-ask-footnote">Your request will open in the iGO AI assistant for you to review and continue.</p>
    </section>
  );
}
