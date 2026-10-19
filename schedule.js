/* ============================================================
   schedule.js — 讀取 CS 班表（Google Sheet），對照專員名單
   - 用 drive-store.js 的同一組 Google 授權（drive.readonly 可讀 Sheets API）
   - 分頁依日期自動推算：2026-10-19 → 「2026_10月班表」
   - 在日期列（表頭前幾列）找到該日欄，用「員工姓名(英文)」對到名單姓名
   - 若已載入 Status Log / IC / Chat，比對「班表休假但有上線」「有班但沒上線」
   班表網址只存在本機瀏覽器（localStorage），不寫進程式碼（repo 為公開）
   依賴：engine.js（state / storageGet / storageSet / toDate）、drive-store.js（window.DriveAuth）
   ============================================================ */
(function(){
  const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets';
  const URL_KEY = 'schedule_sheet_url';
  const HEADER_ROWS = 6;          // 表頭（日期列、姓名欄標題）只會出現在前幾列
  const OFF_RE = /休|假/;         // 休、病假8、特休8、(季)特休8、理假8…
  const SPECIAL_RE = /支援|回訓|訓|RP|會議/i;

  const sc = { url:'', date:'', busy:false, msg:'', msgType:'', result:null, autoTried:{} };

  /* ---------- 樣式 ---------- */
  document.head.insertAdjacentHTML('beforeend', `<style>
  #schedule-card{border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;margin:0 0 14px;background:var(--bg);}
  #schedule-card .sc-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;}
  #schedule-card .sc-title{font-size:13px;font-weight:700;margin-right:4px;}
  #schedule-card input[type=text]{flex:1;min-width:240px;font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);}
  #schedule-card input[type=date]{font-size:13px;padding:5px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);}
  #schedule-card .sc-msg{font-size:12px;margin-top:8px;color:var(--text-secondary);}
  #schedule-card .sc-msg.err{color:#c62828;} #schedule-card .sc-msg.ok{color:var(--success);}
  #schedule-card .sc-issues{margin-top:8px;display:flex;flex-direction:column;gap:3px;font-size:12px;max-height:180px;overflow-y:auto;}
  #schedule-card .sc-issue{color:var(--warning);}
  #schedule-card .sc-legend{font-size:11px;color:var(--text-secondary);margin-top:6px;}
  td.ag-sched{font-size:12px;white-space:nowrap;}
  .sc-tag{display:inline-block;padding:2px 7px;border-radius:5px;border:1px solid var(--border);background:var(--surface);}
  .sc-tag.off{background:#FCE3D3;border-color:#F0B48E;color:#9A3412;}
  .sc-tag.special{background:#E0ECFB;border-color:#A9C5EE;color:#1E4E8C;}
  td.ag-sched .sc-tag.none{color:var(--text-secondary);border-style:dashed;}
  td.ag-sched .sc-warn{display:block;font-size:10px;color:#B45309;margin-top:2px;font-weight:600;}
  html.dark .sc-tag.off{background:#4A2A17;border-color:#8A4E28;color:#F5B78E;}
  html.dark .sc-tag.special{background:#1C2E47;border-color:#36557F;color:#9CC1F2;}
  html.dark td.ag-sched .sc-warn{color:#F5C96B;}
  html.dark #schedule-card .sc-msg.err{color:#FF9B9B;}
  </style>`);

  /* ---------- 工具 ---------- */
  const esc = s=> String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const pad = n=> String(n).padStart(2,'0');
  const ymd = d=> `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const normName = s=> String(s||'').toLowerCase().replace(/\s+/g,' ').trim();
  const letters = s=> String(s||'').toLowerCase().replace(/[^a-z]/g,'');

  function sheetIdFromUrl(u){
    const m = String(u||'').match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return m ? m[1] : (/^[a-zA-Z0-9-_]{30,}$/.test(String(u||'').trim()) ? String(u).trim() : '');
  }
  function tabNameFor(dateStr){
    const [y, m] = dateStr.split('-').map(Number);
    return `${y}_${m}月班表`;
  }
  // 表頭日期可能是 2026/10/19、2026-10-19、10/19；回傳 yyyy-mm-dd 或 ''
  function parseHeaderDate(v, year){
    const s = String(v||'').trim();
    let m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if(m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})$/);
    if(m) return `${year}-${pad(m[1])}-${pad(m[2])}`;
    return '';
  }
  // 預設日期：已載入的 Status Log 最多筆的日期，沒有就今天
  function defaultDate(){
    const col = state.status?.map?.start_datetime;
    if(col && state.status.rows.length){
      const cnt = {};
      state.status.rows.forEach(r=>{ const d = toDate(r[col]); if(d) cnt[ymd(d)] = (cnt[ymd(d)]||0)+1; });
      const top = Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0];
      if(top) return top[0];
    }
    return ymd(new Date());
  }

  async function sheetsGet(path){
    const token = window.DriveAuth?.readToken();
    if(!token) throw new Error('Google 授權已過期，請再按一次「讀取班表」');
    const res = await fetch(`${SHEETS}/${path}`, {headers:{Authorization:`Bearer ${token}`}});
    if(res.ok) return res.json();
    const txt = await res.text();
    if(res.status === 403 && /SERVICE_DISABLED|has not been used|is disabled/i.test(txt))
      throw new Error('此工具的 GCP 專案尚未啟用 Google Sheets API，請到 GCP Console →「API 和服務」啟用後再試');
    if(res.status === 403 || res.status === 404) throw new Error('無法讀取班表：請確認網址正確，且你的帳號有這份試算表的檢視權限');
    if(res.status === 400 && /Unable to parse range/i.test(txt)) throw new Error('找不到班表分頁');
    throw new Error(`Sheets API ${res.status}：${txt.slice(0,160)}`);
  }

  /* ---------- 讀班表 ---------- */
  async function fetchSchedule(sheetId, dateStr){
    const year = dateStr.slice(0,4);
    // 1) 找分頁：優先完全符合「2026_10月班表」，其次名稱含「2026_10月」與「班表」
    const meta = await sheetsGet(`${sheetId}?fields=sheets.properties.title`);
    const titles = (meta.sheets||[]).map(s=>s.properties.title);
    const want = tabNameFor(dateStr);
    const [y, mo] = dateStr.split('-').map(Number);
    const tab = titles.find(t=>t.trim() === want)
      || titles.find(t=> t.includes(`${y}_${mo}月`) && t.includes('班表'))
      || titles.find(t=> t.includes(`${y}_${pad(mo)}月`) && t.includes('班表'));
    if(!tab) throw new Error(`找不到分頁「${want}」（現有分頁：${titles.slice(0,8).join('、')}${titles.length>8?'…':''}）`);

    // 2) 一次讀整個分頁（顯示值）
    const range = encodeURIComponent(`'${tab.replace(/'/g,"''")}'`);
    const data = await sheetsGet(`${sheetId}/values/${range}?valueRenderOption=FORMATTED_VALUE&majorDimension=ROWS`);
    const rows = data.values || [];
    if(!rows.length) throw new Error(`分頁「${tab}」是空的`);

    // 3) 表頭：找日期欄、英文姓名欄、中文姓名欄、員編欄
    let dateCol = -1, headerEnd = 0, enCol = -1, zhCol = -1, idCol = -1;
    for(let r=0; r<Math.min(HEADER_ROWS, rows.length); r++){
      (rows[r]||[]).forEach((v, c)=>{
        const s = String(v||'');
        if(dateCol < 0 && parseHeaderDate(s, year) === dateStr){ dateCol = c; headerEnd = Math.max(headerEnd, r); }
        if(enCol < 0 && /英文/.test(s)) { enCol = c; headerEnd = Math.max(headerEnd, r); }
        if(zhCol < 0 && /中文/.test(s)) zhCol = c;
        if(idCol < 0 && /^員編$/.test(s.trim())) idCol = c;
      });
    }
    if(enCol < 0) throw new Error(`分頁「${tab}」找不到「員工姓名(英文)」欄`);
    if(dateCol < 0) throw new Error(`分頁「${tab}」表頭找不到 ${dateStr.replace(/-/g,'/')} 這一天`);

    // 4) 表頭以下每一列：英文姓名 → 當日狀態
    const byName = {}, byLetters = {};
    for(let r=headerEnd+1; r<rows.length; r++){
      const row = rows[r] || [];
      const en = String(row[enCol]||'').trim();
      if(!en) continue;
      const rec = {en, zh: zhCol>=0 ? String(row[zhCol]||'').trim() : '', id: idCol>=0 ? String(row[idCol]||'').trim() : '',
                   status: String(row[dateCol]||'').trim(), sheetRow: r+1};
      if(!byName[normName(en)]) byName[normName(en)] = rec;
      if(!byLetters[letters(en)]) byLetters[letters(en)] = rec;
    }
    return {tab, dateStr, byName, byLetters, total:Object.keys(byName).length};
  }

  /* ---------- 實際上線：該日有沒有 Status Log / IC / Chat ---------- */
  function activityFor(dateStr){
    const active = new Set();
    let covered = false;
    const scan = (key, emailCol, timeCol)=>{
      const s = state[key];
      if(!s || !s.rows.length || !emailCol || !timeCol) return;
      s.rows.forEach(r=>{
        const d = toDate(r[timeCol]);
        if(!d || ymd(d) !== dateStr) return;
        covered = true;
        const e = String(r[emailCol]||'').toLowerCase().trim();
        if(e) active.add(e);
      });
    };
    scan('status', state.status.map.email, state.status.map.start_datetime);
    scan('ic', state.ic.map.last_agent_email, state.ic.map.call_end_time);
    return {active, covered};
  }

  function classify(status){
    if(!status) return 'none';
    if(OFF_RE.test(status)) return 'off';
    if(SPECIAL_RE.test(status)) return 'special';
    return 'shift';
  }

  /* ---------- 套到名單表格 ---------- */
  function lookup(name, email){
    const r = sc.result;
    if(!r) return null;
    return r.byName[normName(name)] || r.byLetters[letters(name)] || null;
  }

  function applyToRoster(){
    const head = document.querySelectorAll('#roster-blocks .ag-sched-head');
    const headText = sc.result ? `班表 ${sc.result.dateStr.slice(5).replace('-','/')}` : '班表';
    head.forEach(h=>{ if(h.textContent !== headText) h.textContent = headText; });
    const issues = [];
    const act = sc.result ? activityFor(sc.result.dateStr) : {active:new Set(), covered:false};
    document.querySelectorAll('#roster-blocks .agent-tbody tr').forEach(tr=>{
      const cell = tr.querySelector('td.ag-sched');
      if(!cell) return;
      cell.textContent = '';
      cell.title = '';
      if(!sc.result) return;
      const name = tr.querySelector('.ag-name')?.value.trim() || '';
      const email = (tr.querySelector('.ag-email')?.value || '').trim().toLowerCase();
      if(!name && !email) return;
      const rec = lookup(name, email);
      const tag = document.createElement('span');
      let warn = '';
      if(!rec){
        tag.className = 'sc-tag none';
        tag.textContent = '班表無此人';
        issues.push(`${name||email}：班表找不到此英文姓名`);
      }else{
        const cls = classify(rec.status);
        tag.className = 'sc-tag ' + (cls === 'shift' ? '' : cls);
        tag.textContent = rec.status || '（空白）';
        cell.title = `班表第 ${rec.sheetRow} 列｜${rec.zh} ${rec.id}`.trim();
        if(act.covered && email){
          const online = act.active.has(email);
          if(cls === 'off' && online) warn = '班表休假但有上線紀錄';
          else if(cls === 'shift' && !online) warn = '有班但無上線紀錄';
        }
      }
      cell.appendChild(tag);
      if(warn){
        const w = document.createElement('span');
        w.className = 'sc-warn'; w.textContent = '⚠️ ' + warn;
        cell.appendChild(w);
        issues.push(`${name||email}：班表「${rec.status}」，${warn}`);
      }
    });
    sc.issues = issues;
    sc.covered = act.covered;
    renderCard(false);
  }

  /* ---------- 動作 ---------- */
  async function load(fromClick){
    const sheetId = sheetIdFromUrl(sc.url);
    if(!sheetId){ sc.msg = '請先貼上班表的 Google Sheet 網址'; sc.msgType = 'err'; return renderCard(); }
    if(!sc.date){ sc.msg = '請選擇日期'; sc.msgType = 'err'; return renderCard(); }
    try{
      if(fromClick) await window.DriveAuth.ensureRead();     // 需在點擊當下第一個 await 取 token
      else if(!window.DriveAuth?.readToken()) return;          // 自動模式：沒有有效 token 就不打擾
      sc.busy = true; sc.msg = '讀取班表中…'; sc.msgType = ''; renderCard();
      sc.result = await fetchSchedule(sheetId, sc.date);
      sc.busy = false;
      sc.msg = `✅ 已讀取「${sc.result.tab}」${sc.date.replace(/-/g,'/')}（班表 ${sc.result.total} 人）`;
      sc.msgType = 'ok';
      applyToRoster();
    }catch(e){
      sc.busy = false; sc.result = null;
      sc.msg = '❌ ' + e.message; sc.msgType = 'err';
      applyToRoster();
    }
  }

  /* ---------- 畫面 ---------- */
  function renderCard(full=true){
    const card = document.getElementById('schedule-card');
    if(!card) return;
    if(full || !card.querySelector('#sc-load')){
      card.innerHTML = `
        <div class="sc-row">
          <span class="sc-title">📅 班表對照</span>
          <input type="text" id="sc-url" placeholder="貼上 CS 班表 Google Sheet 網址（只存在本機瀏覽器）" value="${esc(sc.url)}">
        </div>
        <div class="sc-row" style="margin-top:8px;">
          日期 <input type="date" id="sc-date" value="${esc(sc.date)}">
          <button class="primary" id="sc-load">讀取班表</button>
          <button class="secondary" id="sc-clear">清除</button>
        </div>
        <div class="sc-msg" id="sc-msg"></div>
        <div class="sc-issues" id="sc-issues"></div>
        <div class="sc-legend">分頁依日期自動選擇（例：2026_10月班表），用「員工姓名(英文)」對應名單姓名。已載入明細時會比對當日上線紀錄。<span class="sc-tag off" style="padding:0 5px;border-radius:4px;">休／假</span>　<span class="sc-tag special" style="padding:0 5px;border-radius:4px;">支援／回訓</span></div>`;
      card.querySelector('#sc-url').addEventListener('change', async e=>{
        sc.url = e.target.value.trim();
        await storageSet(URL_KEY, sc.url);
      });
      card.querySelector('#sc-date').addEventListener('change', e=>{ sc.date = e.target.value; });
      card.querySelector('#sc-load').onclick = ()=>{ sc.url = card.querySelector('#sc-url').value.trim(); storageSet(URL_KEY, sc.url); load(true); };
      card.querySelector('#sc-clear').onclick = ()=>{ sc.result = null; sc.msg = ''; sc.issues = []; applyToRoster(); };
    }
    card.querySelector('#sc-load').disabled = sc.busy;
    const msgEl = card.querySelector('#sc-msg');
    msgEl.textContent = sc.msg; msgEl.className = 'sc-msg ' + sc.msgType;
    const box = card.querySelector('#sc-issues');
    box.innerHTML = '';
    if(sc.result){
      if(!sc.covered){
        const d = document.createElement('div');
        d.textContent = 'ℹ️ 尚未載入該日的 Status Log / IC 明細，只顯示班表，不比對上線紀錄';
        box.appendChild(d);
      }
      (sc.issues||[]).forEach(t=>{ const d = document.createElement('div'); d.className = 'sc-issue'; d.textContent = '⚠️ ' + t; box.appendChild(d); });
      if(sc.covered && !(sc.issues||[]).length){
        const d = document.createElement('div'); d.className = 'sc-msg ok'; d.textContent = '✅ 名單與班表、上線紀錄一致'; box.appendChild(d);
      }
    }
  }

  /* ---------- 掛勾 ---------- */
  // 名單區塊會整塊重繪／新增列 → 自動把班表重新套上（只在內容變動時觸發，不監聽自己寫入的格子）
  let pending = false;
  new MutationObserver(muts=>{
    if(!sc.result || pending) return;
    if(muts.every(m=> m.target.closest && m.target.closest('td.ag-sched, th.ag-sched-head'))) return;
    pending = true;
    requestAnimationFrame(()=>{ pending = false; applyToRoster(); });
  }).observe(document.getElementById('roster-blocks'), {childList:true, subtree:true});
  document.getElementById('roster-blocks').addEventListener('change', e=>{
    if(sc.result && e.target.matches('.ag-name,.ag-email')) applyToRoster();
  });

  // 換了明細資料 → 重新比對上線紀錄；日期仍是自動帶入時一起更新
  document.addEventListener('sources:changed', ()=>{
    const d = defaultDate();
    if(!sc.userPicked && d !== sc.date){ sc.date = d; renderCard(); }
    if(sc.result) applyToRoster();
  });
  document.addEventListener('change', e=>{ if(e.target.id === 'sc-date') sc.userPicked = true; });

  // 切到「專員名單」分頁：已授權、有網址、這個日期還沒讀過 → 自動讀取（不跳授權視窗）
  document.querySelectorAll('.tab[data-tab="roster"]').forEach(t=> t.addEventListener('click', ()=>{
    if(!sc.userPicked) sc.date = defaultDate();
    renderCard();
    const key = sc.url + '|' + sc.date;
    if(sc.url && !sc.autoTried[key] && (!sc.result || sc.result.dateStr !== sc.date)){
      sc.autoTried[key] = true;
      load(false);
    }
  }));

  (async ()=>{
    sc.url = (await storageGet(URL_KEY)) || '';
    sc.date = defaultDate();
    renderCard();
  })();
})();
