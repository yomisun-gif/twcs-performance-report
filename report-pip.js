/* ============================================================
   report-pip.js — 🧪 隱藏測試分頁：PIP 追蹤（?dev=1 才顯示）
   - 從 Drive 資料庫逐日抓 IC + Status Log，每天各跑一次 buildRawAgentStats()
     → 數字口徑與日報表完全一致，不另寫計算邏輯
   - 個人：輸入專員英文名稱（比對③名單姓名 / Email 前綴）
   - 團隊：依③名單「全技能」勾選拆單技能／全技能，取當日有 Call 產能的人做平均
           （與即時產能一致：只計「計入成績」、排除 BBT）
   - 週平均 = 當週有數字的天數簡單平均（與原 PIP 表單算法相同）
   依賴：engine.js（state / buildRawAgentStats / REQ / guessMap / storageGet / storageSet / secToHMS）
         drive-store.js（DriveAuth / DriveStore）
   ============================================================ */
(function(){
  const $ = id => document.getElementById(id);
  const WEEKDAY = ['週日','週一','週二','週三','週四','週五','週六'];
  const METRICS = [
    {key:'prod',  label:'Call<br>產能',   tsv:'Call產能'},
    {key:'csat',  label:'Call<br>滿意度', tsv:'Call滿意度'},
    {key:'recov', label:'Call<br>回收率', tsv:'Call回收率'},
    {key:'doc',   label:'文書',           tsv:'文書'},
  ];
  const EMPTY_SRC = ()=>({rows:[], headers:[], map:{}});
  const dayCache = {};          // 'YYYY-MM-DD' -> agents（buildRawAgentStats 結果）或 null（資料庫無此日）
  let notes = {}, qa = {};      // notes[email][date] = '病假'；qa[email][weekKey] = '94.2'
  let last = null;              // 最近一次產出的模型，供複製 / 匯出

  /* ---------- 樣式 ---------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
    #pip-table{border-collapse:collapse;font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums;background:var(--surface);}
    #pip-table th,#pip-table td{border:1px solid var(--border);padding:5px 8px;text-align:center;min-width:58px;}
    #pip-table thead th{background:var(--bg);color:var(--text);font-weight:700;}
    #pip-table thead tr.pip-wk th{font-size:13px;}
    #pip-table th.pip-we{background:#1F4E79;color:#fff;}
    #pip-table td.pip-we{background:#E9EAEC;color:var(--text-secondary);}
    #pip-table td.pip-avg,#pip-table th.pip-avg{background:#FFF4D6;font-weight:700;}
    #pip-table .pip-lab{position:sticky;left:0;z-index:5;background:#FFF4D6;font-weight:700;min-width:72px;}
    #pip-table .pip-who{position:sticky;left:72px;z-index:5;background:#FFF4D6;font-weight:600;min-width:56px;}
    #pip-table thead .pip-lab,#pip-table thead .pip-who{z-index:7;background:var(--bg);}
    #pip-table td.pip-ind{cursor:pointer;}
    #pip-table td.pip-ind:hover{outline:2px solid var(--primary);outline-offset:-2px;}
    #pip-table td.pip-note{color:var(--primary-dark);font-weight:600;}
    #pip-table td.pip-team{color:var(--text-secondary);}
    #pip-table tr.pip-sep td{border-top:2px solid var(--text-secondary);}
    #pip-table td input.pip-qa{width:52px;border:1px solid transparent;background:transparent;text-align:center;font:inherit;font-weight:700;color:inherit;}
    #pip-table td input.pip-qa:focus{border-color:var(--primary);background:var(--surface);}
    #pip-table .pip-nodata{opacity:.45;}
    html.dark #pip-table th.pip-we{background:#2B4A6B;}
    html.dark #pip-table td.pip-we{background:#26282F;}
    html.dark #pip-table td.pip-avg,html.dark #pip-table th.pip-avg,html.dark #pip-table .pip-lab,html.dark #pip-table .pip-who{background:#3A3115;}
    html.dark #pip-table thead .pip-lab,html.dark #pip-table thead .pip-who{background:var(--bg);}
    .pip-skill{display:inline-flex;gap:5px;align-items:center;font-size:13px;cursor:pointer;}
    .pip-skill input{accent-color:var(--primary);width:15px;height:15px;cursor:pointer;}
  </style>`);

  /* ---------- 日期工具 ---------- */
  const p2 = n => String(n).padStart(2,'0');
  const ymd = d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
  const parseYmd = s => { const [y,m,d] = s.split('-').map(Number); return new Date(y, m-1, d); };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate()+n); return x; };
  const mondayOf = d => addDays(d, -((d.getDay()+6)%7));
  function isoWeek(d){
    const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return {year: t.getUTCFullYear(), week: Math.ceil(((t - y0)/86400000 + 1)/7)};
  }

  /* ---------- 儲存（備註 / QA） ---------- */
  async function loadStore(){
    try{ notes = JSON.parse(await storageGet('pip_notes') || '{}') || {}; }catch(e){ notes = {}; }
    try{ qa = JSON.parse(await storageGet('pip_qa') || '{}') || {}; }catch(e){ qa = {}; }
    try{
      const s = JSON.parse(await storageGet('pip_last') || '{}');
      if(s.name) $('pip-name').value = s.name;
      if(s.start) $('pip-start').value = s.start;
      if(s.end) $('pip-end').value = s.end;
      if(typeof s.single === 'boolean') $('pip-team-single').checked = s.single;
      if(typeof s.full === 'boolean') $('pip-team-full').checked = s.full;
    }catch(e){}
  }
  const saveNotes = ()=> storageSet('pip_notes', JSON.stringify(notes));
  const saveQa = ()=> storageSet('pip_qa', JSON.stringify(qa));

  /* ---------- 名單比對 ---------- */
  function refreshNameList(){
    const dl = $('pip-name-list');
    if(!dl) return;
    dl.innerHTML = state.roster.map(r=>`<option value="${r.name || r.email.split('@')[0]}">${r.email}</option>`).join('');
  }
  function findAgent(input){
    const q = input.trim().toLowerCase();
    if(!q) return null;
    const exact = state.roster.find(r=> (r.name||'').toLowerCase() === q || r.email === q || r.email.split('@')[0] === q);
    if(exact) return exact;
    const partial = state.roster.filter(r=> (r.name||'').toLowerCase().includes(q) || r.email.split('@')[0].includes(q));
    if(partial.length === 1) return partial[0];
    if(partial.length > 1) throw new Error(`「${input}」比對到 ${partial.length} 人（${partial.map(r=>r.name||r.email).join('、')}），請輸入完整名稱`);
    // 不在名單：若輸入的是 Email 就直接用
    if(q.includes('@')) return {email:q, name:q, fullSkill:true, bbt:false, countedInScore:true};
    return null;
  }

  /* ---------- 欄位對應：沿用②已儲存的對應，否則自動猜 ---------- */
  async function resolveMap(k, headers){
    const sameSet = (a, b)=> JSON.stringify(a.slice().sort()) === JSON.stringify(b.slice().sort());
    if(state[k].headers.length && sameSet(state[k].headers, headers) && Object.keys(state[k].map||{}).length) return state[k].map;
    try{
      const saved = JSON.parse(await storageGet('colmap_'+k) || 'null');
      if(saved && saved.headers && sameSet(saved.headers, headers)) return saved.map;
    }catch(e){}
    const m = {};
    REQ[k].forEach(([key])=> m[key] = guessMap(headers, key));
    return m;
  }

  /* ---------- 單日計算：暫時替換 state 來源 → buildRawAgentStats() → 還原 ---------- */
  async function computeDay(raw){
    const src = {};
    for(const k of ['ic','status']){
      if(raw[k]) src[k] = {rows: raw[k].rows, headers: raw[k].headers, map: await resolveMap(k, raw[k].headers)};
    }
    const backup = {};
    ['ic','chat','status','hourly','iact'].forEach(k=> backup[k] = state[k]);
    try{
      ['ic','chat','status','hourly','iact'].forEach(k=> state[k] = src[k] || EMPTY_SRC());
      return buildRawAgentStats().agents;
    }finally{
      Object.assign(state, backup);
    }
  }

  async function pool(items, limit, fn){
    const out = new Array(items.length); let i = 0;
    await Promise.all(Array.from({length: Math.min(limit, items.length)}, async ()=>{
      while(i < items.length){ const idx = i++; out[idx] = await fn(items[idx], idx); }
    }));
    return out;
  }

  /* ---------- 指標 ---------- */
  function agentDay(a){
    if(!a) return null;
    const onCase = a.status && a.status.on_case ? a.status.on_case.sec : 0;
    const worked = a.icCount > 0 || Object.keys(a.status||{}).length > 0;
    if(!worked) return null;
    const gb = a.icGood + a.icBad;
    return {
      prod: a.icCount,
      csat: gb ? a.icGood/gb : null,
      recov: a.icCount ? gb/a.icCount : null,
      doc: onCase,
    };
  }
  const mean = arr => { const v = arr.filter(x=> x!==null && x!==undefined && !isNaN(x)); return v.length ? v.reduce((s,x)=>s+x,0)/v.length : null; };

  function fmt(key, v, isAvg){
    if(v===null || v===undefined) return '';
    if(key==='prod') return isAvg ? v.toFixed(1) : (Number.isInteger(v) ? String(v) : v.toFixed(1));
    if(key==='csat' || key==='recov') return (v*100).toFixed(isAvg?1:2)+'%';
    if(key==='doc') return secToHMS(v);
    return String(v);
  }

  // ①目前已載入資料的日期：取 Status Log Start Time（無則 IC Call End Time）的眾數
  function currentLoadedDay(){
    const pick = (rows, col)=>{
      if(!col || !rows.length) return '';
      const cnt = {};
      rows.forEach(r=>{ const d = toDate(r[col]); if(d && d.getFullYear() > 1899){ const k = ymd(d); cnt[k] = (cnt[k]||0)+1; } });
      return Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
    };
    return pick(state.status.rows, state.status.map.start_datetime) || pick(state.ic.rows, state.ic.map.call_end_time);
  }

  /* ---------- 主流程 ---------- */
  async function run(){
    const status = $('pip-status'), warnBox = $('pip-warnings');
    warnBox.innerHTML = '';
    const nameInput = $('pip-name').value;
    const startStr = $('pip-start').value, endStr = $('pip-end').value;
    const wantSingle = $('pip-team-single').checked, wantFull = $('pip-team-full').checked;
    try{
      const hasDrive = typeof window.DriveStore !== 'undefined' && typeof window.DriveAuth !== 'undefined';
      let driveOk = false;
      if(hasDrive){
        try{ await DriveAuth.ensureRead(); driveOk = true; }catch(e){ driveOk = false; }   // 需在點擊當下第一個 await
      }
      if(!nameInput.trim()) throw new Error('請輸入專員英文名稱');
      if(!startStr || !endStr) throw new Error('請選擇起訖日期');
      const agent = findAgent(nameInput);
      if(!agent) throw new Error(`③專員名單找不到「${nameInput}」，可改輸入 Email`);
      storageSet('pip_last', JSON.stringify({name:nameInput, start:startStr, end:endStr, single:wantSingle, full:wantFull}));

      const first = mondayOf(parseYmd(startStr));
      const lastDay = addDays(mondayOf(parseYmd(endStr)), 6);
      if(lastDay < first) throw new Error('結束日期早於開始日期');
      const days = [];
      for(let d = new Date(first); d <= lastDay; d = addDays(d, 1)) days.push(ymd(d));
      if(days.length > 7*12) throw new Error('區間最多 12 週');

      // ①目前已載入的那一天（手動上傳或從資料庫載入）→ 直接用，不重抓
      const loadedDay = currentLoadedDay();
      const notes2 = [];
      let avail = new Set();
      if(driveOk){
        status.textContent = '讀取資料庫日期…';
        try{ avail = new Set((await DriveStore.dates(true)).map(d=>d.name)); }
        catch(e){ notes2.push('資料庫讀取失敗（' + e.message + '），只用①已載入的資料'); }
      }else{
        notes2.push(hasDrive ? '尚未連接資料庫，只用①已載入的資料' : 'drive-store.js 是舊版（沒有 DriveStore），只用①已載入的資料，請確認已更新 drive-store.js 並強制重新整理');
      }
      const need = days.filter(d=> d !== loadedDay && avail.has(d) && !(d in dayCache));
      let done = 0;
      await pool(need, 3, async d=>{
        const raw = await DriveStore.fetchDay(d, ['ic','status']);
        dayCache[d] = raw && (raw.ic || raw.status) ? await computeDay(raw) : null;
        status.textContent = `下載並計算中… ${++done}/${need.length}`;
      });
      const dayAgents = {};
      days.forEach(d=>{
        if(d === loadedDay) dayAgents[d] = buildRawAgentStats().agents;
        else dayAgents[d] = avail.has(d) ? (dayCache[d] || null) : null;
      });

      const teamGroups = [];
      if(wantSingle && wantFull) teamGroups.push({label:'團隊', test:()=>true});
      else if(wantSingle) teamGroups.push({label:'團隊', test:a=>!a.fullSkill});
      else if(wantFull) teamGroups.push({label:'團隊', test:a=>a.fullSkill});
      const teamTag = wantSingle && wantFull ? '全部' : wantSingle ? '單技能' : wantFull ? '全技能' : '';

      // 逐日算個人 + 團隊
      const perDay = {};
      days.forEach(d=>{
        const agents = dayAgents[d];
        if(!agents){ perDay[d] = {has:false, ind:null, team:null, teamN:0}; return; }
        const ind = agentDay(agents[agent.email]);
        let team = null, teamN = 0;
        if(teamGroups.length){
          const members = Object.values(agents).filter(a=>
            a.countedInScore && !a.bbt && a.icCount > 0 && teamGroups[0].test(a) &&
            state.roster.some(r=> r.email === a.email));
          const vals = members.map(agentDay).filter(Boolean);
          teamN = vals.length;
          team = {};
          METRICS.forEach(m=> team[m.key] = mean(vals.map(v=>v[m.key])));
        }
        perDay[d] = {has:true, ind, team, teamN};
      });

      // 依週分組
      const weeks = [];
      for(let i=0; i<days.length; i+=7){
        const wd = days.slice(i, i+7);
        const w = isoWeek(parseYmd(wd[0]));
        const avg = {ind:{}, team:{}};
        METRICS.forEach(m=>{
          avg.ind[m.key] = mean(wd.map(d=> (noteOf(agent.email, d) ? null : perDay[d].ind && perDay[d].ind[m.key])));
          avg.team[m.key] = mean(wd.map(d=> perDay[d].team && perDay[d].team[m.key]));
        });
        weeks.push({key:`${w.year}-W${w.week}`, label:`W${w.week}`, days:wd, avg});
      }

      last = {agent, weeks, perDay, hasTeam: !!teamGroups.length, teamTag};
      render();
      const missing = days.filter(d=> !perDay[d].has && parseYmd(d) < new Date() && ![0,6].includes(parseYmd(d).getDay()));
      const msgs = notes2.slice();
      if(missing.length) msgs.push(`以下平日沒有資料，該日顯示空白：${missing.map(d=>d.slice(5)).join('、')}`);
      if(msgs.length) warnBox.innerHTML = msgs.map(m=>`<div class="warn-box">⚠️ ${m}</div>`).join('');
      status.textContent = `已產出：${agent.name || agent.email}（${agent.fullSkill ? '全技能' : '單技能'}）・${weeks.length} 週${last.hasTeam ? '・團隊=' + teamTag : ''}`;
    }catch(e){
      status.textContent = '';
      warnBox.innerHTML = `<div class="warn-box">❌ ${e.message}</div>`;
    }
  }

  function noteOf(email, d){ return (notes[email] && notes[email][d]) || ''; }

  /* ---------- 輸出模型（HTML / TSV / Excel 共用） ---------- */
  function cellFor(d, metricKey, who){
    const {agent, perDay} = last;
    const pd = perDay[d];
    const we = [0,6].includes(parseYmd(d).getDay());
    if(who === 'ind'){
      const n = noteOf(agent.email, d);
      if(n) return {text:n, note:true, we};
      const v = pd.ind && pd.ind[metricKey];
      if(pd.ind) return {text: fmt(metricKey, v, false), we};
      return {text: we ? '休' : '', we, nodata: !pd.has && !we};
    }
    if(!pd.team || pd.teamN === 0) return {text: we ? '休' : '', we};
    return {text: fmt(metricKey, pd.team[metricKey], false), we, team:true};
  }

  function buildMatrix(){
    const {agent, weeks, hasTeam} = last;
    const rows = [];
    const h1 = ['', ''], h2 = ['', ''], h3 = ['', ''];
    weeks.forEach(w=>{
      w.days.forEach((d,i)=>{ h1.push(i===0 ? w.label : ''); const dt = parseYmd(d); h2.push(`${dt.getMonth()+1}/${dt.getDate()}`); h3.push(WEEKDAY[dt.getDay()]); });
      h1.push(''); h2.push(''); h3.push('Average');
    });
    rows.push(h1, h2, h3);
    METRICS.forEach(m=>{
      const whos = hasTeam ? ['ind','team'] : ['ind'];
      whos.forEach(who=>{
        const r = [m.tsv, who==='ind' ? '個人' : '團隊'];
        weeks.forEach(w=>{
          w.days.forEach(d=> r.push(cellFor(d, m.key, who).text));
          r.push(fmt(m.key, w.avg[who][m.key], true));
        });
        rows.push(r);
      });
    });
    const q = ['QA', '個人'];
    weeks.forEach(w=>{ w.days.forEach(()=>q.push('')); q.push((qa[agent.email] && qa[agent.email][w.key]) || ''); });
    rows.push(q);
    return rows;
  }

  function render(){
    const {agent, weeks, hasTeam, teamTag} = last;
    const esc = s => String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
    let h = '<thead>';
    h += `<tr class="pip-wk"><th class="pip-lab" rowspan="3">${esc(agent.name || agent.email)}</th><th class="pip-who" rowspan="3">${hasTeam ? '團隊:<br>'+teamTag : ''}</th>`;
    weeks.forEach(w=> h += `<th colspan="8">${w.label}</th>`);
    h += '</tr><tr>';
    weeks.forEach(w=>{
      w.days.forEach(d=>{ const dt = parseYmd(d); const we = [0,6].includes(dt.getDay()); const nd = (!last.perDay[d].has && !we) ? ' pip-nodata' : '';
        h += `<th class="${we?'pip-we':''}${nd}" title="${last.perDay[d].has ? d : d+'（資料庫無此日）'}">${dt.getMonth()+1}/${dt.getDate()}</th>`; });
      h += `<th class="pip-avg" rowspan="2">Average</th>`;
    });
    h += '</tr><tr>';
    weeks.forEach(w=> w.days.forEach(d=>{ const dt = parseYmd(d); h += `<th class="${[0,6].includes(dt.getDay())?'pip-we':''}">${WEEKDAY[dt.getDay()]}</th>`; }));
    h += '</tr></thead><tbody>';

    METRICS.forEach((m, mi)=>{
      const whos = hasTeam ? ['ind','team'] : ['ind'];
      whos.forEach((who, wi)=>{
        h += `<tr class="${wi===0 && mi>0 ? 'pip-sep' : ''}">`;
        if(wi===0) h += `<td class="pip-lab" rowspan="${whos.length}">${m.label}</td>`;
        h += `<td class="pip-who">${who==='ind' ? '個人' : '團隊'}</td>`;
        weeks.forEach(w=>{
          w.days.forEach(d=>{
            const c = cellFor(d, m.key, who);
            const cls = [c.we?'pip-we':'', who==='ind'?'pip-ind':'pip-team', c.note?'pip-note':'', c.nodata?'pip-nodata':''].filter(Boolean).join(' ');
            const extra = who==='ind' ? ` data-date="${d}" title="點擊設定假別/備註（挪休、病假…）"` : (last.perDay[d].teamN ? ` title="${last.perDay[d].teamN} 人平均"` : '');
            h += `<td class="${cls}"${extra}>${esc(c.text)}</td>`;
          });
          h += `<td class="pip-avg">${fmt(m.key, w.avg[who][m.key], true)}</td>`;
        });
        h += '</tr>';
      });
    });
    h += `<tr class="pip-sep"><td class="pip-lab">QA</td><td class="pip-who">個人</td>`;
    weeks.forEach(w=>{
      w.days.forEach(d=> h += `<td class="${[0,6].includes(parseYmd(d).getDay())?'pip-we':''}"></td>`);
      const v = (qa[agent.email] && qa[agent.email][w.key]) || '';
      h += `<td class="pip-avg"><input class="pip-qa" data-week="${w.key}" value="${esc(v)}" placeholder="輸入"></td>`;
    });
    h += '</tr></tbody>';

    const tbl = $('pip-table');
    tbl.innerHTML = h;
    tbl.querySelectorAll('td.pip-ind').forEach(td=> td.onclick = ()=> editNote(td.dataset.date));
    tbl.querySelectorAll('input.pip-qa').forEach(inp=> inp.onchange = ()=>{
      (qa[agent.email] = qa[agent.email] || {})[inp.dataset.week] = inp.value.trim();
      saveQa();
    });
  }

  function editNote(d){
    const email = last.agent.email;
    const cur = noteOf(email, d);
    const v = prompt(`${d} 假別/備註（例：挪休、病假、生理假8、特休）\n留空 = 清除，改回顯示數據`, cur);
    if(v === null) return;
    notes[email] = notes[email] || {};
    if(v.trim()) notes[email][d] = v.trim(); else delete notes[email][d];
    saveNotes();
    // 有備註的那天不列入個人週平均 → 重算平均
    last.weeks.forEach(w=>{
      if(!w.days.includes(d)) return;
      METRICS.forEach(m=> w.avg.ind[m.key] = mean(w.days.map(x=> noteOf(email, x) ? null : last.perDay[x].ind && last.perDay[x].ind[m.key])));
    });
    render();
  }

  /* ---------- 複製 / 匯出 ---------- */
  function copyTsv(){
    if(!last) return alert('請先產出');
    const tsv = buildMatrix().map(r=> r.join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(()=>{ $('pip-status').textContent = '📋 已複製（可直接貼到試算表）'; });
  }
  function copyValuesOnly(){
    if(!last) return alert('請先產出');
    // 只取數值區（去掉 3 列表頭與前 2 欄標籤），對應原 PIP 表單 C 欄起的資料格
    const tsv = buildMatrix().slice(3).map(r=> r.slice(2).join('\t')).join('\n');
    navigator.clipboard.writeText(tsv).then(()=>{ $('pip-status').textContent = '📋 已複製數值區（貼到原表單的第一個日期格）'; });
  }
  function exportXlsx(){
    if(!last) return alert('請先產出');
    const ws = XLSX.utils.aoa_to_sheet(buildMatrix());
    const merges = [];
    let c = 2;
    last.weeks.forEach(()=>{ merges.push({s:{r:0,c}, e:{r:0,c:c+7}}); c += 8; });
    ws['!merges'] = merges;
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'PIP');
    XLSX.writeFile(wb, `PIP_${last.agent.name || last.agent.email}_${last.weeks[0].days[0]}_${last.weeks.at(-1).days[6]}.xlsx`);
  }

  /* ---------- 初始化 ---------- */
  function init(){
    if(!$('panel-pip')) return;
    const today = new Date();
    if(!$('pip-end').value) $('pip-end').value = ymd(addDays(today, -1));
    if(!$('pip-start').value) $('pip-start').value = ymd(addDays(mondayOf(today), -14));
    $('btn-pip-run').onclick = run;
    $('btn-pip-copy').onclick = copyTsv;
    $('btn-pip-copy-values').onclick = copyValuesOnly;
    $('btn-pip-export').onclick = exportXlsx;
    $('pip-name').addEventListener('focus', refreshNameList);
    $('btn-pip-clear-cache').onclick = ()=>{ Object.keys(dayCache).forEach(k=> delete dayCache[k]); $('pip-status').textContent = '已清除快取，下次產出會重新下載'; };
    loadStore();
  }
  init();
})();
