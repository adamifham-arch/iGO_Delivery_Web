import {useEffect,useState} from 'react';
import {supabase} from './supabase';

const money=n=>'MVR '+Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
const cents=n=>Math.round(Number(n||0)*100);
const dayKey=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Indian/Maldives',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
async function allRows(makeQuery){
  const rows=[];
  for(let start=0;;start+=500){
    const {data,error}=await makeQuery().order('id',{ascending:true}).range(start,start+499);
    if(error)throw error;
    rows.push(...(data||[]));
    if(!data||data.length<500)return rows;
  }
}
async function countRows(query){
  const {count,error}=await query;
  if(error)throw error;
  return count;
}
export default function AdminDailyOverview({onNavigate}){
  const [state,setState]=useState({loading:true,sections:{},errors:[],updated:null});
  const [refreshKey,setRefreshKey]=useState(0);
  useEffect(()=>{
    let active=true;let running=false;
    const refresh=async()=>{
      if(running)return;
      running=true;
      try{
        const today=dayKey();
        const start=new Date(today+'T00:00:00+05:00').toISOString();
        const end=new Date(new Date(start).getTime()+86400000).toISOString();
        const head=(table)=>supabase.from(table).select('id',{count:'exact',head:true});
        const tasks={
          deliveries:async()=>{
            const [registered,delivered,failed,activeCount]=await Promise.all([
              countRows(head('packages').gte('created_at',start).lt('created_at',end)),
              allRows(()=>supabase.from('packages').select('id,delivery_fee').eq('status','delivered').gte('delivered_at',start).lt('delivered_at',end)),
              countRows(head('packages').eq('status','failed_attempt').gte('failed_attempt_at',start).lt('failed_attempt_at',end)),
              countRows(head('packages').not('status','in','(delivered,cancelled)'))
            ]);
            return {registered,delivered:delivered.length,failed,activeCount,fees:delivered.reduce((n,r)=>n+cents(r.delivery_fee),0)/100};
          },
          invoices:async()=>{
            const rows=await allRows(()=>supabase.from('invoices').select('id,subtotal,paid_amount,due_date,status').in('status',['unpaid','partially_paid']));
            const open=rows.map(r=>({...r,due:Math.max(0,cents(r.subtotal)-cents(r.paid_amount))})).filter(r=>r.due>0);
            const overdue=open.filter(r=>r.due_date && String(r.due_date).slice(0,10)<today);
            return {total:open.reduce((n,r)=>n+r.due,0)/100,count:open.length,overdue:overdue.length,overdueAmount:overdue.reduce((n,r)=>n+r.due,0)/100};
          },
          approvals:async()=>{
            const [partners,riders,payments,payouts,settlements]=await Promise.all([
              countRows(head('partners').eq('approval_status','pending')),
              countRows(head('drivers').eq('approval_status','pending')),
              countRows(head('payments').eq('status','pending_verification')),
              countRows(head('cod_payout_requests').in('status',['pending','processing'])),
              countRows(head('cod_invoice_settlement_requests').eq('status','pending'))
            ]);
            return {partners,riders,payments,payouts,settlements};
          },
          handover:async()=>{
            const rows=await allRows(()=>supabase.from('packages').select('id,cod_collected_by,cod_collected_amount,drivers(name,user_id)').eq('status','delivered').not('cod_collected_at','is',null).is('cod_received_by_igo_at',null));
            const map=new Map();
            rows.forEach(r=>{
              const id=r.cod_collected_by||'unknown';
              const item=map.get(id)||{id,name:r.drivers?.user_id===r.cod_collected_by?r.drivers.name:'Other / admin collector',count:0,total:0};
              item.total+=cents(r.cod_collected_amount);item.count++;map.set(id,item);
            });
            return {total:rows.reduce((n,r)=>n+cents(r.cod_collected_amount),0)/100,count:rows.length,collectors:[...map.values()].sort((a,b)=>b.total-a.total)};
          }
        };
        const entries=Object.entries(tasks);
        const results=await Promise.allSettled(entries.map(([,fn])=>fn()));
        const sections={},errors=[];
        results.forEach((r,i)=>{if(r.status==='fulfilled')sections[entries[i][0]]=r.value;else errors.push(entries[i][0]);});
        if(active)setState({loading:false,sections,errors,updated:new Date()});
      }catch{if(active)setState({loading:false,sections:{},errors:['dashboard'],updated:null});}
      finally{running=false;}
    };
    void refresh();
    const tick=()=>{if(document.visibilityState==='visible')void refresh();};
    const timer=window.setInterval(tick,30000);
    window.addEventListener('focus',tick);
    window.addEventListener('igo-live-finance-updated',tick);
    return()=>{active=false;window.clearInterval(timer);window.removeEventListener('focus',tick);window.removeEventListener('igo-live-finance-updated',tick);};
  },[refreshKey]);
  const {deliveries:d,invoices:i,approvals:a,handover:h}=state.sections;
  const stat=(label,value,detail)=> <div className="stat-card" style={{padding:12,minWidth:0}}><span>{label}</span><strong style={{fontSize:19,overflowWrap:'anywhere'}}>{value}</strong>{detail&&<small>{detail}</small>}</div>;
  const action=(label,value,page,detail)=> <button type="button" className="secondary-btn" onClick={()=>onNavigate(page)} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,textAlign:'left',padding:10,whiteSpace:'normal'}}><span>{label}{detail&&<small style={{display:'block',fontWeight:400}}>{detail}</small>}</span><strong>{value} ›</strong></button>;
  return <section className="card" aria-label="Admin daily overview" style={{padding:14,display:'grid',gap:12,marginBottom:12}}>
    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}><div><h2 style={{margin:0,fontSize:19}}>Operations overview</h2><small className="muted">{dayKey()} · Maldives time</small></div><button className="secondary-btn" type="button" onClick={()=>setRefreshKey(k=>k+1)}>Refresh</button></div>
    {state.loading&&<small role="status">Loading live figures…</small>}
    {state.errors.length>0&&<p role="alert" style={{color:'#952d20',margin:0}}>Unavailable: {state.errors.join(', ')}. Refresh to retry. Missing values are not counted as zero.</p>}
    {d&&<><strong>Today's delivery activity</strong><div style={{display:'grid',gridTemplateColumns:'repeat(2,minmax(0,1fr))',gap:8}}>{stat('Registered today',d.registered)}{stat('Delivered today',d.delivered)}{stat('Failed today',d.failed,'Currently failed')}{stat('Active packages',d.activeCount,'All dates')}{stat('Delivered fees today',money(d.fees),'Gross delivery value, not profit')}</div></>}
    <strong>Requires attention · all dates</strong>
    {i&&action('Outstanding invoices',money(i.total),'Finance Management',i.count+' unpaid invoices · '+i.overdue+' overdue ('+money(i.overdueAmount)+')')}
    {a&&<>{action('Account approvals',a.partners+a.riders,'Approvals',a.partners+' partners · '+a.riders+' riders')}{action('Payment verifications',a.payments,'Finance Management')}{action('COD settlement requests',a.settlements,'COD Collections')}{action('COD bank payouts',a.payouts,'COD Collections','Pending or processing')}</>}
    {h&&<>{action('Cash awaiting handover',money(h.total),'COD Collections',h.count+' collected packages')}{h.collectors.length>0&&<details><summary>Cash by collector ({h.collectors.length})</summary>{h.collectors.map(r=><div key={r.id} style={{display:'flex',justifyContent:'space-between',gap:8,padding:'8px 0'}}><span>{r.name} · {r.count} packages</span><strong>{money(r.total/100)}</strong></div>)}</details>}</>}
    {state.updated&&<small className="muted">Updated {state.updated.toLocaleTimeString('en-GB',{timeZone:'Indian/Maldives'})} · refreshes every 30 seconds while visible.</small>}
  </section>;
}
