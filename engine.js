/* ============================================================
   engine.js — 核心引擎：上傳/欄位對應/專員名單/主管簡稱 + computeReport()
   這份檔案負責把四份明細檔 + 名單設定，算成一份標準化的 rows 陣列。
   不管以後加幾種報表樣板，都是吃這份 rows，這支檔案原則上不用跟著改。
   ============================================================ */

/* ============ 儲存層：優先用 Claude artifact 的 window.storage，
   若不存在（例如搬到 GitHub Pages 後）自動改用 localStorage，無需改程式碼 ============ */
const usingArtifactStorage = (typeof window.storage !== 'undefined');
document.getElementById('env-badge').textContent = usingArtifactStorage ? '(儲存於 Claude 對話環境)' : '(儲存於瀏覽器 localStorage)';
async function storageGet(key){
  if(usingArtifactStorage){
    try{ const r = await window.storage.get(key, false); return r ? r.value : null; }catch(e){ return null; }
  }
  return localStorage.getItem(key);
}
async function storageSet(key, val){
  if(usingArtifactStorage){ await window.storage.set(key, val, false); return; }
  localStorage.setItem(key, val);
}

/* ============ 狀態 ============ */
const state = {
  ic: {rows:[], headers:[], map:{}},
  chat: {rows:[], headers:[], map:{}},
  status: {rows:[], headers:[], map:{}},
  hourly: {rows:[], headers:[], map:{}},
  iact: {rows:[], headers:[], map:{}},
  roster: [],
  managers: {} // email(lower) -> 簡稱
};

const REQ = {
  ic: [
    ['last_agent_email','Last Agent Email（最後接聽專員 Email，決定通數/AHT/ACD歸屬）'],
    ['call_end_time','Call End Time（通話結束時間）'],
    ['last_routed_time','Last Routed to Agent Time（最後轉派至專員時間）'],
    ['is_answered','Is Answered（是否接聽，值需含 Yes/No）'],
    ['csat','CSAT（值為 Good/Bad/Average/- 等評價文字）'],
    ['call_status','Call Status（通話狀態，值為 Missed 的整筆不計入通數/產能）']
  ],
  chat: [
    ['chat_owner','Chat Owner（負責專員 Email，計算產能用）'],
    ['csat','CSAT Level（值為 Good/Bad/Average 等評價文字）']
  ],
  status: [
    ['email','專員 Email'],
    ['sub_status','Sub Status（子狀態，如 online for internet call / busy with wrapup 等）'],
    ['start_datetime','Status Start Time（狀態開始時間，含日期與時間）'],
    ['end_datetime','Status End Time（狀態結束時間，含日期與時間）']
  ],
  hourly: [
    ['email','Agent Email（專員 Email，用於加總外撥通數）'],
    ['call_outbound','Call Outbound（外撥通數，會加總後填入「忙碌 - 外撥(通數)」欄位）']
  ],
  iact: [
    ['email','Agent Email（專員 Email）'],
    ['channel_type','Channel Type（排除 Internet Call，其餘渠道整筆都計入 IACT 產能）']
  ]
};

const GUESS = {
  last_agent_email:['last agent email','last agent'],
  call_end_time:['call end time','end time'],
  last_routed_time:['last routed','routed to agent'],
  is_answered:['is answered','answered'],
  csat:['csat level','csat'],
  chat_owner:['chat owner','owner'],
  email:['agent email','email'],
  sub_status:['sub status','substatus'],
  start_datetime:['status start time','start time'],
  end_datetime:['status end time','end time'],
  call_outbound:['call outbound','outbound'],
  call_status:['call status'],
  channel_type:['channel type']
};

/* ============ Tabs ============ */
const TAB_TITLE = {upload:'上傳資料', mapping:'欄位對應', roster:'專員名單 / 主管簡稱', result:'報表結果', realtime:'即時產能', dashboard:'產能儀表板', iact:'IACT', devvars:'CALL自訂變數(測試)'};
function switchTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
  const titleEl = document.getElementById('page-title');
  if(titleEl) titleEl.textContent = TAB_TITLE[name] || '';
}
document.querySelectorAll('.tab').forEach(t=>{
  t.onclick = ()=> switchTab(t.dataset.tab);
  t.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter' || e.key === ' '){
      e.preventDefault();
      switchTab(t.dataset.tab);
    }
  });
});

/* ============ 深色模式 ============ */
function updateThemeButton(){
  const btn = document.getElementById('btn-theme-toggle');
  if(btn) btn.textContent = document.documentElement.classList.contains('dark') ? '☀️' : '🌙';
}
async function loadTheme(){
  const saved = await storageGet('ui_theme');
  if(saved === 'dark') document.documentElement.classList.add('dark');
  else if(saved === 'light') document.documentElement.classList.remove('dark');
  updateThemeButton();
}
document.getElementById('btn-theme-toggle').onclick = async ()=>{
  document.documentElement.classList.toggle('dark');
  await storageSet('ui_theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light');
  updateThemeButton();
};
loadTheme();
document.getElementById('btn-goto-mapping').onclick = ()=> switchTab('mapping');
document.getElementById('btn-goto-roster').onclick = ()=> switchTab('roster');

/* ============ 檔案解析 ============ */
function readFile(file, cb){
  const reader = new FileReader();
  reader.onload = (e)=>{
    const data = new Uint8Array(e.target.result);
    const wb = XLSX.read(data, {type:'array', cellDates:true});
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {defval:''});
    const headers = rows.length ? Object.keys(rows[0]) : [];
    cb(rows, headers);
  };
  reader.readAsArrayBuffer(file);
}
function guessMap(headers, key){
  const kws = GUESS[key] || [];
  const lower = headers.map(h=>String(h).toLowerCase());
  for(const kw of kws){
    const idx = lower.findIndex(h=>h.includes(kw));
    if(idx>=0) return headers[idx];
  }
  return '';
}
async function applySavedOrGuessMap(sourceKey, headers){
  const saved = await storageGet('colmap_'+sourceKey);
  let map = null;
  try{
    const parsed = saved ? JSON.parse(saved) : null;
    if(parsed && parsed.headers && JSON.stringify(parsed.headers.slice().sort())===JSON.stringify(headers.slice().sort())){
      map = parsed.map;
    }
  }catch(err){}
  if(!map){
    map = {};
    REQ[sourceKey].forEach(([key])=> map[key] = guessMap(headers, key));
  }
  state[sourceKey].map = map;
}
function assignSource(sourceKey, rows, headers){
  state[sourceKey].rows = rows;
  state[sourceKey].headers = headers;
  applySavedOrGuessMap(sourceKey, headers).then(()=>{
    renderMapping(sourceKey);
    document.getElementById('count-'+sourceKey).innerHTML = `<span class="status-ok">已讀取 ${rows.length} 筆資料</span>，欄位數：${headers.length}`;
    checkNextStep();
  });
}
function clearSource(sourceKey){
  state[sourceKey] = {rows:[], headers:[], map:{}};
  document.getElementById('count-'+sourceKey).textContent = '尚未上傳';
  renderMapping(sourceKey);
  checkNextStep();
}
function checkNextStep(){
  const card = document.getElementById('next-step-card');
  card.style.display = (state.ic.rows.length && state.chat.rows.length && state.status.rows.length && state.hourly.rows.length) ? 'block' : 'none';
}

// 依檔名關鍵字優先判斷，其次依欄位特徵猜測
function guessSourceType(filename, headers){
  const fn = filename.toLowerCase();
  if(fn.includes('internet_call')) return 'ic';
  if(fn.includes('chat_session')) return 'chat';
  if(fn.includes('historical_status') || fn.includes('status_log')) return 'status';
  if(fn.includes('hourly_activity')) return 'hourly';
  if(fn.includes('iact') || fn.includes('productivity')) return 'iact';
  const h = headers.map(x=>String(x).toLowerCase());
  if(h.some(x=>x.includes('chat owner'))) return 'chat';
  if(h.some(x=>x.includes('sub status'))) return 'status';
  if(h.some(x=>x.includes('call outbound'))) return 'hourly';
  if(h.some(x=>x.includes('channel type'))) return 'iact';
  if(h.some(x=>x.includes('last agent'))) return 'ic';
  return null;
}
const SOURCE_LABEL = {ic:'Internet Call 明細', chat:'Chat 明細', status:'Status Log', hourly:'Hourly Activity(外撥通數)', iact:'IACT 產量明細'};
function addDetectRow(filename, initialType, uncertain, onChange){
  const container = document.getElementById('detect-results');
  const row = document.createElement('div');
  row.className = 'detect-row';
  const prefix = uncertain ? '⚠️ 無法自動判斷，請手動選擇：' : '系統判斷為：';
  row.innerHTML = `<span class="fname">📄 ${filename}</span><span>${prefix}</span>
    <select class="detect-select">
      <option value="ic" ${initialType==='ic'?'selected':''}>${SOURCE_LABEL.ic}</option>
      <option value="chat" ${initialType==='chat'?'selected':''}>${SOURCE_LABEL.chat}</option>
      <option value="status" ${initialType==='status'?'selected':''}>${SOURCE_LABEL.status}</option>
      <option value="hourly" ${initialType==='hourly'?'selected':''}>${SOURCE_LABEL.hourly}</option>
      <option value="iact" ${initialType==='iact'?'selected':''}>${SOURCE_LABEL.iact}</option>
    </select>`;
  container.appendChild(row);
  row.querySelector('.detect-select').addEventListener('change', (e)=> onChange(e.target.value));
}
function handleIncomingFile(file){
  readFile(file, (rows, headers)=>{
    const guessed = guessSourceType(file.name, headers);
    let currentType = guessed || 'ic';
    assignSource(currentType, rows, headers);
    addDetectRow(file.name, currentType, !guessed, (newType)=>{
      if(newType === currentType) return;
      clearSource(currentType);
      currentType = newType;
      assignSource(currentType, rows, headers);
    });
  });
}

/* 拖曳區 */
const dz = document.getElementById('dropzone');
const dzInput = document.getElementById('dropzone-input');
['dragenter','dragover'].forEach(evt=> dz.addEventListener(evt, e=>{ e.preventDefault(); dz.classList.add('dragover'); }));
['dragleave','drop'].forEach(evt=> dz.addEventListener(evt, e=>{ e.preventDefault(); dz.classList.remove('dragover'); }));
dz.addEventListener('drop', e=>{
  Array.from(e.dataTransfer.files || []).forEach(handleIncomingFile);
});
dz.addEventListener('click', ()=> dzInput.click());
dzInput.addEventListener('change', (e)=>{
  Array.from(e.target.files || []).forEach(handleIncomingFile);
  dzInput.value = '';
});

/* 個別手動上傳（備援） */
function setupUpload(id, sourceKey){
  document.getElementById(id).addEventListener('change', function(e){
    const file = e.target.files[0];
    if(!file) return;
    readFile(file, (rows, headers)=> assignSource(sourceKey, rows, headers));
  });
}
setupUpload('file-ic','ic');
setupUpload('file-chat','chat');
setupUpload('file-status','status');
setupUpload('file-hourly','hourly');
setupUpload('file-iact','iact');

/* ============ 欄位對應 UI ============ */
function renderMapping(sourceKey){
  const container = document.getElementById('map-'+sourceKey);
  const headers = state[sourceKey].headers;
  if(!headers.length){ container.innerHTML = '<p class="hint">尚未上傳檔案。</p>'; return; }
  let html = '<table class="maptable"><tr><th>系統需要欄位</th><th>對應到您的檔案欄位</th></tr>';
  REQ[sourceKey].forEach(([key, label])=>{
    const cur = state[sourceKey].map[key] || '';
    html += `<tr><td>${label}</td><td><select data-source="${sourceKey}" data-key="${key}" class="mapsel">
      <option value="">（無此欄位）</option>
      ${headers.map(h=>`<option value="${h}" ${h===cur?'selected':''}>${h}</option>`).join('')}
    </select></td></tr>`;
  });
  html += '</table>';
  container.innerHTML = html;
  container.querySelectorAll('.mapsel').forEach(sel=>{
    sel.onchange = ()=>{ state[sel.dataset.source].map[sel.dataset.key] = sel.value; };
  });
}
['ic','chat','status','hourly','iact'].forEach(renderMapping);

document.getElementById('btn-save-mapping').onclick = async ()=>{
  for(const key of ['ic','chat','status','hourly','iact']){
    if(state[key].headers.length){
      await storageSet('colmap_'+key, JSON.stringify({headers:state[key].headers, map:state[key].map}));
    }
  }
  alert('欄位對應已儲存，下次上傳相同欄位結構的檔案會自動套用。');
};

/* ============ 主管 + 專員區塊（表格式） ============ */
function linesOf(text){ return (text||'').split(/\n/).map(l=>l.trim()).filter(Boolean); }

function defaultAgent(email, name){
  return {email:email||'', name:name||'', fullSkill:true, bbt:false, halfDay:false, countedInScore:true};
}
function defaultBlock(){ return {managerEmail:'', managerShort:'', batch:'', agents:[]}; }

// 相容舊版資料格式（emailsText/namesText 純文字），自動轉成新版 agents 表格陣列
function migrateBlock(b){
  if(b.agents) return b;
  const emails = linesOf(b.emailsText);
  const names = linesOf(b.namesText);
  const agents = emails.map((e,i)=> defaultAgent(e, names[i]||''));
  return {managerEmail:b.managerEmail||'', managerShort:b.managerShort||'', batch:b.batch||'', agents};
}

function agentRowHTML(a){
  return `<tr>
    <td class="ag-text-col"><input type="text" class="ag-email" value="${a.email||''}" placeholder="email"></td>
    <td class="ag-text-col"><input type="text" class="ag-name" value="${a.name||''}" placeholder="姓名"></td>
    <td><input type="checkbox" class="ag-full" ${a.fullSkill?'checked':''}></td>
    <td><input type="checkbox" class="ag-bbt" ${a.bbt?'checked':''}></td>
    <td><input type="checkbox" class="ag-half" ${a.halfDay?'checked':''}></td>
    <td><input type="checkbox" class="ag-counted" ${a.countedInScore!==false?'checked':''}></td>
    <td><button class="btn-row-del" type="button" title="刪除此列">✕</button></td>
  </tr>`;
}

function blockHTML(b){
  const agentRows = (b.agents||[]).map(agentRowHTML).join('');
  return `<div class="mgr-block">
    <div class="mgr-block-header">
      <input type="text" class="mgr-email" placeholder="主管信箱" value="${b.managerEmail||''}">
      <input type="text" class="mgr-short" placeholder="簡稱" value="${b.managerShort||''}">
      <input type="text" class="mgr-batch" placeholder="週次" value="${b.batch||''}">
      <span class="spacer"></span>
      <button class="secondary btn-copy" type="button">複製此區塊</button>
      <button class="secondary btn-del" type="button">刪除</button>
    </div>

    <div class="mgr-quick-add">
      <label class="mgr-col-label">快速新增（貼上後按「加入表格」，會依行號自動配對成一列一列）</label>
      <div class="mgr-split">
        <div class="mgr-col">
          <textarea class="mgr-quick-emails" placeholder="agent01@shopee.com&#10;agent02@shopee.com"></textarea>
        </div>
        <div class="mgr-col">
          <textarea class="mgr-quick-names" placeholder="王小明&#10;李小華"></textarea>
        </div>
      </div>
      <button class="secondary btn-quick-add" type="button" style="margin-top:6px;">加入表格 ↓</button>
    </div>

    <table class="agent-table">
      <thead><tr>
        <th style="width:26%;">Email</th><th style="width:16%;">姓名</th>
        <th>全技能<br><input type="checkbox" class="ag-selectall" data-col="full" title="全選/取消全選"></th>
        <th>BBT<br><input type="checkbox" class="ag-selectall" data-col="bbt" title="全選/取消全選"></th>
        <th>半天<br><input type="checkbox" class="ag-selectall" data-col="half" title="全選/取消全選"></th>
        <th>計入成績<br><input type="checkbox" class="ag-selectall" data-col="counted" title="全選/取消全選"></th>
        <th></th>
      </tr></thead>
      <tbody class="agent-tbody">${agentRows}</tbody>
    </table>
    <div class="toolbar" style="margin-top:8px;">
      <button class="secondary btn-add-row" type="button">+ 新增一列</button>
      <div class="mgr-block-count">0 位專員</div>
    </div>
  </div>`;
}

function readAgentRow(tr){
  return {
    email: tr.querySelector('.ag-email').value.trim().toLowerCase(),
    name: tr.querySelector('.ag-name').value.trim(),
    fullSkill: tr.querySelector('.ag-full').checked,
    bbt: tr.querySelector('.ag-bbt').checked,
    halfDay: tr.querySelector('.ag-half').checked,
    countedInScore: tr.querySelector('.ag-counted').checked
  };
}
function getBlocksFromDOM(){
  return Array.from(document.querySelectorAll('#roster-blocks .mgr-block')).map(el=>({
    managerEmail: el.querySelector('.mgr-email').value.trim(),
    managerShort: el.querySelector('.mgr-short').value.trim(),
    batch: el.querySelector('.mgr-batch').value.trim(),
    agents: Array.from(el.querySelectorAll('.agent-tbody tr')).map(readAgentRow).filter(a=>a.email)
  }));
}
function blockCounts(b){ return (b.agents||[]).length; }

function renderBlocks(blocks){
  const container = document.getElementById('roster-blocks');
  container.innerHTML = blocks.map(migrateBlock).map(blockHTML).join('');
  container.querySelectorAll('.mgr-block').forEach(el=> bindBlockEvents(el));
  updateSummary();
}

function addAgentRowToBlock(el, agentData){
  const tbody = el.querySelector('.agent-tbody');
  const wrap = document.createElement('tbody');
  wrap.innerHTML = agentRowHTML(agentData);
  const row = wrap.firstElementChild;
  tbody.appendChild(row);
  bindRowEvents(el, row);
}
function bindRowEvents(el, row){
  row.querySelector('.btn-row-del').onclick = ()=>{ row.remove(); updateBlockCount(el); updateSummary(); };
  row.querySelectorAll('input').forEach(inp=> inp.addEventListener('input', ()=>{ updateBlockCount(el); updateSummary(); }));
  row.querySelectorAll('input[type=checkbox]').forEach(inp=> inp.addEventListener('change', updateSummary));
}
function bindBlockEvents(el){
  updateBlockCount(el);
  el.querySelectorAll('.agent-tbody tr').forEach(row=> bindRowEvents(el, row));
  el.querySelector('.mgr-email').addEventListener('input', updateSummary);
  el.querySelector('.mgr-short').addEventListener('input', updateSummary);

  const colClassMap = {full:'ag-full', bbt:'ag-bbt', half:'ag-half', counted:'ag-counted'};
  el.querySelectorAll('.ag-selectall').forEach(selAll=>{
    selAll.addEventListener('change', ()=>{
      const rowClass = colClassMap[selAll.dataset.col];
      el.querySelectorAll('.agent-tbody .' + rowClass).forEach(cb=>{ cb.checked = selAll.checked; });
      updateSummary();
    });
  });

  el.querySelector('.btn-add-row').onclick = ()=>{
    addAgentRowToBlock(el, defaultAgent('',''));
    updateBlockCount(el);
  };
  el.querySelector('.btn-quick-add').onclick = ()=>{
    const emails = linesOf(el.querySelector('.mgr-quick-emails').value);
    const names = linesOf(el.querySelector('.mgr-quick-names').value);
    emails.forEach((e,i)=> addAgentRowToBlock(el, defaultAgent(e, names[i]||'')));
    el.querySelector('.mgr-quick-emails').value = '';
    el.querySelector('.mgr-quick-names').value = '';
    updateBlockCount(el);
    updateSummary();
  };
  el.querySelector('.btn-copy').onclick = ()=>{
    const data = {
      managerEmail: el.querySelector('.mgr-email').value.trim(),
      managerShort: el.querySelector('.mgr-short').value.trim(),
      batch: el.querySelector('.mgr-batch').value.trim(),
      agents: Array.from(el.querySelectorAll('.agent-tbody tr')).map(readAgentRow)
    };
    const newEl = document.createElement('div');
    newEl.innerHTML = blockHTML(data);
    const clone = newEl.firstElementChild;
    el.after(clone);
    bindBlockEvents(clone);
    updateSummary();
  };
  el.querySelector('.btn-del').onclick = ()=>{
    const container = document.getElementById('roster-blocks');
    if(container.querySelectorAll('.mgr-block').length<=1){ alert('至少要保留一個區塊'); return; }
    el.remove();
    updateSummary();
  };
}
function updateBlockCount(el){
  const n = el.querySelectorAll('.agent-tbody tr').length;
  el.querySelector('.mgr-block-count').textContent = n + ' 位專員';
}
function updateSummary(){
  const blocks = getBlocksFromDOM();
  const mgrCount = blocks.filter(b=>b.managerEmail).length;
  const agentCount = blocks.reduce((sum,b)=> sum + blockCounts(b), 0);
  document.getElementById('blocks-summary').textContent = `${mgrCount} 位主管 / ${agentCount} 位專員（尚未儲存）`;
}
function buildRosterAndManagers(blocks){
  const roster = [];
  const managers = {};
  blocks.forEach(b=>{
    const mgrEmail = (b.managerEmail||'').toLowerCase();
    if(mgrEmail) managers[mgrEmail] = b.managerShort || mgrEmail;
    (b.agents||[]).forEach(a=>{
      if(!a.email) return;
      roster.push({
        email:a.email.toLowerCase(), name:a.name||'', manager:mgrEmail, batch:b.batch||'',
        fullSkill: a.fullSkill!==false, bbt: !!a.bbt, halfDay: !!a.halfDay,
        countedInScore: a.countedInScore!==false
      });
    });
  });
  return {roster, managers};
}
document.getElementById('btn-add-block').onclick = ()=>{
  const el = document.getElementById('roster-blocks');
  const wrap = document.createElement('div');
  wrap.innerHTML = blockHTML(defaultBlock());
  const block = wrap.firstElementChild;
  el.appendChild(block);
  bindBlockEvents(block);
  updateSummary();
};
document.getElementById('btn-save-blocks').onclick = async ()=>{
  const blocks = getBlocksFromDOM();
  await storageSet('roster_blocks', JSON.stringify(blocks));
  const {roster, managers} = buildRosterAndManagers(blocks);
  state.roster = roster;
  state.managers = managers;
  document.getElementById('blocks-summary').textContent = `${Object.keys(managers).length} 位主管 / ${roster.length} 位專員`;
  alert('已儲存（' + roster.length + ' 位專員）');
};
async function loadSavedBlocks(){
  const saved = await storageGet('roster_blocks');
  let blocks = null;
  try{ blocks = saved ? JSON.parse(saved) : null; }catch(e){}
  if(!blocks || !blocks.length) blocks = [defaultBlock()];
  blocks = blocks.map(migrateBlock);
  renderBlocks(blocks);
  const {roster, managers} = buildRosterAndManagers(blocks);
  state.roster = roster;
  state.managers = managers;
  document.getElementById('blocks-summary').textContent = `${Object.keys(managers).length} 位主管 / ${roster.length} 位專員`;
}
loadSavedBlocks();

/* ============ 名單匯出 / 匯入 ============ */
function normalizeAgent(a){
  return {
    email: String(a && a.email || '').trim().toLowerCase(),
    name: String(a && a.name || '').trim(),
    fullSkill: a ? a.fullSkill !== false : true,
    bbt: !!(a && a.bbt),
    halfDay: !!(a && a.halfDay),
    countedInScore: a ? a.countedInScore !== false : true
  };
}
function normalizeBlock(b){
  const m = migrateBlock(b || {});
  return {
    managerEmail: String(m.managerEmail || '').trim(),
    managerShort: String(m.managerShort || '').trim(),
    batch: String(m.batch || '').trim(),
    agents: (m.agents || []).map(normalizeAgent).filter(a => a.email)
  };
}

document.getElementById('btn-export-roster').onclick = ()=>{
  const blocks = getBlocksFromDOM();
  if(!blocks.length || !blocks.some(b=>b.agents.length)){
    alert('目前名單是空的，沒有東西可以匯出。');
    return;
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    blocks: blocks
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `專員名單_${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
};

document.getElementById('btn-import-roster-trigger').onclick = ()=>{
  document.getElementById('roster-import-input').click();
};
document.getElementById('roster-import-input').addEventListener('change', function(e){
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  const reader = new FileReader();
  reader.onload = (ev)=>{
    let raw;
    try{
      raw = JSON.parse(ev.target.result);
    }catch(err){
      alert('匯入失敗：不是有效的 JSON 檔案。');
      return;
    }
    // 相容兩種格式：{blocks:[...]} 或直接是 [...] 陣列
    const rawBlocks = Array.isArray(raw) ? raw : raw.blocks;
    if(!Array.isArray(rawBlocks)){
      alert('匯入失敗：檔案格式不符合預期（找不到 blocks 陣列）。');
      return;
    }
    let blocks;
    try{
      blocks = rawBlocks.map(normalizeBlock).filter(b=> b.managerEmail || b.agents.length);
    }catch(err){
      alert('匯入失敗：內容格式有誤（' + err.message + '）。');
      return;
    }
    if(!blocks.length){
      alert('匯入失敗：檔案裡沒有有效的主管/專員資料。');
      return;
    }

    const doReplace = confirm(
      `即將匯入 ${blocks.length} 個主管區塊、共 ${blocks.reduce((s,b)=>s+b.agents.length,0)} 位專員。\n\n` +
      `按「確定」= 取代目前名單\n按「取消」= 附加到目前名單後面（保留現有的）`
    );

    let finalBlocks;
    if(doReplace){
      finalBlocks = blocks;
    } else {
      const current = getBlocksFromDOM();
      finalBlocks = current.concat(blocks);
    }
    renderBlocks(finalBlocks);
    alert('匯入完成，別忘了按「儲存全部」才會真的存起來。');
  };
  reader.readAsText(file, 'utf-8');
});

/* ============ 計算工具函式 ============ */
function toDate(v){
  if(v instanceof Date) return v;
  if(typeof v === 'number'){
    const epoch = new Date(Date.UTC(1899,11,30));
    return new Date(epoch.getTime() + v*86400000);
  }
  if(typeof v === 'string' && v.trim()){
    const s = v.trim().replace(' ', 'T');
    let d = new Date(s);
    if(!isNaN(d)) return d;
    d = new Date(v);
    if(!isNaN(d)) return d;
  }
  return null;
}
function secBetween(a,b){
  const da=toDate(a), db=toDate(b);
  if(!da||!db) return null;
  const s = (db-da)/1000;
  return s>=0 ? s : null;
}
function dateOnly(v){
  const d = toDate(v);
  if(!d) return null;
  return d.getFullYear()+'-'+(d.getMonth()+1)+'-'+d.getDate();
}
function secToHMS(sec){
  if(sec===null || sec===undefined || isNaN(sec)) return '0:00:00';
  sec = Math.round(sec);
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function pct(n,d){ if(!d) return '-'; return (n/d*100).toFixed(1)+'%'; }
function isYes(v){ return String(v).trim().toLowerCase()==='yes' || String(v).trim()==='是'; }

/* ============ 主計算 ============ */
// ============================================================
// buildRawAgentStats()：核心原始數據層。
// 讀四份明細檔 + 名單設定，算出每位專員的「原始數字」（不做格式化，
// 例如 icCount 是數字 0 而不是字串 '-'）。computeReport()（日終報表）
// 跟之後的即時產能報表都共用這份，只是各自再做不同的格式化/分組。
// ============================================================
// ---- Status Log 子狀態對照表（全域，計算引擎與篩選檢視共用）----
const SUBMAP = {
  'online for internet call':'on_ic',
  'online for chat':'on_chat',
  'online for call':'on_call',
  'online for case':'on_case',
  'busy with wrapup':'busy_wrapup',
  'busy with training':'busy_training',
  'busy with meeting':'busy_meeting',
  'busy with coaching':'busy_coaching',
  'busy with escalation':'busy_escalation',
  'busy with outbound':'busy_outbound',
  'away for short break':'away_break',
  'away for meal':'away_meal',
  'away for consult':'away_consult',
  'away for personal break':'away_personal',
  'offline':'offline'
};

// 判斷一筆 Status Log 原始資料，這次計算「有沒有」被納入，以及原因。
// computeReport()/buildRawAgentStats() 跟 Status Log 篩選檢視都呼叫這支，
// 確保兩邊的排除規則永遠是同一套，不會各寫一套邏輯導致對不上。
function classifyStatusRow(row, stMap){
  const sub = String(row[stMap.sub_status]||'').toLowerCase().trim();
  let code = SUBMAP[sub];
  if(!code){
    const parts = sub.split(',').map(s=>s.trim()).filter(Boolean);
    if(parts.length===2 && parts.includes('online for internet call') && parts.includes('online for chat')){
      code = 'on_ic_chat_dual';
    }
  }
  if(!code) return {included:false, code:null, reason:'狀態值無法辨識'};

  const startV = row[stMap.start_datetime], endV = row[stMap.end_datetime];
  const endDate = toDate(endV);
  if(!endDate || endDate.getFullYear() <= 1899) return {included:false, code, reason:'Status End Time = 0（無效值）'};

  const sd = dateOnly(startV), ed = dateOnly(endV);
  if(sd && ed && sd !== ed) return {included:false, code, reason:'跨日資料'};

  return {included:true, code, reason:''};
}


function buildRawAgentStats(){
  const warnings = [];
  if(!state.roster.length){ warnings.push('尚未設定專員名單，將以資料中出現過的 Email 作為基準列出。'); }
  ['ic','chat','status','hourly','iact'].forEach(k=>{
    REQ[k].forEach(([key,label])=>{
      if(state[k].rows.length && !state[k].map[key]){
        warnings.push(`【${k.toUpperCase()}】「${label}」尚未對應欄位，相關計算將以 - 或 0 呈現。`);
      }
    });
  });

  const icMap = state.ic.map, chatMap = state.chat.map, stMap = state.status.map, hrMap = state.hourly.map, iactMap = state.iact.map;

  let emails;
  if(state.roster.length){
    emails = state.roster.map(r=>r.email);
  } else {
    const set = new Set();
    state.ic.rows.forEach(r=>{ const e=r[icMap.last_agent_email]; if(e) set.add(String(e).toLowerCase()); });
    state.chat.rows.forEach(r=>{ const e=r[chatMap.chat_owner]; if(e) set.add(String(e).toLowerCase()); });
    state.status.rows.forEach(r=>{ const e=r[stMap.email]; if(e) set.add(String(e).toLowerCase()); });
    emails = Array.from(set);
  }
  const rosterInfo = {};
  state.roster.forEach(r=> rosterInfo[r.email] = r);

  // ---- IACT：依 Agent Email 計算筆數，排除 Channel Type = Internet Call（該渠道另外有 IC 明細表計算）----
  const iactCountByEmail = {};
  state.iact.rows.forEach(r=>{
    const e = String(r[iactMap.email]||'').toLowerCase().trim();
    if(!e) return;
    const channel = String(r[iactMap.channel_type]||'').trim().toLowerCase();
    if(channel === 'internet call') return;
    iactCountByEmail[e] = (iactCountByEmail[e]||0) + 1;
  });

  // ---- Hourly Activity：依 Agent Email 加總 Call Outbound(in number) ----
  const outboundCountByEmail = {};
  state.hourly.rows.forEach(r=>{
    const e = String(r[hrMap.email]||'').toLowerCase().trim();
    if(!e) return;
    const v = Number(r[hrMap.call_outbound]);
    if(isNaN(v)) return;
    outboundCountByEmail[e] = (outboundCountByEmail[e]||0) + v;
  });

  function baseAgent(e){
    const ri = rosterInfo[e] || {};
    const mgrShort = state.managers[ri.manager] || ri.manager || '(未設定)';
    return {
      email:e, name:ri.name||'', batch:ri.batch||'', manager:mgrShort, managerEmail: ri.manager||'',
      fullSkill: ri.fullSkill!==false, bbt: !!ri.bbt, halfDay: !!ri.halfDay,
      countedInScore: ri.countedInScore!==false,
      icCount:0, icAnswered:0, acdSum:0, acdCount:0, icGood:0, icBad:0, icAvg:0,
      chatCount:0, chatGood:0, chatBad:0, chatAvg:0,
      status:{}
    };
  }
  const agents = {};
  emails.forEach(e=> agents[e] = baseAgent(e));
  function ensure(e){ if(!agents[e]) agents[e] = baseAgent(e); return agents[e]; }

  // ---- IC ----
  // Call Status = Missed 的整筆不計入通數/產能（不算已接聽，也不影響ACD/CSAT）
  state.ic.rows.forEach(r=>{
    const e = String(r[icMap.last_agent_email]||'').toLowerCase().trim();
    if(!e) return;
    const callStatus = String(r[icMap.call_status]||'').trim().toLowerCase();
    if(callStatus === 'missed') return;
    const a = ensure(e);
    a.icCount++;
    if(isYes(r[icMap.is_answered])){
      a.icAnswered++;
      const dur = secBetween(r[icMap.last_routed_time], r[icMap.call_end_time]);
      if(dur!==null){ a.acdSum += dur; a.acdCount++; }
    }
    const csat = String(r[icMap.csat]||'').trim();
    if(/good/i.test(csat)) a.icGood++;
    else if(/bad/i.test(csat)) a.icBad++;
    else if(/average|avg/i.test(csat)) a.icAvg++;
  });

  // ---- Chat ----
  // 滿意度 = Chat Good CSAT / (Chat Good CSAT + Chat Bad CSAT)
  // Good/Bad 定義：Chat Data 表中「CSAT Level」欄位完全等於 Good / Bad（不分大小寫，去除前後空白）
  state.chat.rows.forEach(r=>{
    const e = String(r[chatMap.chat_owner]||'').toLowerCase().trim();
    if(!e) return;
    const a = ensure(e);
    a.chatCount++;
    const csat = String(r[chatMap.csat]||'').trim().toLowerCase();
    if(csat === 'good') a.chatGood++;
    else if(csat === 'bad') a.chatBad++;
    else if(csat === 'average' || csat === 'avg') a.chatAvg++;
  });

  state.status.rows.forEach(r=>{
    const e = String(r[stMap.email]||'').toLowerCase().trim();
    if(!e) return;
    const a = ensure(e);
    const cls = classifyStatusRow(r, stMap);
    if(!cls.included) return;
    const code = cls.code;
    const startV = r[stMap.start_datetime], endV = r[stMap.end_datetime];
    const dur = secBetween(startV, endV);
    if(!a.status[code]) a.status[code] = {sec:0, count:0};
    if(dur !== null) a.status[code].sec += dur;
    a.status[code].count++;
  });

  // 補上外撥通數（來自 Hourly Activity）、IACT產能，跟 status 累計放在同一個 agent 物件方便取用
  emails.forEach(e=>{
    agents[e].busyOutCount = outboundCountByEmail[e] || 0;
    agents[e].iactCount = iactCountByEmail[e] || 0;
  });

  return {agents, emails, warnings};
}

function computeReport(){
  const {agents, emails, warnings} = buildRawAgentStats();

  const rows = emails.map(e=>{
    const a = agents[e];
    const st = a.status;
    const g = (code)=> (st[code]?st[code].sec:0);
    const cnt = (code)=> (st[code]?st[code].count:0);

    // ACW：只算 online for case（Wrap-up是「線上值機切換前緩衝」，跟處理案件本身無關，不列入）
    // 分母改成 Call通數+Chat產能（文書時間不管是接電話還是聊Chat都可能產生，兩種產能都要算進去）
    const acwSec = g('on_case');
    const totalProduction = (a.icCount||0) + (a.chatCount||0);
    const acw = totalProduction ? acwSec / totalProduction : null;
    const acd = a.acdCount ? a.acdSum/a.acdCount : null;
    const aht = (acd!==null && acw!==null) ? acd+acw : null;

    const onIC=g('on_ic'), onChat=g('on_chat'), onICChat=g('on_ic_chat_dual'), onCall=g('on_call'), onCase=g('on_case');
    const busyWrap=g('busy_wrapup'), busyTrain=g('busy_training'), busyMeet=g('busy_meeting'),
          busyCoach=g('busy_coaching'), busyEsc=g('busy_escalation'), busyOut=g('busy_outbound');
    const awayBreak=g('away_break'), awayMeal=g('away_meal'), awayBreakMeal=awayBreak+awayMeal,
          awayConsult=g('away_consult'), awayPersonal=g('away_personal');
    const offlineSec = g('offline'), offlineCount = cnt('offline');
    const busyOutCount = a.busyOutCount || 0;

    const totalA = onIC+onChat+onICChat+onCall+onCase+busyWrap+busyOut;
    const totalB = onIC+onChat+onICChat+onCall+onCase
        + busyWrap+busyTrain+busyMeet+busyCoach+busyEsc+busyOut
        + awayBreak+awayMeal+awayConsult+awayPersonal;

    return {
      email:a.email, name:a.name||a.email, batch:a.batch, manager:a.manager,
      icCount: a.icCount||'-',
      acd: a.icCount ? secToHMS(acd) : '-',
      acw: totalProduction ? (acw!==null?secToHMS(acw):'-') : '-',
      aht: a.icCount ? (aht!==null?secToHMS(aht):'-') : '-',
      icCsat: (a.icGood+a.icBad) ? pct(a.icGood, a.icGood+a.icBad) : '-',
      icCsatRate: a.icCount ? pct(a.icGood+a.icBad, a.icCount) : '-',

      chatCount: a.chatCount||'-',
      chatAht:'-',
      chatCsat: (a.chatGood+a.chatBad) ? pct(a.chatGood, a.chatGood+a.chatBad) : '-',

      onIC:secToHMS(onIC), onChat:secToHMS(onChat), onICChat:secToHMS(onICChat), onCall:secToHMS(onCall), onCase:secToHMS(onCase),
      busyWrap:secToHMS(busyWrap), busyTrain:secToHMS(busyTrain), busyMeet:secToHMS(busyMeet),
      busyCoach:secToHMS(busyCoach), busyEsc:secToHMS(busyEsc), busyOut:secToHMS(busyOut), busyOutCount:busyOutCount,
      awayBreak:secToHMS(awayBreak), awayMeal:secToHMS(awayMeal), awayBreakMeal:secToHMS(awayBreakMeal),
      awayConsult:secToHMS(awayConsult), awayPersonal:secToHMS(awayPersonal),
      offlineTime:secToHMS(offlineSec), offlineCount:offlineCount,
      totalA:secToHMS(totalA), totalB:secToHMS(totalB)
    };
  });

  return {rows, warnings};
}
