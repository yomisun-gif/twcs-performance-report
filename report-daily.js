/* ============================================================
   report-daily.js — 報表樣板：目前唯一的「每日績效報表」樣板
   吃 computeReport() 產出的 rows，定義欄位(COLS)、渲染表格、匯出Excel/HTML。
   以後要加新報表樣板，複製一份改名（例如 report-summary.js），
   不用動這支檔案，也不用動 engine.js。
   ============================================================ */

/* ============ 報表渲染 ============ */
const COLS = [
  {k:'icCount',l:'產能',blk:'ic'}, {k:'aht',l:'AHT',blk:'ic'}, {k:'acd',l:'ACD',blk:'ic'}, {k:'acw',l:'ACW',blk:'ic'},
  {k:'icCsat',l:'滿意度',blk:'ic'}, {k:'icCsatRate',l:'回收率',blk:'ic'},

  {k:'chatCount',l:'產能',blk:'chat'}, {k:'chatAht',l:'AHT',blk:'chat'}, {k:'chatCsat',l:'滿意度',blk:'chat'},

  {k:'onIC',l:'網路電話',blk:'online'}, {k:'onChat',l:'即時客服',blk:'online'}, {k:'onICChat',l:'雙渠道',blk:'online'},
  {k:'onCall',l:'電話',blk:'online'}, {k:'onCase',l:'文書',blk:'online'},

  {k:'busyWrap',l:'話後',blk:'busy'}, {k:'busyTrain',l:'訓練',blk:'busy'}, {k:'busyMeet',l:'會議',blk:'busy'},
  {k:'busyCoach',l:'輔導',blk:'busy'}, {k:'busyEsc',l:'轉單諮詢',blk:'busy'}, {k:'busyOut',l:'外撥',blk:'busy'}, {k:'busyOutCount',l:'外撥(通數)',blk:'busy'},

  {k:'awayBreak',l:'休息',blk:'away'}, {k:'awayMeal',l:'用餐',blk:'away'}, {k:'awayBreakMeal',l:'休息+用餐',blk:'away'},
  {k:'awayConsult',l:'諮詢',blk:'away'}, {k:'awayPersonal',l:'其他',blk:'away'},

  {k:'offlineTime',l:'離線(時間)',blk:'offline'}, {k:'offlineCount',l:'離線(次數)',blk:'offline'},

  {k:'totalA',l:'Online Busy',blk:'total'}, {k:'totalB',l:'Online Busy Away',blk:'total'}
];
const BLK_LABEL = {ic:'Call', chat:'Chat', online:'線上 Online', busy:'忙碌 Busy', away:'離開 Away', offline:'離線 Offline', total:'合計'};

function renderTable(rows){
  const tbl = document.getElementById('report-table');
  let blkSeq = [], last=null;
  COLS.forEach(c=>{
    if(c.blk===last){ blkSeq[blkSeq.length-1].span++; }
    else { last=c.blk; blkSeq.push({blk:c.blk, span:1}); }
  });
  let h1 = `<tr>
    <th class="idcol id1" rowspan="2">組別</th>
    <th class="idcol id2" rowspan="2">Batch</th>
    <th class="idcol id3" rowspan="2">日期</th>
    <th class="idcol id4" rowspan="2">Agent</th>`;
  blkSeq.forEach(b=> h1 += `<th class="blk-${b.blk}" colspan="${b.span}">${BLK_LABEL[b.blk]}</th>`);
  h1 += '</tr>';
  let h2 = '<tr>';
  COLS.forEach(c=> h2 += `<th class="blk-${c.blk}">${c.l}</th>`);
  h2 += '</tr>';

  const dateStr = document.getElementById('report-date').value || '';
  let body = '';
  let i = 0;
  while(i < rows.length){
    let j = i;
    while(j < rows.length && rows[j].manager === rows[i].manager && rows[j].batch === rows[i].batch) j++;
    const runLen = j - i;
    for(let k = i; k < j; k++){
      const r = rows[k];
      body += '<tr>';
      if(k === i){
        body += `<td class="idcol id1" rowspan="${runLen}">${r.manager}</td>`;
        body += `<td class="idcol id2" rowspan="${runLen}">${r.batch||'-'}</td>`;
      }
      body += `<td class="idcol id3">${dateStr||'-'}</td>`;
      body += `<td class="idcol id4">${r.name}</td>`;
      COLS.forEach(c=> body += `<td class="blk-${c.blk}">${r[c.k]}</td>`);
      body += '</tr>';
    }
    i = j;
  }
  tbl.innerHTML = `<thead>${h1}${h2}</thead><tbody>${body}</tbody>`;
}

function fixStickyOffsets(){
  const tbl = document.getElementById('report-table');
  const c1 = tbl.querySelector('.id1');
  const c2 = tbl.querySelector('.id2');
  const c3 = tbl.querySelector('.id3');
  if(!c1 || !c2 || !c3) return;
  const w1 = c1.getBoundingClientRect().width;
  const w2 = c2.getBoundingClientRect().width;
  const w3 = c3.getBoundingClientRect().width;
  tbl.querySelectorAll('.id1').forEach(el=> el.style.left = '0px');
  tbl.querySelectorAll('.id2').forEach(el=> el.style.left = w1 + 'px');
  tbl.querySelectorAll('.id3').forEach(el=> el.style.left = (w1+w2) + 'px');
  tbl.querySelectorAll('.id4').forEach(el=> el.style.left = (w1+w2+w3) + 'px');
}

let lastRows = [];
document.getElementById('btn-generate').onclick = ()=>{
  const blocks = getBlocksFromDOM();
  const built = buildRosterAndManagers(blocks);
  state.roster = built.roster;
  state.managers = built.managers;
  const {rows, warnings} = computeReport();
  lastRows = rows;
  renderTable(rows);
  fixStickyOffsets();
  const wbox = document.getElementById('warnings');
  wbox.innerHTML = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
  document.getElementById('gen-status').textContent = `已產出 ${rows.length} 位專員資料`;
};
window.addEventListener('resize', ()=>{ if(lastRows.length) fixStickyOffsets(); });

// 依區塊交界（Call→Chat、Chat→Online）自動插入空白欄，比照目的地報表排版
function buildExportColumns(){
  const cols = [];
  let prevBlk = null;
  COLS.forEach(c=>{
    if((prevBlk==='ic' && c.blk==='chat') || (prevBlk==='chat' && c.blk==='online')){
      cols.push(null); // null 代表空白分隔欄
    }
    cols.push(c);
    prevBlk = c.blk;
  });
  return cols;
}

document.getElementById('btn-export-xlsx').onclick = ()=>{
  if(!lastRows.length){ alert('請先產出報表'); return; }
  const dateStr = document.getElementById('report-date').value || new Date().toISOString().slice(0,10);
  const exportCols = buildExportColumns();
  const header1 = ['Agent'].concat(exportCols.map(c=> c ? BLK_LABEL[c.blk] : ''));
  const header2 = [''].concat(exportCols.map(c=> c ? c.l : ''));
  const data = [header1, header2];
  lastRows.forEach(r=>{
    data.push([r.name].concat(exportCols.map(c=> c ? r[c.k] : '')));
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '每日績效報表');
  XLSX.writeFile(wb, `TW客服每日績效報表_${dateStr}.xlsx`);
};

document.getElementById('btn-export-html').onclick = ()=>{
  const dateStr = document.getElementById('report-date').value || new Date().toISOString().slice(0,10);
  const blob = new Blob(['<!DOCTYPE html><meta charset="utf-8"><title>報表</title>'+document.getElementById('report-table').outerHTML], {type:'text/html'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `TW客服每日績效報表_${dateStr}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
};

/* ============ Status Log 篩選檢視 ============ */
function formatRawCell(v){
  if(v instanceof Date){
    const p2 = n=>String(n).padStart(2,'0');
    return `${v.getFullYear()}-${p2(v.getMonth()+1)}-${p2(v.getDate())} ${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`;
  }
  return (v===null || v===undefined || v==='') ? '-' : v;
}

function populateSubStatusOptions(){
  const sel = document.getElementById('statuslog-filter-substatus');
  const stMap = state.status.map;
  if(!stMap.sub_status || !state.status.rows.length) return;
  const current = sel.value;
  const values = Array.from(new Set(
    state.status.rows.map(r=> String(r[stMap.sub_status]||'').trim()).filter(Boolean)
  )).sort();
  sel.innerHTML = '<option value="">全部 Sub Status</option>' +
    values.map(v=>`<option value="${v}">${v}</option>`).join('');
  if(values.includes(current)) sel.value = current;
}

// 用③專員名單裡的資料，讓搜尋框可以打姓名（自動建議 + 模糊比對）
function populateAgentSuggestions(){
  const dl = document.getElementById('statuslog-agent-suggestions');
  if(!dl || !state.roster.length) return;
  dl.innerHTML = state.roster.map(r=>
    `<option value="${r.email}">${r.name || r.email}</option>`
  ).join('');
}

// Sub Status 依所屬分類（線上/忙碌/離開/離線）套色，顏色可由使用者自訂並記住
const SL_COLOR_DEFAULTS = {online:'#F7F0E3', busy:'#F4F1F9', away:'#F9F0F5', offline:'#EEEFF1'};
let slColors = Object.assign({}, SL_COLOR_DEFAULTS);

function subStatusCategory(sub){
  const s = String(sub||'').toLowerCase().trim();
  let code = SUBMAP[s];
  if(!code){
    const parts = s.split(',').map(x=>x.trim()).filter(Boolean);
    if(parts.length===2 && parts.includes('online for internet call') && parts.includes('online for chat')) code = 'on_ic_chat_dual';
  }
  if(!code) return null;
  if(code.indexOf('on_')===0) return 'online';
  if(code.indexOf('busy_')===0) return 'busy';
  if(code.indexOf('away_')===0) return 'away';
  if(code==='offline') return 'offline';
  return null;
}

async function loadSlColors(){
  const saved = await storageGet('sl_sub_colors');
  if(saved){
    try{ slColors = Object.assign({}, SL_COLOR_DEFAULTS, JSON.parse(saved)); }catch(e){}
  }
  document.getElementById('sl-color-online').value = slColors.online;
  document.getElementById('sl-color-busy').value = slColors.busy;
  document.getElementById('sl-color-away').value = slColors.away;
  document.getElementById('sl-color-offline').value = slColors.offline;
}
loadSlColors();

['online','busy','away','offline'].forEach(key=>{
  document.getElementById('sl-color-'+key).addEventListener('input', async (e)=>{
    slColors[key] = e.target.value;
    await storageSet('sl_sub_colors', JSON.stringify(slColors));
    if(state.status.rows.length) document.getElementById('btn-filter-statuslog').click();
  });
});
document.getElementById('btn-reset-sl-colors').onclick = async ()=>{
  slColors = Object.assign({}, SL_COLOR_DEFAULTS);
  await storageSet('sl_sub_colors', JSON.stringify(slColors));
  document.getElementById('sl-color-online').value = slColors.online;
  document.getElementById('sl-color-busy').value = slColors.busy;
  document.getElementById('sl-color-away').value = slColors.away;
  document.getElementById('sl-color-offline').value = slColors.offline;
  if(state.status.rows.length) document.getElementById('btn-filter-statuslog').click();
};

document.getElementById('btn-filter-statuslog').onclick = ()=>{
  const countEl = document.getElementById('statuslog-filter-count');
  const tbl = document.getElementById('statuslog-filter-table');
  const stMap = state.status.map;

  if(!state.status.rows.length){
    tbl.innerHTML = '';
    countEl.textContent = '尚未上傳 Status Log 明細';
    return;
  }
  if(!stMap.email || !stMap.sub_status || !stMap.start_datetime || !stMap.end_datetime){
    tbl.innerHTML = '';
    countEl.textContent = '請先到②欄位對應完成 Status Log 的欄位設定';
    return;
  }

  populateSubStatusOptions();
  populateAgentSuggestions();

  // Email 或姓名皆可搜尋：先查③名單找出符合姓名的 Email，再跟 Email 本身模糊比對一起用
  const rawFilter = document.getElementById('statuslog-filter-email').value.trim().toLowerCase();
  const subFilter = document.getElementById('statuslog-filter-substatus').value;

  const matchedEmailsByName = rawFilter
    ? new Set(state.roster.filter(r=> (r.name||'').toLowerCase().includes(rawFilter)).map(r=>r.email))
    : null;

  const filtered = state.status.rows.filter(r=>{
    const email = String(r[stMap.email]||'').toLowerCase().trim();
    const sub = String(r[stMap.sub_status]||'').trim();
    if(rawFilter){
      const emailMatches = email.includes(rawFilter);
      const nameMatches = matchedEmailsByName && matchedEmailsByName.has(email);
      if(!emailMatches && !nameMatches) return false;
    }
    if(subFilter && sub !== subFilter) return false;
    return true;
  });

  const bodyRows = filtered.map(r=>{
    const cls = classifyStatusRow(r, stMap);
    const startCellClass = cls.included ? 'cell-included' : 'cell-alert';
    const cat = subStatusCategory(r[stMap.sub_status]);
    const subStyle = cat ? ` style="background:${slColors[cat]};"` : '';
    const dur = secBetween(r[stMap.start_datetime], r[stMap.end_datetime]);
    const durText = dur !== null ? secToHMS(dur) : '-';
    const reasonText = cls.included ? '✅ 已計入計算' : `❌ ${cls.reason}`;
    return `<tr>
      <td>${r[stMap.email]||'-'}</td>
      <td${subStyle}>${r[stMap.sub_status]||'-'}</td>
      <td class="${startCellClass}">${formatRawCell(r[stMap.start_datetime])}</td>
      <td class="${startCellClass}">${formatRawCell(r[stMap.end_datetime])}</td>
      <td>${durText}</td>
      <td class="sl-reason">${reasonText}</td>
    </tr>`;
  }).join('');

  tbl.innerHTML = `<thead><tr>
      <th>Email</th><th>Sub Status</th><th>Status Start Time</th><th>Status End Time</th><th>持續時間</th><th>計算狀態</th>
    </tr></thead>
    <tbody>${bodyRows || '<tr><td colspan="6" class="rt-empty-note">沒有符合篩選條件的資料</td></tr>'}</tbody>`;

  countEl.textContent = `共 ${filtered.length} 筆（已計入 ${filtered.filter(r=>classifyStatusRow(r,stMap).included).length} 筆）`;
};

// Status Log 上傳完成後，順便先把 Sub Status 選單填好，不用等按篩選才看得到選項
document.getElementById('file-status').addEventListener('change', ()=> setTimeout(populateSubStatusOptions, 300));
document.getElementById('dropzone-input').addEventListener('change', ()=> setTimeout(populateSubStatusOptions, 300));
document.getElementById('dropzone').addEventListener('drop', ()=> setTimeout(populateSubStatusOptions, 300));
