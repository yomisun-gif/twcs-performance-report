/* ============================================================
   report-statusjump.js — Status Log 篩選檢視 >「亂切狀態檢查」分頁
   原則：online for case（文書）應該是在線上服務完之後才使用。
   每位專員、每一天，依 Status Start Time 排序後逐筆檢查每一段「文書」：
     規則1  away for short break 的下一筆直接切 online for case
     規則2  away for meal 的下一筆直接切 online for case
     規則3  兩段 online for case 之間，出現「允許狀態」以外的狀態
            （允許狀態預設：online for internet call、雙渠道，可在畫面上勾選調整）
   同一段文書可能同時觸發多條規則，「合計」以不重複的文書段數計。
   要加新規則：在 RULES 陣列加一筆 {id,label,desc,test} 即可。
   依賴：engine.js（state / toDate / storageGet / storageSet）、report-daily.js（slColorFor）
   ============================================================ */
(function(){
  const norm = s=> String(s||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean).sort().join(',');
  const CASE = 'online for case', BREAK = 'away for short break', MEAL = 'away for meal';
  const IC = 'online for internet call', DUAL = norm('online for chat,online for internet call');
  const ALLOWED_KEY = 'sj_allowed_between_case';
  const DEFAULT_ALLOWED = [IC, DUAL];

  const SHORT = {
    'online for internet call':'網路電話', 'online for chat':'即時客服', [DUAL]:'雙渠道',
    'online for call':'電話', 'online for case':'文書',
    'busy with wrapup':'話後', 'busy with training':'訓練', 'busy with meeting':'會議',
    'busy with coaching':'輔導', 'busy with escalation':'轉單諮詢', 'busy with outbound':'外撥',
    'away for short break':'休息', 'away for meal':'用餐', 'away for consult':'諮詢',
    'away for personal break':'其他', 'offline':'離線'
  };
  const shortOf = sub=> SHORT[sub] || sub || '(空白)';

  let allowed = new Set(DEFAULT_ALLOWED);

  const RULES = [
    { id:'r1', label:'休息→文書', desc:'away for short break 的下一筆直接切 online for case',
      test:(seq, i)=> (i > 0 && seq[i-1].sub === BREAK) ? {from:i-1} : null },
    { id:'r2', label:'用餐→文書', desc:'away for meal 的下一筆直接切 online for case',
      test:(seq, i)=> (i > 0 && seq[i-1].sub === MEAL) ? {from:i-1} : null },
    { id:'r3', label:'文書之間夾雜其他狀態', desc:'兩段 online for case 之間，出現允許狀態以外的狀態',
      test:(seq, i)=>{
        let j = i - 1;
        while(j >= 0 && seq[j].sub !== CASE) j--;
        if(j < 0) return null;
        const bad = seq.slice(j+1, i).filter(x=> !allowed.has(x.sub));
        return bad.length ? {from:j, bad:bad.map(x=> x.sub)} : null;
      } }
  ];

  const sj = { result:null, selected:null, onlyHits:true, date:'' };

  /* ---------- 樣式 ---------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
  #sl-view-jump .sj-rules{font-size:12px;color:var(--text-secondary);margin:6px 0 10px;line-height:1.7;}
  #sl-view-jump .sj-rules b{color:var(--text);}
  #sl-view-jump .sj-allowed{display:flex;flex-wrap:wrap;gap:6px 12px;font-size:12px;margin:4px 0 10px;}
  #sl-view-jump .sj-allowed label{display:flex;align-items:center;gap:4px;cursor:pointer;}
  #sj-summary tbody tr{cursor:pointer;}
  #sj-summary tbody tr.sj-sel td{outline:2px solid var(--primary);outline-offset:-2px;}
  #sj-summary td.sj-hit{font-weight:700;color:#c62828;}
  html.dark #sj-summary td.sj-hit{color:#FF9B9B;}
  #sj-detail .sj-chain{display:flex;flex-wrap:wrap;gap:4px;align-items:center;}
  #sj-detail .sj-seg{padding:1px 6px;border-radius:4px;border:1px solid var(--border);font-size:12px;white-space:nowrap;color:#222;}
  #sj-detail .sj-seg.sj-bad{border:2px solid #c62828;}
  #sj-detail .sj-seg.sj-target{border:2px solid var(--primary);font-weight:700;}
  #sj-detail .sj-arrow{color:var(--text-secondary);font-size:11px;}
  #sj-detail .sj-rule-tag{display:inline-block;padding:1px 6px;margin:1px 2px;border-radius:4px;background:#FDECEA;color:#9A1C1C;font-size:11px;white-space:nowrap;}
  html.dark #sj-detail .sj-rule-tag{background:#4A1D1D;color:#FFB4B4;}
  </style>`);

  /* ---------- 工具 ---------- */
  const esc = s=> String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pad = n=> String(n).padStart(2,'0');
  const ymd = d=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const hms = d=> d ? `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : '-';
  const segColor = sub=> (typeof slColorFor === 'function') ? slColorFor(sub) : '#FFFFFF';
  // 底色沿用「明細篩選」的 Sub Status 底色設定（key 是原始文字），這裡用原始文字查
  const rawColor = seg=> segColor(seg.raw);

  /* ---------- 計算 ---------- */
  function analyze(){
    const m = state.status.map;
    if(!state.status.rows.length) return {err:'尚未上傳 Status Log 明細'};
    if(!m.email || !m.sub_status || !m.start_datetime) return {err:'請先到②欄位對應完成 Status Log 的 Email / Sub Status / Start Time 設定'};

    const rosterBy = {};
    (state.roster||[]).forEach(r=> rosterBy[r.email] = r);
    const useRoster = (state.roster||[]).length > 0;

    // email|date → 該日狀態序列
    const groups = {};
    const dates = new Set();
    state.status.rows.forEach(r=>{
      const email = String(r[m.email]||'').toLowerCase().trim();
      const start = toDate(r[m.start_datetime]);
      if(!email || !start) return;
      if(useRoster && !rosterBy[email]) return;
      const end = m.end_datetime ? toDate(r[m.end_datetime]) : null;
      const date = ymd(start);
      dates.add(date);
      const key = email + '|' + date;
      (groups[key] = groups[key] || []).push({
        raw:String(r[m.sub_status]||'').trim(), sub:norm(r[m.sub_status]),
        start, end:(end && end.getFullYear() > 1899) ? end : null, email, date
      });
    });

    const agents = {};  // email → {email,name,manager,batch,counts:{r1..},total,events:[]}
    Object.values(groups).forEach(seq=>{
      seq.sort((a,b)=> a.start - b.start || ((a.end||0) - (b.end||0)));
      const email = seq[0].email;
      const ro = rosterBy[email] || {};
      const ag = agents[email] = agents[email] || {
        email, name:ro.name || email, manager:(state.managers||{})[ro.manager] || ro.manager || '', batch:ro.batch || '',
        counts:Object.fromEntries(RULES.map(r=>[r.id, 0])), total:0, events:[]
      };
      seq.forEach((seg, i)=>{
        if(seg.sub !== CASE) return;
        const hits = [];
        let from = i;
        RULES.forEach(rule=>{
          const h = rule.test(seq, i);
          if(!h) return;
          hits.push({rule, bad:h.bad || []});
          ag.counts[rule.id]++;
          from = Math.min(from, h.from);
        });
        if(!hits.length) return;
        ag.total++;
        const badSet = new Set(hits.flatMap(h=> h.bad));
        ag.events.push({date:seg.date, target:seg, hits, chain:seq.slice(from, i+1), badSet});
      });
    });

    // 名單內但當天完全沒有 Status Log 的人也列出（0 次）
    if(useRoster) state.roster.forEach(r=>{
      if(!agents[r.email]) agents[r.email] = {email:r.email, name:r.name||r.email,
        manager:(state.managers||{})[r.manager] || r.manager || '', batch:r.batch || '',
        counts:Object.fromEntries(RULES.map(x=>[x.id, 0])), total:0, events:[]};
    });

    return {agents, dates:[...dates].sort()};
  }

  // 依日期篩選後重算次數（多日檔時用）
  function viewOf(ag){
    if(!sj.date) return ag;
    const events = ag.events.filter(e=> e.date === sj.date);
    const counts = Object.fromEntries(RULES.map(r=>[r.id, 0]));
    events.forEach(e=> e.hits.forEach(h=> counts[h.rule.id]++));
    return Object.assign({}, ag, {events, counts, total:events.length});
  }

  /* ---------- 畫面 ---------- */
  function render(){
    const box = document.getElementById('sl-view-jump');
    if(!box) return;
    const res = sj.result = analyze();

    const subs = new Set(DEFAULT_ALLOWED);
    if(state.status.rows.length && state.status.map.sub_status){
      state.status.rows.forEach(r=>{ const s = norm(r[state.status.map.sub_status]); if(s && s !== CASE) subs.add(s); });
    }
    const allowedHtml = [...subs].sort((a,b)=> shortOf(a).localeCompare(shortOf(b),'zh-Hant')).map(s=>
      `<label title="${esc(s)}"><input type="checkbox" class="sj-allow" value="${esc(s)}" ${allowed.has(s)?'checked':''}>${esc(shortOf(s))}</label>`).join('');

    let html = `
      <p class="hint">依 Status Start Time 排序每位專員當天的狀態，檢查每一段 <b>online for case（文書）</b> 是否是在線上服務後才切換。只列③專員名單內的人（沒有名單時列出全部）。點選上表任一列，下方顯示該專員每一次的狀態順序。</p>
      <div class="sj-rules">${RULES.map((r,i)=> `<b>規則${i+1}｜${esc(r.label)}</b>：${esc(r.desc)}`).join('<br>')}</div>
      <div style="font-size:12px;font-weight:700;">規則3 允許夾在兩段文書之間的狀態：</div>
      <div class="sj-allowed">${allowedHtml}
        <button class="secondary" id="sj-allow-reset" style="padding:2px 8px;font-size:12px;">還原預設</button></div>
      <div class="toolbar">
        <button class="primary" id="sj-run">重新檢查</button>
        ${res.dates && res.dates.length > 1 ? `<select id="sj-date"><option value="">全部日期</option>${res.dates.map(d=>`<option value="${d}" ${d===sj.date?'selected':''}>${d}</option>`).join('')}</select>` : ''}
        <label style="font-size:13px;"><input type="checkbox" id="sj-only" ${sj.onlyHits?'checked':''}> 只顯示有亂切的專員</label>
        <button class="secondary" id="sj-export">匯出明細 Excel</button>
        <span class="badge" id="sj-count"></span>
      </div>`;

    if(res.err){
      box.innerHTML = html + `<div class="rt-empty-note">${esc(res.err)}</div>`;
      bind(); return;
    }
    if(sj.date && !res.dates.includes(sj.date)) sj.date = '';

    const list = Object.values(res.agents).map(viewOf)
      .filter(a=> !sj.onlyHits || a.total > 0)
      .sort((a,b)=> b.total - a.total || String(a.manager).localeCompare(String(b.manager)) || String(a.name).localeCompare(String(b.name)));
    const totalEvents = list.reduce((s,a)=> s + a.total, 0);
    const hitAgents = list.filter(a=> a.total > 0).length;

    html += `<div class="report-wrap" style="max-height:40vh;"><table class="report" id="sj-summary">
      <thead><tr><th>組別</th><th>Batch</th><th>Agent</th>${RULES.map((r,i)=>`<th title="${esc(r.desc)}">規則${i+1}<br><span style="font-weight:400;font-size:11px;">${esc(r.label)}</span></th>`).join('')}<th title="不重複的文書段數">合計</th></tr></thead>
      <tbody>${list.map(a=>`<tr data-email="${esc(a.email)}" class="${a.email===sj.selected?'sj-sel':''}">
        <td>${esc(a.manager||'-')}</td><td>${esc(a.batch||'-')}</td><td>${esc(a.name)}</td>
        ${RULES.map(r=>`<td class="${a.counts[r.id]?'sj-hit':''}">${a.counts[r.id]||'-'}</td>`).join('')}
        <td class="${a.total?'sj-hit':''}">${a.total||'-'}</td></tr>`).join('') ||
        `<tr><td colspan="${RULES.length+4}" class="rt-empty-note">沒有發現亂切狀態 👍</td></tr>`}</tbody></table></div>
      <div id="sj-detail" style="margin-top:12px;"></div>`;

    box.innerHTML = html;
    document.getElementById('sj-count').textContent = `${hitAgents} 位專員、共 ${totalEvents} 次`;
    bind();
    renderDetail();
  }

  function renderDetail(){
    const el = document.getElementById('sj-detail');
    if(!el) return;
    const ag = sj.selected && sj.result && sj.result.agents && sj.result.agents[sj.selected];
    if(!ag){ el.innerHTML = ''; return; }
    const v = viewOf(ag);
    if(!v.events.length){ el.innerHTML = `<div class="hint">${esc(v.name)}：沒有亂切紀錄</div>`; return; }
    const rows = v.events.map((e, idx)=>{
      const chain = e.chain.map((s, k)=>{
        const isTarget = k === e.chain.length - 1;
        const cls = isTarget ? 'sj-target' : (e.badSet.has(s.sub) && k > 0 ? 'sj-bad' : '');
        return `<span class="sj-seg ${cls}" style="background:${rawColor(s)};" title="${esc(s.raw)}｜${hms(s.start)} ~ ${hms(s.end)}">${hms(s.start)} ${esc(shortOf(s.sub))}</span>`;
      }).join('<span class="sj-arrow">→</span>');
      const dur = (e.target.end) ? Math.round((e.target.end - e.target.start)/1000) : null;
      return `<tr><td>${idx+1}</td><td>${e.date}</td><td>${hms(e.target.start)}</td><td>${dur!==null ? secToHMS(dur) : '-'}</td>
        <td>${e.hits.map(h=>`<span class="sj-rule-tag">規則${RULES.indexOf(h.rule)+1} ${esc(h.rule.label)}</span>`).join('')}</td>
        <td><div class="sj-chain">${chain}</div></td></tr>`;
    }).join('');
    el.innerHTML = `<h3 style="margin:0 0 6px;">${esc(v.name)}　<span style="font-weight:400;font-size:13px;">共 ${v.events.length} 次</span></h3>
      <div class="report-wrap" style="max-height:45vh;"><table class="report">
      <thead><tr><th>#</th><th>日期</th><th>切文書時間</th><th>文書時長</th><th>觸發規則</th><th style="text-align:left;">狀態順序（藍框＝該段文書，紅框＝不允許的狀態）</th></tr></thead>
      <tbody>${rows}</tbody></table></div>`;
  }

  function bind(){
    const q = id=> document.getElementById(id);
    q('sj-run') && (q('sj-run').onclick = render);
    q('sj-only') && (q('sj-only').onchange = e=>{ sj.onlyHits = e.target.checked; render(); });
    q('sj-date') && (q('sj-date').onchange = e=>{ sj.date = e.target.value; render(); });
    q('sj-export') && (q('sj-export').onclick = exportXlsx);
    q('sj-allow-reset') && (q('sj-allow-reset').onclick = async ()=>{
      allowed = new Set(DEFAULT_ALLOWED);
      await storageSet(ALLOWED_KEY, JSON.stringify([...allowed]));
      render();
    });
    document.querySelectorAll('#sl-view-jump .sj-allow').forEach(cb=> cb.onchange = async ()=>{
      if(cb.checked) allowed.add(cb.value); else allowed.delete(cb.value);
      await storageSet(ALLOWED_KEY, JSON.stringify([...allowed]));
      render();
    });
    document.querySelectorAll('#sj-summary tbody tr[data-email]').forEach(tr=> tr.onclick = ()=>{
      sj.selected = tr.dataset.email;
      document.querySelectorAll('#sj-summary tbody tr').forEach(x=> x.classList.toggle('sj-sel', x === tr));
      renderDetail();
    });
  }

  function exportXlsx(){
    if(!sj.result || !sj.result.agents){ alert('沒有資料可以匯出'); return; }
    const sum = [['組別','Batch','Agent','Email'].concat(RULES.map((r,i)=>`規則${i+1} ${r.label}`), ['合計'])];
    const det = [['組別','Batch','Agent','Email','日期','切文書時間','文書結束時間','觸發規則','狀態順序']];
    Object.values(sj.result.agents).map(viewOf).filter(a=> a.total > 0)
      .sort((a,b)=> b.total - a.total).forEach(a=>{
        sum.push([a.manager, a.batch, a.name, a.email].concat(RULES.map(r=> a.counts[r.id]), [a.total]));
        a.events.forEach(e=> det.push([a.manager, a.batch, a.name, a.email, e.date, hms(e.target.start), hms(e.target.end),
          e.hits.map(h=> h.rule.label).join('、'),
          e.chain.map(s=> `${hms(s.start)} ${shortOf(s.sub)}`).join(' → ')]));
      });
    if(sum.length === 1){ alert('沒有亂切紀錄可以匯出'); return; }
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sum), '統計');
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(det), '明細');
    const d = sj.date || (sj.result.dates.length === 1 ? sj.result.dates[0] : (document.getElementById('report-date').value || ymd(new Date())));
    XLSX.writeFile(wb, `亂切狀態檢查_${d}.xlsx`);
  }

  /* ---------- 分頁切換 ---------- */
  const tabFilter = document.getElementById('sl-subtab-filter');
  const tabJump = document.getElementById('sl-subtab-jump');
  function show(which){
    const isJump = which === 'jump';
    tabFilter.classList.toggle('active', !isJump);
    tabJump.classList.toggle('active', isJump);
    document.getElementById('sl-view-filter').style.display = isJump ? 'none' : '';
    document.getElementById('sl-view-jump').style.display = isJump ? '' : 'none';
    if(isJump) render();
  }
  tabFilter.onclick = ()=> show('filter');
  tabJump.onclick = ()=> show('jump');

  // 換了明細資料 / 名單 → 若正在看這個分頁就重算
  const refresh = ()=>{ if(tabJump.classList.contains('active')) render(); };
  document.addEventListener('sources:changed', refresh);
  const gen = document.getElementById('btn-generate');
  if(gen) gen.addEventListener('click', ()=> setTimeout(refresh, 0));

  (async ()=>{
    try{
      const saved = JSON.parse(await storageGet(ALLOWED_KEY) || 'null');
      if(Array.isArray(saved)) allowed = new Set(saved);
    }catch(e){}
  })();
})();
