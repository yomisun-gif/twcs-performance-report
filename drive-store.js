/* ============================================================
   drive-store.js — 雲端資料庫（Google Drive）
   - 讀：有資料夾檢視權限者，可選日期載入明細，直接接 engine 的 assignSource()
   - 寫：有資料夾編輯權限者，可把目前手動上傳的明細「存入資料庫」
   - 權限完全由 Drive 資料夾 ACL 決定（capabilities.canAddChildren），前端不寫死名單
     → 開放讀取：資料夾分享「檢視者」；開放上傳：分享「編輯者」
   依賴：engine.js（state / assignSource / clearSource / guessSourceType / SOURCE_LABEL / toDate）
   ============================================================ */
(function(){
  const CFG = {
    CLIENT_ID: '1065926217249-7ms3cb5dsfodmmpcqunp8k0ab44puvv6.apps.googleusercontent.com',
    ROOT_FOLDER_ID: '1iuUFD0T4Og-5zCNBRNjEbITMVoqjh5Xx',
    SCOPE_READ: 'https://www.googleapis.com/auth/drive.readonly',
    SCOPE_WRITE: 'https://www.googleapis.com/auth/drive',
    TOKEN_KEY: 'drive_tokens',
  };
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const ALL = 'supportsAllDrives=true&includeItemsFromAllDrives=true';
  const KEYS = ['ic','chat','status','hourly','iact'];
  const CORE = ['ic','chat','status','hourly'];
  const FOLDER_MIME = 'application/vnd.google-apps.folder';

  const ui = { connected:false, canWrite:false, noAccess:false, dates:[], selected:null, busy:false, msg:'', msgType:'' };

  /* ---------- 樣式 ---------- */
  const css = `
  #drive-card .dr-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;}
  #drive-card h2{margin:0;}
  #drive-card .dr-sub{font-size:12px;color:var(--text-secondary);}
  #drive-card .dr-section{margin-top:14px;padding-top:14px;border-top:1px solid var(--border);}
  #drive-card .dr-label{font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;}
  #drive-card .dr-chips{display:flex;gap:6px;flex-wrap:wrap;max-height:112px;overflow-y:auto;}
  #drive-card .dr-chip{font-size:12px;padding:5px 10px;border:1px solid var(--border);border-radius:999px;background:var(--bg);color:var(--text);cursor:pointer;display:inline-flex;gap:5px;align-items:center;}
  #drive-card .dr-chip:hover{border-color:var(--primary);}
  #drive-card .dr-chip.active{background:var(--primary);border-color:var(--primary);color:#fff;}
  #drive-card .dr-chip .dot{width:7px;height:7px;border-radius:50%;background:var(--success);}
  #drive-card .dr-chip .dot.partial{background:var(--warning);}
  #drive-card .dr-chip .dot.unknown{background:var(--text-secondary);}
  #drive-card .dr-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px;}
  #drive-card .dr-row input[type=date]{font-size:13px;padding:6px 8px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);}
  #drive-card .dr-ready{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;}
  #drive-card .dr-ready span{padding:3px 8px;border-radius:6px;background:var(--bg);border:1px solid var(--border);color:var(--text-secondary);}
  #drive-card .dr-ready span.ok{color:var(--success);border-color:var(--success);}
  #drive-card .dr-msg{margin-top:10px;font-size:12px;min-height:16px;color:var(--text-secondary);}
  #drive-card .dr-msg.err{color:#c62828;} #drive-card .dr-msg.ok{color:var(--success);}
  #drive-card button:disabled{opacity:.45;cursor:not-allowed;}
  html.dark #drive-card .dr-msg.err{color:#FF9B9B;}
  .detect-row.from-drive{border-style:dashed;}
  `;
  document.head.insertAdjacentHTML('beforeend', `<style>${css}</style>`);

  /* ---------- Token 管理（讀/寫分開，存 sessionStorage，過期前 60 秒視為失效） ---------- */
  function loadTokens(){ try{ return JSON.parse(sessionStorage.getItem(CFG.TOKEN_KEY)||'{}'); }catch(e){ return {}; } }
  function saveTokens(t){ sessionStorage.setItem(CFG.TOKEN_KEY, JSON.stringify(t)); }
  function validToken(kind){
    const t = loadTokens()[kind];
    return t && t.exp - 60000 > Date.now() ? t.token : null;
  }
  // 必須在使用者點擊的呼叫鏈中「第一個 await」呼叫，避免彈窗被瀏覽器攔截
  function ensureToken(kind){
    const have = validToken(kind) || (kind === 'read' && validToken('write'));
    if(have) return Promise.resolve(have);
    return new Promise((resolve, reject)=>{
      if(!window.google?.accounts?.oauth2) return reject(new Error('Google 授權元件尚未載入，請稍候再試'));
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CFG.CLIENT_ID,
        scope: kind === 'write' ? CFG.SCOPE_WRITE : CFG.SCOPE_READ,
        hint: sessionStorage.getItem('sp_auth_email') || undefined,
        callback: r => {
          if(r.error) return reject(new Error(r.error_description || r.error));
          const all = loadTokens();
          all[kind] = {token:r.access_token, exp: Date.now() + (r.expires_in||3600)*1000};
          saveTokens(all);
          resolve(r.access_token);
        },
        error_callback: e => reject(new Error(e.type === 'popup_closed' ? '已取消授權' : (e.message || e.type))),
      });
      client.requestAccessToken({prompt:''});
    });
  }

  async function api(url, opt={}, kind='read'){
    const token = validToken(kind) || (kind === 'read' && validToken('write'));
    if(!token) throw new Error('授權已過期，請重新點「連接資料庫」');
    const res = await fetch(url, {...opt, headers:{...(opt.headers||{}), Authorization:`Bearer ${token}`}});
    if(res.status === 401){ const all = loadTokens(); delete all[kind]; saveTokens(all); throw new Error('授權已過期，請重新點「連接資料庫」'); }
    if(!res.ok){ const e = new Error(`Drive API ${res.status}：${(await res.text()).slice(0,200)}`); e.status = res.status; throw e; }
    return res;
  }
  const q = s => encodeURIComponent(s);

  /* ---------- Drive 操作 ---------- */
  async function checkAccess(){
    try{
      const r = await (await api(`${API}/files/${CFG.ROOT_FOLDER_ID}?fields=id,capabilities(canAddChildren)&supportsAllDrives=true`)).json();
      ui.noAccess = false;
      ui.canWrite = !!r.capabilities?.canAddChildren;
    }catch(e){
      if(e.status === 404 || e.status === 403){ ui.noAccess = true; ui.canWrite = false; return; }
      throw e;
    }
  }

  // 資料夾 description 存「該日已存類型」，例如 "ic,chat,status,hourly"，列日期時一次取得、免逐一展開
  async function listDates(){
    const url = `${API}/files?q=${q(`'${CFG.ROOT_FOLDER_ID}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id,name,description,modifiedTime)&orderBy=name desc&pageSize=1000&${ALL}`;
    const files = (await (await api(url)).json()).files || [];
    ui.dates = files.filter(f=>/^\d{4}-\d{2}-\d{2}$/.test(f.name)).map(f=>{
      const types = (f.description||'').split(',').map(s=>s.trim()).filter(s=>KEYS.includes(s));
      return {id:f.id, name:f.name, types, known: !!f.description};
    });
  }

  async function listFolderFiles(folderId, kind='read'){
    const url = `${API}/files?q=${q(`'${folderId}' in parents and trashed=false and mimeType!='${FOLDER_MIME}'`)}&fields=files(id,name,description)&pageSize=100&${ALL}`;
    return (await (await api(url, {}, kind)).json()).files || [];
  }

  // 檔名 ic.xlsx → ic；舊資料（原始檔名）退回用 engine 的檔名規則判斷
  function keyOfDriveFile(name){
    const m = name.match(/^(ic|chat|status|hourly|iact)\.(xlsx|xls|csv)$/i);
    if(m) return m[1].toLowerCase();
    return guessSourceType(name, []);
  }

  function parseBuffer(buf){
    const wb = XLSX.read(new Uint8Array(buf), {type:'array', cellDates:true});
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:''});
    return {rows, headers: rows.length ? Object.keys(rows[0]) : []};
  }

  async function ensureDateFolder(dateStr){
    const url = `${API}/files?q=${q(`'${CFG.ROOT_FOLDER_ID}' in parents and name='${dateStr}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=files(id,description)&${ALL}`;
    const found = (await (await api(url, {}, 'write')).json()).files || [];
    if(found.length) return found[0];
    const res = await api(`${API}/files?supportsAllDrives=true&fields=id,description`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({name:dateStr, mimeType:FOLDER_MIME, parents:[CFG.ROOT_FOLDER_ID]})
    }, 'write');
    return await res.json();
  }

  async function uploadSource(folderId, key, file, existing){
    const ext = (file.name.match(/\.(xlsx|xls|csv)$/i)?.[1] || 'xlsx').toLowerCase();
    const who = sessionStorage.getItem('sp_auth_email') || '';
    const meta = {
      name: `${key}.${ext}`,
      description: `原始檔名：${file.name}\n上傳者：${who}\n上傳時間：${new Date().toLocaleString('zh-TW')}`,
    };
    const same = existing.filter(f=> keyOfDriveFile(f.name) === key);
    const target = same.shift();
    // 同類型多餘的舊檔（例如 PoC 時期的原始檔名、或副檔名不同）移到垃圾桶，確保一天一類只有一份
    for(const f of same){
      await api(`${API}/files/${f.id}?supportsAllDrives=true`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({trashed:true})}, 'write');
    }
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(target ? meta : {...meta, parents:[folderId]})], {type:'application/json'}));
    form.append('file', file);
    const url = target
      ? `${UPLOAD}/files/${target.id}?uploadType=multipart&supportsAllDrives=true`
      : `${UPLOAD}/files?uploadType=multipart&supportsAllDrives=true`;
    await api(url, {method: target ? 'PATCH' : 'POST', body: form}, 'write');
  }

  /* ---------- 輔助：從 Status Log 推測資料日（Start Time 眾數） ---------- */
  function suggestDataDate(){
    const col = state.status.map?.start_datetime;
    if(!col || !state.status.rows.length) return '';
    const cnt = {};
    state.status.rows.forEach(r=>{
      const d = toDate(r[col]);
      if(!d) return;
      const k = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      cnt[k] = (cnt[k]||0) + 1;
    });
    return Object.entries(cnt).sort((a,b)=>b[1]-a[1])[0]?.[0] || '';
  }

  /* ---------- 動作 ---------- */
  function setMsg(msg, type=''){ ui.msg = msg; ui.msgType = type; render(); }

  async function connect(){
    try{
      await ensureToken('read');
      ui.busy = true; setMsg('連接中…');
      await checkAccess();
      ui.connected = true;
      if(!ui.noAccess) await listDates();
      ui.busy = false;
      setMsg(ui.noAccess ? '' : (ui.dates.length ? `共 ${ui.dates.length} 天資料` : '資料庫尚無資料'));
    }catch(e){ ui.busy = false; setMsg('❌ ' + e.message, 'err'); }
  }

  async function loadDate(){
    const d = ui.dates.find(x=>x.id === ui.selected);
    if(!d) return;
    try{
      await ensureToken('read');   // 先取 token（需在點擊當下），再跳確認框
      const hasLocal = KEYS.some(k=> state[k].origin === 'local' && state[k].rows.length);
      if(hasLocal && !confirm(`目前已手動上傳的明細會被 ${d.name} 的資料庫資料取代，確定載入？`)) return;
      ui.busy = true; setMsg(`下載 ${d.name} 中…`);
      const files = await listFolderFiles(d.id);
      const picked = {};
      files.forEach(f=>{ const k = keyOfDriveFile(f.name); if(k && !picked[k]) picked[k] = f; });
      const keys = Object.keys(picked);
      if(!keys.length) throw new Error('該日資料夾內沒有可辨識的明細檔');
      const t0 = performance.now();
      const parsed = await Promise.all(keys.map(async k=>{
        const buf = await (await api(`${API}/files/${picked[k].id}?alt=media&supportsAllDrives=true`)).arrayBuffer();
        return [k, parseBuffer(buf)];
      }));
      // 清空舊狀態後套用
      KEYS.forEach(k=> clearSource(k));
      KEYS.forEach(k=>{ const el = document.getElementById('file-'+k); if(el) el.value = ''; });
      const box = document.getElementById('detect-results');
      box.innerHTML = '';
      parsed.forEach(([k, {rows, headers}])=> assignSource(k, rows, headers, null, 'drive'));
      const row = document.createElement('div');
      row.className = 'detect-row from-drive';
      row.innerHTML = `<span class="fname">☁️ 已從資料庫載入 ${d.name}</span><span>${keys.map(k=>SOURCE_LABEL[k]).join('、')}</span>`;
      box.appendChild(row);
      const missing = CORE.filter(k=>!picked[k]);
      ui.busy = false;
      setMsg(missing.length
        ? `⚠️ 已載入，但缺少：${missing.map(k=>SOURCE_LABEL[k]).join('、')}，可再手動補上傳`
        : `✅ 已載入 ${d.name}（${((performance.now()-t0)/1000).toFixed(1)} 秒）`, missing.length ? '' : 'ok');
    }catch(e){ ui.busy = false; setMsg('❌ ' + e.message, 'err'); }
  }

  async function saveToDrive(){
    const dateStr = document.getElementById('dr-save-date').value;
    if(!dateStr) return setMsg('請先選擇資料日', 'err');
    const localKeys = KEYS.filter(k=> state[k].file && state[k].origin === 'local');
    try{
      await ensureToken('write');  // 先取 token（需在點擊當下），再跳確認框
      const suggested = suggestDataDate();
      if(suggested && suggested !== dateStr &&
        !confirm(`Status Log 的資料大多落在 ${suggested}，但你選的是 ${dateStr}。\n確定要存成 ${dateStr}？`)) return;
      const existing = ui.dates.find(x=>x.name === dateStr);
      if(existing && !confirm(`${dateStr} 已有資料，將覆蓋以下類型：\n${localKeys.map(k=>SOURCE_LABEL[k]).join('、')}\n確定？`)) return;
      ui.busy = true; setMsg(`存入 ${dateStr} 中…`);
      const folder = await ensureDateFolder(dateStr);
      const files = await listFolderFiles(folder.id, 'write');
      for(const k of localKeys){
        setMsg(`上傳 ${SOURCE_LABEL[k]}…`);
        await uploadSource(folder.id, k, state[k].file, files);
      }
      const prev = (folder.description||'').split(',').map(s=>s.trim()).filter(s=>KEYS.includes(s));
      const types = KEYS.filter(k=> prev.includes(k) || localKeys.includes(k));
      await api(`${API}/files/${folder.id}?supportsAllDrives=true`, {
        method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({description: types.join(',')})
      }, 'write');
      await listDates();
      ui.busy = false;
      setMsg(`✅ 已存入 ${dateStr}（${localKeys.length} 份）`, 'ok');
    }catch(e){ ui.busy = false; setMsg('❌ ' + e.message, 'err'); }
  }

  /* ---------- 畫面 ---------- */
  function esc(s){ return String(s).replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }

  function render(){
    const card = document.getElementById('drive-card');
    if(!card) return;
    const dis = ui.busy ? 'disabled' : '';
    let html = `<div class="dr-head"><div><h2>☁️ 從資料庫載入</h2>
      <div class="dr-sub">選日期直接載入已存的明細，免手動下載上傳。也可照舊使用下方手動上傳。</div></div>
      ${ui.connected ? '' : `<button class="primary" id="dr-connect" ${dis}>連接資料庫</button>`}</div>`;

    if(ui.connected && ui.noAccess){
      html += `<div class="dr-msg">你目前沒有資料庫讀取權限，請使用下方手動上傳。</div>`;
      card.innerHTML = html; bind(); return;
    }

    if(ui.connected){
      html += `<div class="dr-section"><div class="dr-label">選擇日期　<span style="font-weight:400"><span style="color:var(--success)">●</span> 核心四份齊全　<span style="color:var(--warning)">●</span> 缺檔　<span>●</span> 未標記</span></div>`;
      html += ui.dates.length
        ? `<div class="dr-chips">${ui.dates.map(d=>{
            const cls = !d.known ? 'unknown' : (CORE.every(k=>d.types.includes(k)) ? '' : 'partial');
            const tip = d.known ? d.types.map(k=>SOURCE_LABEL[k]).join('、') : '未標記類型（舊資料）';
            return `<span class="dr-chip ${ui.selected===d.id?'active':''}" data-id="${d.id}" title="${esc(tip)}"><span class="dot ${cls}"></span>${d.name}</span>`;
          }).join('')}</div>
          <div class="dr-row"><button class="primary" id="dr-load" ${ui.selected && !ui.busy ? '' : 'disabled'}>載入此日期</button>
          <button class="secondary" id="dr-refresh" ${dis}>重新整理</button></div>`
        : `<div class="dr-sub">資料庫尚無資料</div>`;
      html += `</div>`;

      if(ui.canWrite){
        const localKeys = KEYS.filter(k=> state[k].file && state[k].origin === 'local');
        const coreReady = CORE.every(k=>localKeys.includes(k));
        const prevDate = document.getElementById('dr-save-date')?.value;
        const dateVal = prevDate || suggestDataDate();
        html += `<div class="dr-section"><div class="dr-label">存入資料庫（管理者）</div>
          <div class="dr-ready">${KEYS.map(k=>`<span class="${localKeys.includes(k)?'ok':''}">${localKeys.includes(k)?'✓':'·'} ${SOURCE_LABEL[k]}${k==='iact'?'（選填）':''}</span>`).join('')}</div>
          <div class="dr-row">資料日 <input type="date" id="dr-save-date" value="${dateVal}">
          <button class="primary" id="dr-save" ${coreReady && !ui.busy ? '' : 'disabled'}>存入資料庫</button></div>
          <div class="dr-sub" style="margin-top:6px">先在下方手動上傳，核心四份齊全後即可存入。資料日預設取 Status Log 最多筆的日期。</div></div>`;
      }
    }
    html += `<div class="dr-msg ${ui.msgType}">${esc(ui.msg)}</div>`;
    card.innerHTML = html;
    bind();
  }

  function bind(){
    const $ = id => document.getElementById(id);
    $('dr-connect') && ($('dr-connect').onclick = connect);
    $('dr-load') && ($('dr-load').onclick = loadDate);
    $('dr-save') && ($('dr-save').onclick = saveToDrive);
    $('dr-refresh') && ($('dr-refresh').onclick = async ()=>{
      try{ await ensureToken('read'); await listDates(); setMsg(`共 ${ui.dates.length} 天資料`); }catch(e){ setMsg('❌ '+e.message,'err'); }
    });
    document.querySelectorAll('#drive-card .dr-chip').forEach(c=> c.onclick = ()=>{ ui.selected = c.dataset.id; render(); });
  }

  document.addEventListener('sources:changed', ()=>{ if(ui.connected && ui.canWrite && !ui.busy) render(); });

  render();
  // 本分頁已授權過（token 未過期）→ 自動連線，不跳視窗
  if(validToken('read') || validToken('write')) connect();
})();
