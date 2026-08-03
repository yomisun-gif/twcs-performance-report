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
  roster: [],
  managers: {} // email(lower) -> 簡稱
};

const REQ = {
  ic: [
    ['last_agent_email','Last Agent Email（最後接聽專員 Email，決定通數/AHT/ACD歸屬）'],
    ['call_end_time','Call End Time（通話結束時間）'],
    ['last_routed_time','Last Routed to Agent Time（最後轉派至專員時間）'],
    ['is_answered','Is Answered（是否接聽，值需含 Yes/No）'],
    ['csat','CSAT（值為 Good/Bad/Average/- 等評價文字）']
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
  call_outbound:['call outbound','outbound']
};

/* ============ Tabs ============ */
function switchTab(name){
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.panel').forEach(x=>x.classList.remove('active'));
  document.querySelector(`.tab[data-tab="${name}"]`).classList.add('active');
  document.getElementById('panel-'+name).classList.add('active');
}
document.querySelectorAll('.tab').forEach(t=>{ t.onclick = ()=> switchTab(t.dataset.tab); });
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
  const h = headers.map(x=>String(x).toLowerCase());
  if(h.some(x=>x.includes('chat owner'))) return 'chat';
  if(h.some(x=>x.includes('sub status'))) return 'status';
  if(h.some(x=>x.includes('call outbound'))) return 'hourly';
  if(h.some(x=>x.includes('last agent'))) return 'ic';
  return null;
}
const SOURCE_LABEL = {ic:'Internet Call 明細', chat:'Chat 明細', status:'Status Log', hourly:'Hourly Activity(外撥通數)'};
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
['ic','chat','status','hourly'].forEach(renderMapping);

document.getElementById('btn-save-mapping').onclick = async ()=>{
  for(const key of ['ic','chat','status','hourly']){
    if(state[key].headers.length){
      await storageSet('colmap_'+key, JSON.stringify({headers:state[key].headers, map:state[key].map}));
    }
  }
  alert('欄位對應已儲存，下次上傳相同欄位結構的檔案會自動套用。');
};

/* ============ 主管 + 專員區塊 ============ */
function linesOf(text){ return (text||'').split(/\n/).map(l=>l.trim()).filter(Boolean); }
function blockCounts(b){ return linesOf(b.emailsText).length; }
function blockHTML(b){
  return `<div class="mgr-block">
    <div class="mgr-block-header">
      <input type="text" class="mgr-email" placeholder="主管信箱" value="${b.managerEmail||''}">
      <input type="text" class="mgr-short" placeholder="簡稱" value="${b.managerShort||''}">
      <input type="text" class="mgr-batch" placeholder="週次" value="${b.batch||''}">
      <span class="spacer"></span>
      <button class="secondary btn-copy" type="button">複製此區塊</button>
      <button class="secondary btn-del" type="button">刪除</button>
    </div>
    <div class="mgr-split">
      <div class="mgr-col">
        <label class="mgr-col-label">Email（每行一位）</label>
        <textarea class="mgr-emails" placeholder="dawn.kuo@shopee.com&#10;daisy.chang@shopee.com">${b.emailsText||''}</textarea>
      </div>
      <div class="mgr-col">
        <label class="mgr-col-label">英文姓名（順序需對應左邊，每行一位）</label>
        <textarea class="mgr-names" placeholder="Dawn Kuo&#10;Daisy Chang">${b.namesText||''}</textarea>
      </div>
    </div>
    <div class="mgr-mismatch-warn" style="display:none;"></div>
    <div class="mgr-block-count">0 位專員</div>
  </div>`;
}
function defaultBlock(){ return {managerEmail:'', managerShort:'', batch:'', emailsText:'', namesText:''}; }

function getBlocksFromDOM(){
  return Array.from(document.querySelectorAll('#roster-blocks .mgr-block')).map(el=>({
    managerEmail: el.querySelector('.mgr-email').value.trim(),
    managerShort: el.querySelector('.mgr-short').value.trim(),
    batch: el.querySelector('.mgr-batch').value.trim(),
    emailsText: el.querySelector('.mgr-emails').value,
    namesText: el.querySelector('.mgr-names').value
  }));
}
function renderBlocks(blocks){
  const container = document.getElementById('roster-blocks');
  container.innerHTML = blocks.map(blockHTML).join('');
  container.querySelectorAll('.mgr-block').forEach(el=> bindBlockEvents(el));
  updateSummary();
}
function bindBlockEvents(el){
  updateBlockCount(el);
  el.querySelector('.mgr-emails').addEventListener('input', ()=>{ updateBlockCount(el); updateSummary(); });
  el.querySelector('.mgr-names').addEventListener('input', ()=>{ updateBlockCount(el); updateSummary(); });
  el.querySelector('.mgr-email').addEventListener('input', updateSummary);
  el.querySelector('.mgr-short').addEventListener('input', updateSummary);
  el.querySelector('.btn-copy').onclick = ()=>{
    const data = {
      managerEmail: el.querySelector('.mgr-email').value.trim(),
      managerShort: el.querySelector('.mgr-short').value.trim(),
      batch: el.querySelector('.mgr-batch').value.trim(),
      emailsText: el.querySelector('.mgr-emails').value,
      namesText: el.querySelector('.mgr-names').value
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
  const emails = linesOf(el.querySelector('.mgr-emails').value);
  const names = linesOf(el.querySelector('.mgr-names').value);
  el.querySelector('.mgr-block-count').textContent = emails.length + ' 位專員';
  const warnEl = el.querySelector('.mgr-mismatch-warn');
  if(emails.length && names.length && emails.length !== names.length){
    warnEl.style.display = 'block';
    warnEl.textContent = `⚠️ Email ${emails.length} 行、姓名 ${names.length} 行，行數不一致，可能會對錯人，請檢查`;
  } else {
    warnEl.style.display = 'none';
  }
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
    const emails = linesOf(b.emailsText);
    const names = linesOf(b.namesText);
    emails.forEach((e,i)=>{
      roster.push({email:e.toLowerCase(), name:names[i]||'', manager:mgrEmail, batch:b.batch||''});
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
  renderBlocks(blocks);
  const {roster, managers} = buildRosterAndManagers(blocks);
  state.roster = roster;
  state.managers = managers;
  document.getElementById('blocks-summary').textContent = `${Object.keys(managers).length} 位主管 / ${roster.length} 位專員`;
}
loadSavedBlocks();

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
function computeReport(){
  const warnings = [];
  if(!state.roster.length){ warnings.push('尚未設定專員名單，將以資料中出現過的 Email 作為基準列出。'); }
  ['ic','chat','status','hourly'].forEach(k=>{
    REQ[k].forEach(([key,label])=>{
      if(state[k].rows.length && !state[k].map[key]){
        warnings.push(`【${k.toUpperCase()}】「${label}」尚未對應欄位，相關計算將以 - 或 0 呈現。`);
      }
    });
  });

  const icMap = state.ic.map, chatMap = state.chat.map, stMap = state.status.map, hrMap = state.hourly.map;

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
      email:e, name:ri.name||'', batch:ri.batch||'', manager:mgrShort,
      icCount:0, icAnswered:0, acdSum:0, acdCount:0, icGood:0, icBad:0, icAvg:0,
      chatCount:0, chatGood:0, chatBad:0, chatAvg:0,
      status:{}
    };
  }
  const agents = {};
  emails.forEach(e=> agents[e] = baseAgent(e));
  function ensure(e){ if(!agents[e]) agents[e] = baseAgent(e); return agents[e]; }

  // ---- IC ----
  state.ic.rows.forEach(r=>{
    const e = String(r[icMap.last_agent_email]||'').toLowerCase().trim();
    if(!e) return;
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

  // ---- Status Log ----
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
  state.status.rows.forEach(r=>{
    const e = String(r[stMap.email]||'').toLowerCase().trim();
    if(!e) return;
    const a = ensure(e);
    const sub = String(r[stMap.sub_status]||'').toLowerCase().trim();
    let code = SUBMAP[sub];
    if(!code){
      // 部分資料的 Sub Status 會是複合值，例如
      // "online for chat,online for internet call"，代表同時雙開兩渠道，
      // 這是獨立的第三種狀態，不等於「IC + Chat」相加，需獨立歸類
      const parts = sub.split(',').map(s=>s.trim()).filter(Boolean);
      if(parts.length===2 && parts.includes('online for internet call') && parts.includes('online for chat')){
        code = 'on_ic_chat_dual';
      }
    }
    if(!code) return;
    const startV = r[stMap.start_datetime], endV = r[stMap.end_datetime];

    // 規則1：Status End Time = 0（尚未結束/無效值）的資料不計算
    const endDate = toDate(endV);
    if(!endDate || endDate.getFullYear() <= 1899) return;

    // 規則2：跨日資料（Status Start Time 與 Status End Time 不同一天，如下班到隔天）一律不計算
    const sd = dateOnly(startV), ed = dateOnly(endV);
    if(sd && ed && sd !== ed) return;

    const dur = secBetween(startV, endV);
    if(!a.status[code]) a.status[code] = {sec:0, count:0};
    if(dur !== null) a.status[code].sec += dur;
    a.status[code].count++;
  });

  const rows = emails.map(e=>{
    const a = agents[e];
    const st = a.status;
    const g = (code)=> (st[code]?st[code].sec:0);
    const cnt = (code)=> (st[code]?st[code].count:0);

    const acwSec = g('on_case') + g('busy_wrapup');
    const acw = a.icCount ? acwSec / a.icCount : null;
    const acd = a.acdCount ? a.acdSum/a.acdCount : null;
    const aht = (acd!==null && acw!==null) ? acd+acw : null;

    const onIC=g('on_ic'), onChat=g('on_chat'), onICChat=g('on_ic_chat_dual'), onCall=g('on_call'), onCase=g('on_case');
    const busyWrap=g('busy_wrapup'), busyTrain=g('busy_training'), busyMeet=g('busy_meeting'),
          busyCoach=g('busy_coaching'), busyEsc=g('busy_escalation'), busyOut=g('busy_outbound');
    const awayBreak=g('away_break'), awayMeal=g('away_meal'), awayBreakMeal=awayBreak+awayMeal,
          awayConsult=g('away_consult'), awayPersonal=g('away_personal');
    const offlineSec = g('offline'), offlineCount = cnt('offline');
    const busyOutCount = outboundCountByEmail[e] || 0; // 改由 Hourly Activity 明細加總 Call Outbound(in number)

    const totalA = onIC+onChat+onICChat+onCall+onCase+busyWrap+busyOut;
    const totalB = onIC+onChat+onICChat+onCall+onCase
        + busyWrap+busyTrain+busyMeet+busyCoach+busyEsc+busyOut
        + awayBreak+awayMeal+awayConsult+awayPersonal;

    return {
      email:a.email, name:a.name||a.email, batch:a.batch, manager:a.manager,
      icCount: a.icCount||'-',
      acd: a.icCount ? secToHMS(acd) : '-',
      acw: a.icCount ? (acw!==null?secToHMS(acw):'-') : '-',
      aht: a.icCount ? (aht!==null?secToHMS(aht):'-') : '-',
      icCsat: (a.icGood+a.icBad) ? pct(a.icGood, a.icGood+a.icBad) : '-',
      icCsatRate: a.icCount ? pct(a.icGood+a.icBad+a.icAvg, a.icCount) : '-',

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
