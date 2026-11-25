import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { createPackages, getCurrentPartnerId, loadAiAssistantVisibility } from './igoDatabase';
import './IgoAssistant.css';

const areas = ['Malé', 'Hulhumalé Phase 1', 'Hulhumalé Phase 2', 'Boat'];
// Match the existing website's default Malé-origin pricing.
const feeByArea = { 'Malé': 25, 'Hulhumalé Phase 1': 35, 'Hulhumalé Phase 2': 45, 'Boat': 25 };
const emptyMessages = [{ role: 'assistant', content: 'Hello! I’m the iGO AI assistant. Ask me about our delivery services, or sign in to get help with your workspace.' }];
const blank = { customer: '', phone: '', area: '', address: '', boatName: '', boatLocation: '', departureTime: '', landmark: '', item: '', notes: '' };

function currentWorkspace() {
  try {
    const data = JSON.parse(sessionStorage.getItem('igo-navigation') || '{}');
    return ['Partner', 'Driver', 'Admin', 'Staff'].includes(data.workspace) ? data.workspace : 'Public';
  } catch {
    return 'Public';
  }
}

export default function IgoAssistant() {
  const [visible, setVisible] = useState(false);
  const [open, setOpen] = useState(false);
  const [workspace, setWorkspace] = useState('Public');
  const [messages, setMessages] = useState(emptyMessages);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingPackages, setPendingPackages] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [lastCreated, setLastCreated] = useState([]);
  const bottomRef = useRef(null);
  const submitted = useRef(false);
  const sendMessageRef = useRef(null);

  // Load the superadmin setting before showing the launcher, and refresh it so
  // a change takes effect across other active workspaces/tabs without a reload.
  useEffect(() => {
    let active = true;
    const hideAssistant = () => {
      setVisible(false);
      setOpen(false);
      setPendingPackages([]);
      setLastCreated([]);
      setDraft('');
    };
    async function refreshVisibility() {
      try {
        const enabled = await loadAiAssistantVisibility();
        if (!active) return;
        if (enabled) setVisible(true);
        else hideAssistant();
      } catch {
        // If the setting cannot be verified, don't expose the assistant.
        if (active) hideAssistant();
      }
    }
    void refreshVisibility();
    const timer = window.setInterval(refreshVisibility, 30000);
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') void refreshVisibility();
    };
    const onStorage = event => {
      if (event.key === 'igo-ai-visibility-refresh') void refreshVisibility();
    };
    const onSettingChanged = () => { void refreshVisibility(); };
    window.addEventListener('focus', refreshVisibility);
    window.addEventListener('storage', onStorage);
    window.addEventListener('igo-ai-visibility-changed', onSettingChanged);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisibility);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('igo-ai-visibility-changed', onSettingChanged);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  // Keep other floating controls clear of the launcher. When the chat is
  // expanded, hide Back to Top so it does not sit behind the chat panel.
  useEffect(() => {
    document.body.classList.toggle('igo-ai-visible', visible);
    document.body.classList.toggle('igo-ai-open', visible && open);
    return () => {
      document.body.classList.remove('igo-ai-visible', 'igo-ai-open');
    };
  }, [visible, open]);

  // A shared browser must not expose one account's previous chat after logout/login.
  useEffect(() => {
    if (!supabase) return undefined;
    let accountId = null;
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (active) accountId = data?.session?.user?.id || null;
    }).catch(() => {});
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return;
      const nextId = session?.user?.id || null;
      if (accountId !== nextId) {
        setMessages(emptyMessages);
        setPendingPackages([]);
        setLastCreated([]);
        setError('');
        setDraft('');
        setWorkspace('Public');
      }
      accountId = nextId;
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    function sync() { setWorkspace(currentWorkspace()); }
    sync();
    window.addEventListener('focus', sync);
    window.addEventListener('popstate', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('focus', sync);
      window.removeEventListener('popstate', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setWorkspace(currentWorkspace());
  }, [open]);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [messages, pendingPackages, busy, open, error]);

  async function sendMessage(text = draft) {
    const message = String(text || '').trim();
    if (!message || busy || saving || submitted.current) return;
    submitted.current = true;
    setDraft('');
    setError('');
    setLastCreated([]);
    setPendingPackages([]);
    const previous = messages.slice(-6);
    setMessages(current => [...current, { role: 'user', content: message }]);
    setBusy(true);
    try {
      const { data: { session } } = supabase
        ? await supabase.auth.getSession()
        : { data: { session: null } };
      const response = await fetch('/api/igo-assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: 'Bearer ' + session.access_token } : {}),
        },
        body: JSON.stringify({ message, workspace: currentWorkspace(), history: previous }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'Sorry, the assistant is unavailable.');
      setWorkspace(payload.workspace || 'Public');
      setMessages(current => [...current, { role: 'assistant', content: payload.reply || 'How can I help?' }]);
      if (Array.isArray(payload.packages) && payload.packages.length) {
        setPendingPackages(payload.packages.map(p => ({ ...blank, ...p })));
      }
    } catch (e) {
      setError(e.message || 'Could not contact the assistant.');
    } finally {
      submitted.current = false;
      setBusy(false);
    }
  }

  // The partner dashboard can send a question straight into this same assistant,
  // preserving the authenticated conversation and its package-review safeguards.
  sendMessageRef.current = sendMessage;
  useEffect(() => {
    async function onPartnerQuickAsk(event) {
      const prompt = String(event?.detail?.message || '').trim().slice(0, 1200);
      if (!prompt) return;
      // Check the live superadmin switch; it may have changed in another session.
      let allowed = false;
      try { allowed = await loadAiAssistantVisibility(); } catch { /* fail closed */ }
      if (!allowed) return;
      setVisible(true);
      setWorkspace(currentWorkspace());
      setOpen(true);
      if (busy || saving || submitted.current) {
        setDraft(prompt);
        return;
      }
      void sendMessageRef.current?.(prompt);
    }
    window.addEventListener('igo-ai-quick-ask', onPartnerQuickAsk);
    return () => window.removeEventListener('igo-ai-quick-ask', onPartnerQuickAsk);
  }, [busy, saving]);

  function editPackage(index, field, value) {
    setPendingPackages(current => current.map((p, i) => i === index ? { ...p, [field]: value } : p));
  }

  async function confirmPackages() {
    if (saving || !pendingPackages.length) return;
    setError('');
    if (!supabase) { setError('Please sign in before registering packages.'); return; }
    const entries = pendingPackages.map((p, index) => {
      const phone = p.phone.trim().replace(/^\+960[\s-]*/, '').replace(/[\s-]/g, '');
      if (!areas.includes(p.area)) throw new Error('Package ' + (index + 1) + ': select a destination.');
      if (!p.customer.trim() && !phone) throw new Error('Package ' + (index + 1) + ': enter a recipient name or phone.');
      if (phone && !/^[79]\d{6}$/.test(phone)) throw new Error('Package ' + (index + 1) + ': enter a valid 7-digit Maldives number.');
      if (p.area === 'Boat' && (!p.customer.trim() || !phone)) throw new Error('Package ' + (index + 1) + ': boat deliveries need the recipient name and phone.');
      if (p.area === 'Boat' && !p.boatName.trim()) throw new Error('Package ' + (index + 1) + ': enter the boat name.');
      if (p.area !== 'Boat' && !p.address.trim()) throw new Error('Package ' + (index + 1) + ': enter the delivery address.');
      if (p.departureTime.trim() && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(p.departureTime.trim())) throw new Error('Package ' + (index + 1) + ': use 24-hour HH:MM departure time.');
      return {
        customer: p.customer.trim(), phone,
        area: p.area,
        address: p.area === 'Boat' ? p.boatName.trim() : p.address.trim(),
        boatName: p.area === 'Boat' ? p.boatName.trim() : '',
        boatLocation: p.area === 'Boat' ? p.boatLocation.trim() : '',
        departureTime: p.area === 'Boat' ? p.departureTime.trim() : '',
        landmark: p.area === 'Boat' ? '' : p.landmark.trim(),
        item: p.item.trim(), notes: p.notes.trim(),
        fee: feeByArea[p.area], status: 'Pending',
      };
    });
    setSaving(true);
    try {
      // A draft left open before a superadmin hides AI must not be submitted.
      if (!(await loadAiAssistantVisibility())) {
        setVisible(false);
        setOpen(false);
        setPendingPackages([]);
        throw new Error('The AI assistant has been disabled by iGO.');
      }
      const partnerId = await getCurrentPartnerId();
      if (!partnerId) throw new Error('Sign in to an approved partner account.');
      const saved = await createPackages(entries, partnerId);
      setPendingPackages([]);
      setLastCreated(saved.map(p => p.displayId || p.id));
      setMessages(current => [...current, { role: 'assistant', content: saved.length + ' package(s) registered successfully. You can find them in your Partner Packages tab.' }]);
      window.dispatchEvent(new CustomEvent('igo-assistant-packages-created', { detail: { count: saved.length } }));
    } catch (e) {
      setError(e.message || 'Unable to save packages.');
    } finally {
      setSaving(false);
    }
  }

  function onConfirm() {
    try { void confirmPackages().catch(e => setError(e.message || 'Invalid package details.')); }
    catch (e) { setError(e.message || 'Invalid package details.'); }
  }

  if (!visible) return null;

  return (
    <div className="igo-ai-container">
      {open && (
        <section className="igo-ai-panel" role="dialog" aria-modal="false" aria-label="iGO AI Assistant">
          <header className="igo-ai-header">
            <span className="igo-ai-avatar" aria-hidden="true">iGO</span>
            <span className="igo-ai-header-name"><strong>iGO AI Assistant</strong><small>{workspace} support · powered by AI</small></span>
            <button type="button" className="igo-ai-close" aria-label="Close assistant" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="igo-ai-history" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={'igo-ai-bubble ' + (m.role === 'user' ? 'igo-ai-from-user' : 'igo-ai-from-bot')}>{m.content}</div>
            ))}
            {busy && <div className="igo-ai-bubble igo-ai-from-bot" aria-label="Assistant is typing">Thinking…</div>}
            {pendingPackages.length > 0 && (
              <div className="igo-ai-review">
                <strong>Review before registering</strong>
                <p>Only approved partners can save these packages. Verify every field before confirming. No package has been saved yet.</p>
                {pendingPackages.map((p, index) => (
                  <details key={index} open={index === 0}>
                    <summary>Package {index + 1}{p.customer ? ' · ' + p.customer : ''}</summary>
                    <label>Recipient name<input value={p.customer} onChange={e => editPackage(index, 'customer', e.target.value)} maxLength={100} /></label>
                    <label>Recipient phone<input type="tel" value={p.phone} onChange={e => editPackage(index, 'phone', e.target.value)} maxLength={20} /></label>
                    <label>Destination<select value={p.area} onChange={e => editPackage(index, 'area', e.target.value)}><option value="">Select destination</option>{areas.map(a => <option key={a}>{a}</option>)}</select></label>
                    {p.area === 'Boat' ? (
                      <>
                        <label>Boat name<input value={p.boatName} onChange={e => editPackage(index, 'boatName', e.target.value)} /></label>
                        <label>Boat location<input value={p.boatLocation} onChange={e => editPackage(index, 'boatLocation', e.target.value)} /></label>
                        <label>Departure time (24h HH:MM)<input value={p.departureTime} onChange={e => editPackage(index, 'departureTime', e.target.value)} placeholder="15:30" /></label>
                      </>
                    ) : (
                      <>
                        <label>Delivery address<input value={p.address} onChange={e => editPackage(index, 'address', e.target.value)} /></label>
                        <label>Nearby landmark<input value={p.landmark} onChange={e => editPackage(index, 'landmark', e.target.value)} /></label>
                      </>
                    )}
                    <label>Package description<input value={p.item} onChange={e => editPackage(index, 'item', e.target.value)} /></label>
                    <label>Instructions<input value={p.notes} onChange={e => editPackage(index, 'notes', e.target.value)} /></label>
                    <small>Estimated delivery fee: MVR {feeByArea[p.area] ?? '—'} (Malé-origin default)</small>
                  </details>
                ))}
                <button className="igo-ai-confirm" type="button" onClick={onConfirm} disabled={saving}>{saving ? 'Registering…' : 'Confirm and register ' + pendingPackages.length + ' package(s)'}</button>
                <button className="igo-ai-cancel" type="button" onClick={() => setPendingPackages([])}>Discard drafts</button>
              </div>
            )}
            {lastCreated.length > 0 && <p className="igo-ai-success">Saved: {lastCreated.join(', ')}</p>}
            {error && <p className="igo-ai-error" role="alert">{error}</p>}
            <div ref={bottomRef} />
          </div>
          <form className="igo-ai-composer" onSubmit={event => { event.preventDefault(); void sendMessage(); }}>
            <input aria-label="Message iGO assistant" placeholder="Ask iGO anything…" value={draft} maxLength={1200} onChange={event => setDraft(event.target.value)} disabled={busy || saving} />
            <button type="submit" disabled={!draft.trim() || busy || saving} aria-label="Send message">➤</button>
          </form>
          <p className="igo-ai-footnote">AI can make mistakes. Verify package details and rates before confirming.</p>
        </section>
      )}
      <button className="igo-ai-launcher" aria-label={open ? 'Close iGO AI Assistant' : 'Open iGO AI Assistant'} type="button" onClick={() => setOpen(v => !v)}>
        <span aria-hidden="true">{open ? '×' : '✦'}</span><span>{open ? 'Close' : 'Ask iGO'}</span>
      </button>
    </div>
  );
}
