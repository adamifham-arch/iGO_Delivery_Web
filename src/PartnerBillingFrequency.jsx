import { useEffect, useState } from 'react';
import { supabase } from './supabase';

const labels = {daily:'Every day',weekly:'Every Saturday',monthly:'Last day of each month'};
export default function PartnerBillingFrequency({adminUser, cutoffVersion}) {
  const [rows,setRows]=useState([]);
  const [drafts,setDrafts]=useState({});
  const [busy,setBusy]=useState('');
  const [feedback,setFeedback]=useState('');
  const [error,setError]=useState('');
  const [loading,setLoading]=useState(true);
  const [search,setSearch]=useState('');
  const load=async()=>{
    const {data,error}=await supabase.from('partners').select('id,name,invoice_frequency,invoice_cutoff,approval_status').eq('approval_status','approved').order('name');
    if(error)throw error;
    setRows(data||[]);
  };
  useEffect(()=>{
    if(!adminUser||!supabase)return;
    setLoading(true);
    load().then(()=>setError('')).catch(e=>setError(e.message||'Could not load billing schedules.')).finally(()=>setLoading(false));
  },[adminUser?.id,cutoffVersion]);
  const save=async row=>{
    const frequency=drafts[row.id];
    if(!frequency||frequency===row.invoice_frequency)return;
    setBusy(row.id);setError('');setFeedback('');
    try{
      const {data,error}=await supabase.from('partners').update({invoice_frequency:frequency}).eq('id',row.id).select('id,invoice_frequency').single();
      if(error)throw error;
      if(data?.invoice_frequency!==frequency)throw new Error('The billing schedule was not saved.');
      await load();
      setDrafts(prev=>{const next={...prev};delete next[row.id];return next;});
      setFeedback(row.name+' — billing frequency saved. Existing invoices are unchanged.');
    }catch(e){setError(e.message||'Could not save billing frequency.');}
    finally{setBusy('');}
  };
  if(!adminUser||!supabase)return null;
  return <section className="ready-partners" aria-label="Partner billing schedules" style={{marginBottom:16}}>
    <h4 style={{margin:'0 0 5px'}}>Partner billing frequency</h4>
    <p className="muted" style={{margin:'0 0 12px'}}>Automatic invoices include only delivered, uninvoiced packages up to the saved cutoff (Maldives time). Weekly invoices run on Saturdays; monthly invoices run on the last calendar day. Manual generation is still available.</p>
    <input type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search partners" aria-label="Search partner billing schedules" />
    {loading&&<p className="muted">Loading billing schedules…</p>}
    {error&&<p role="alert" style={{color:'#8a2d2d'}}>{error}</p>}
    {feedback&&<p role="status">{feedback}</p>}
    {!loading&&rows.filter(row=>row.name.toLowerCase().includes(search.trim().toLowerCase())).map(row=>{
      const selected=drafts[row.id]||row.invoice_frequency;
      return <article key={row.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap',padding:'12px 0',borderBottom:'1px solid #dce3e9'}}>
        <div><strong>{row.name}</strong><small className="muted" style={{display:'block'}}>{row.invoice_cutoff?labels[row.invoice_frequency]+' · '+String(row.invoice_cutoff).slice(0,5):'Automatic billing off — no cutoff set'}</small></div>
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <select aria-label={'Billing frequency for '+row.name} value={selected} disabled={Boolean(busy)} onChange={e=>setDrafts(prev=>({...prev,[row.id]:e.target.value}))}>
            <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select>
          <button type="button" className="secondary-btn" disabled={Boolean(busy)||selected===row.invoice_frequency} onClick={()=>save(row)}>{busy===row.id?'Saving…':'Save'}</button>
        </div>
      </article>;
    })}
    {!loading&&!rows.filter(row=>row.name.toLowerCase().includes(search.trim().toLowerCase())).length&&<p className="muted">No approved partners match.</p>}
  </section>;
}
