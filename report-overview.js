/* ============================================================
   report-overview.js — 報表樣板：產能總覽（欄位可拖曳排序版）
   資料完全複用 computeReport()（跟④日報表同一套算法，含新版ACW）。
   排序的單位是「欄」，不是「列」：每一欄的表頭都可以拖曳調整順序
   （單欄拖，或同一區塊內連續拖幾次等於整塊搬動），也可以把任一欄
   切換成「空白」（保留位置但不顯示資料，例如Q欄）。
   這次新增：➕在任一欄後面插入新的空白欄、🗑整欄移除（不是切成
   空白，是真的消失、後面欄位往前補上）。
   組別/Batch 這裡維持跟標準檢視一樣的合併儲存格（因為拖曳的是欄
   不是列，不會互相衝突）。
   完全獨立成自己一份，不影響 report-daily.js。
   ============================================================ */

// ---- 欄位定義：每一欄一個唯一id、顯示名稱、所屬區塊(決定顏色)、怎麼從row取值 ----
function ovColumnDefs(){
  return [
    {id:'ic_count',      label:'產能',   blk:'ic',       get:r=>r.icCount, tip:'排除 Call Status=Missed 後的通數（依 Last Agent Email 分組計數）'},
    {id:'ic_aht',        label:'AHT',    blk:'ic',       get:r=>r.aht, tip:'AHT = ACD + ACW'},
    {id:'ic_acd',        label:'ACD',    blk:'ic',       get:r=>r.acd, tip:'已接聽通話（Is Answered=Yes）的 (Call End Time − Last Routed to Agent Time) 平均秒數'},
    {id:'ic_csat',       label:'滿意度', blk:'ic',       get:r=>r.icCsat, tip:'Good ÷ (Good+Bad)，CSAT 欄位模糊比對（文字包含good/bad即算）'},
    {id:'ic_csatrate',   label:'回收率', blk:'ic',       get:r=>r.icCsatRate, tip:'(Good+Bad) ÷ 通數，分母只有Call產能，不含Chat，Average不計入分子'},

    {id:'chat_count',    label:'產能',   blk:'chat',     get:r=>r.chatCount, tip:'依 Chat Owner 分組計數，目前無排除規則'},

    {id:'sp1',           label:'',       blk:'blank',    get:()=>''},

    {id:'cc_count',      label:'產能',   blk:'callchat', get:r=>{
      const ic = typeof r.icCount==='number' ? r.icCount : 0;
      const ct = typeof r.chatCount==='number' ? r.chatCount : 0;
      return (ic || ct) ? (ic+ct) : '-';
    }, tip:'Call產能 + Chat產能'},
    {id:'cc_acw',        label:'ACW',    blk:'callchat', get:r=>r.acw, tip:'跟左邊Call區塊的ACW是同一個數字：online for case 總秒數 ÷ (Call通數+Chat產能)'},

    {id:'q1',            label:'',       blk:'blank',    get:()=>''},
    {id:'q2',            label:'',       blk:'blank',    get:()=>''},

    {id:'on_ic',         label:'網路電話', blk:'online', get:r=>r.onIC, tip:'Sub Status＝online for internet call 的總秒數'},
    {id:'on_chat',       label:'即時客服', blk:'online', get:r=>r.onChat, tip:'Sub Status＝online for chat 的總秒數'},
    {id:'on_icchat',     label:'雙渠道',   blk:'online', get:r=>r.onICChat, tip:'Sub Status同時＝online for chat,online for internet call（雙渠道同時上線）的總秒數，不是onIC+onChat相加'},
    {id:'on_call',       label:'電話',     blk:'online', get:r=>r.onCall, tip:'Sub Status＝online for call 的總秒數'},
    {id:'on_case',       label:'文書',     blk:'online', get:r=>r.onCase, tip:'Sub Status＝online for case 的總秒數'},

    {id:'busy_wrap',     label:'話後',     blk:'busy', get:r=>r.busyWrap, tip:'Sub Status＝busy with wrapup 的總秒數'},
    {id:'busy_train',    label:'訓練',     blk:'busy', get:r=>r.busyTrain, tip:'Sub Status＝busy with training 的總秒數'},
    {id:'busy_meet',     label:'會議',     blk:'busy', get:r=>r.busyMeet, tip:'Sub Status＝busy with meeting 的總秒數'},
    {id:'busy_coach',    label:'輔導',     blk:'busy', get:r=>r.busyCoach, tip:'Sub Status＝busy with coaching 的總秒數'},
    {id:'busy_esc',      label:'轉單諮詢', blk:'busy', get:r=>r.busyEsc, tip:'Sub Status＝busy with escalation 的總秒數'},
    {id:'busy_out',      label:'外撥',     blk:'busy', get:r=>r.busyOut, tip:'Sub Status＝busy with outbound 的總秒數'},
    {id:'busy_outcount', label:'外撥(通數)', blk:'busy', get:r=>r.busyOutCount, tip:'來自 Hourly Activity 明細，依 Email 加總 Call Outbound(in number)'},

    {id:'away_break',    label:'休息',     blk:'away', get:r=>r.awayBreak, tip:'Sub Status＝away for short break 的總秒數'},
    {id:'away_meal',     label:'用餐',     blk:'away', get:r=>r.awayMeal, tip:'Sub Status＝away for meal 的總秒數'},
    {id:'away_breakmeal',label:'休息+用餐', blk:'away', get:r=>r.awayBreakMeal, tip:'休息秒數 + 用餐秒數 直接相加'},
    {id:'away_consult',  label:'諮詢',     blk:'away', get:r=>r.awayConsult, tip:'Sub Status＝away for consult 的總秒數'},
    {id:'away_personal', label:'其他',     blk:'away', get:r=>r.awayPersonal, tip:'Sub Status＝away for personal break 的總秒數'},

    {id:'offline_time',  label:'離線(時間)', blk:'offline', get:r=>r.offlineTime, tip:'Sub Status＝offline 的總秒數'},
    {id:'offline_count', label:'離線(次數)', blk:'offline', get:r=>r.offlineCount, tip:'Sub Status＝offline 的筆數（排除跨日/EndTime=0後）'},

    {id:'total_a',       label:'Online Busy',      blk:'total', get:r=>r.totalA, tip:'網路電話+即時客服+雙渠道+電話+文書+話後+外撥'},
    {id:'total_b',       label:'Online Busy Away', blk:'total', get:r=>r.totalB, tip:'Online Busy(totalA) 再加上：訓練+會議+輔導+轉單諮詢+休息+用餐+諮詢+其他'}
  ];
}
const OV_BLK_LABEL = {ic:'Call', chat:'Chat', callchat:'Call+Chat', online:'線上 Online', busy:'忙碌 Busy', away:'離開 Away', offline:'離線 Offline', total:'合計', blank:''};

let ovColDefsMap = {};
ovColumnDefs().forEach(c=> ovColDefsMap[c.id] = c);
let ovColumnOrder = ovColumnDefs().map(c=>c.id); // 目前欄位順序（可被拖曳改變）
let ovBlankSet = new Set(); // 使用者手動切成空白的欄位id（保留位置，隱藏內容）
let ovLastRows = null;
let ovNextBlankId = 1; // 使用者自己新增的空白欄，各自要有唯一id

function ovResetLayout(){
  ovColDefsMap = {};
  ovColumnDefs().forEach(c=> ovColDefsMap[c.id] = c);
  ovColumnOrder = ovColumnDefs().map(c=>c.id);
  ovBlankSet = new Set();
  ovNextBlankId = 1;
}

// 在 afterColId 這欄後面插入一個新的空白欄（真的新增一欄，不是切換blank）
function ovInsertBlankAfter(afterColId){
  const newId = 'custom_blank_' + (ovNextBlankId++);
  ovColDefsMap[newId] = {id:newId, label:'', blk:'blank', get:()=>''};
  const idx = ovColumnOrder.indexOf(afterColId);
  if(idx === -1) ovColumnOrder.push(newId);
  else ovColumnOrder.splice(idx+1, 0, newId);
  ovRenderTable(ovLastRows);
}

// 整欄移除（不是切成空白，是真的消失，後面欄位往前補上）
function ovRemoveColumn(colId){
  const idx = ovColumnOrder.indexOf(colId);
  if(idx === -1) return;
  ovColumnOrder.splice(idx, 1);
  ovBlankSet.delete(colId);
  ovRenderTable(ovLastRows);
}

function ovRenderTable(rows){
  ovLastRows = rows;
  const tbl = document.getElementById('overview-table');
  const dateStr = document.getElementById('report-date').value || '';

  // ---- 表頭：單一列，每一欄各自可拖曳、各自可切換空白、各自可插入/移除 ----
  let headHtml = '<tr><th class="idcol id1">組別</th><th class="idcol id2">Batch</th><th class="idcol id3">日期</th><th class="idcol id4">Agent</th>';
  ovColumnOrder.forEach(colId=>{
    const col = ovColDefsMap[colId];
    if(!col) return;
    const isBlankType = col.blk === 'blank';
    const isToggledBlank = ovBlankSet.has(colId);
    const cls = `blk-${col.blk} ov-col-header${isToggledBlank ? ' ov-col-blanked' : ''}`;
    const toggleBtn = isBlankType ? '' :
      `<button type="button" class="ov-blank-toggle" data-colid="${colId}" title="切換顯示/空白">${isToggledBlank ? '🚫' : '👁'}</button>`;
    headHtml += `<th class="${cls}" draggable="true" data-colid="${colId}" title="${isBlankType ? '空白欄' : OV_BLK_LABEL[col.blk]+' - '+col.label+(col.tip?'：'+col.tip:'')}">
        <span class="ov-drag-grip">⠿</span>
        <span class="ov-col-label">${isBlankType ? '' : col.label}</span>
        <span class="ov-col-actions">
          ${toggleBtn}
          <button type="button" class="ov-insert-blank" data-colid="${colId}" title="在這欄後面插入空白欄">➕</button>
          <button type="button" class="ov-remove-col" data-colid="${colId}" title="移除這一欄">🗑</button>
        </span>
      </th>`;
  });
  headHtml += '</tr>';

  // ---- 內容：組別/Batch 沿用合併儲存格（跟標準檢視一致），因為這次拖曳的是欄不是列，不衝突 ----
  let bodyHtml = '';
  let i = 0;
  while(i < rows.length){
    let j = i;
    while(j < rows.length && rows[j].manager === rows[i].manager && rows[j].batch === rows[i].batch) j++;
    const runLen = j - i;
    for(let k = i; k < j; k++){
      const r = rows[k];
      bodyHtml += '<tr>';
      if(k === i){
        bodyHtml += `<td class="idcol id1" rowspan="${runLen}">${r.manager}</td>`;
        bodyHtml += `<td class="idcol id2" rowspan="${runLen}">${r.batch || '-'}</td>`;
      }
      bodyHtml += `<td class="idcol id3">${dateStr || '-'}</td>`;
      bodyHtml += `<td class="idcol id4">${r.name}</td>`;
      ovColumnOrder.forEach(colId=>{
        const col = ovColDefsMap[colId];
        if(!col) return;
        const isToggledBlank = ovBlankSet.has(colId);
        const val = (col.blk === 'blank' || isToggledBlank) ? '' : col.get(r);
        bodyHtml += `<td class="blk-${col.blk}">${val}</td>`;
      });
      bodyHtml += '</tr>';
    }
    i = j;
  }

  tbl.innerHTML = `<thead>${headHtml}</thead><tbody>${bodyHtml}</tbody>`;
  ovFixStickyOffsets();
  ovAttachHeaderDrag();
  ovAttachBlankToggles();
  ovAttachColumnActions();
}

function ovFixStickyOffsets(){
  const tbl = document.getElementById('overview-table');
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

let ovColDragSrcId = null;
function ovAttachHeaderDrag(){
  document.querySelectorAll('#overview-table thead th.ov-col-header').forEach(th=>{
    th.addEventListener('dragstart', (e)=>{
      ovColDragSrcId = th.dataset.colid;
      th.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    th.addEventListener('dragend', ()=> th.classList.remove('dragging'));
    th.addEventListener('dragover', (e)=>{ e.preventDefault(); th.classList.add('drag-over-col'); });
    th.addEventListener('dragleave', ()=> th.classList.remove('drag-over-col'));
    th.addEventListener('drop', (e)=>{
      e.preventDefault();
      th.classList.remove('drag-over-col');
      const targetId = th.dataset.colid;
      if(!ovColDragSrcId || ovColDragSrcId === targetId) return;
      const srcIdx = ovColumnOrder.indexOf(ovColDragSrcId);
      if(srcIdx === -1) return;
      ovColumnOrder.splice(srcIdx, 1);
      const tgtIdx = ovColumnOrder.indexOf(targetId);
      ovColumnOrder.splice(tgtIdx, 0, ovColDragSrcId);
      ovRenderTable(ovLastRows);
    });
  });
}

function ovAttachBlankToggles(){
  document.querySelectorAll('.ov-blank-toggle').forEach(btn=>{
    btn.addEventListener('mousedown', (e)=> e.stopPropagation());
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      const colId = btn.dataset.colid;
      if(ovBlankSet.has(colId)) ovBlankSet.delete(colId);
      else ovBlankSet.add(colId);
      ovRenderTable(ovLastRows);
    });
  });
}

function ovAttachColumnActions(){
  document.querySelectorAll('.ov-insert-blank').forEach(btn=>{
    btn.addEventListener('mousedown', (e)=> e.stopPropagation());
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      ovInsertBlankAfter(btn.dataset.colid);
    });
  });
  document.querySelectorAll('.ov-remove-col').forEach(btn=>{
    btn.addEventListener('mousedown', (e)=> e.stopPropagation());
    btn.addEventListener('click', (e)=>{
      e.stopPropagation();
      ovRemoveColumn(btn.dataset.colid);
    });
  });
}

function ovGenerate(){
  const statusEl = document.getElementById('overview-status');
  try{
    if(!state.ic.rows.length && !state.chat.rows.length && !state.status.rows.length){
      document.getElementById('overview-table').innerHTML = '';
      statusEl.textContent = '尚未上傳資料，請先到①上傳資料完成上傳';
      return;
    }
    const {rows} = computeReport();
    ovRenderTable(rows);
    statusEl.textContent = `已產出 ${rows.length} 位專員資料（表頭可拖曳排序，👁切換空白，➕插入空白欄，🗑移除該欄）`;
    window.__overviewStale = false;
  }catch(err){
    console.error('產能總覽產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message + '（詳細內容請按F12看Console）';
  }
}

document.getElementById('btn-reset-overview-order').onclick = ()=>{
  if(!ovLastRows){ alert('請先切到「產能總覽」分頁，才有資料可以還原。'); return; }
  ovResetLayout();
  ovRenderTable(ovLastRows);
};

document.getElementById('btn-export-overview-xlsx').onclick = ()=>{
  if(!ovLastRows){ alert('請先切到「產能總覽」分頁產生資料，才會有資料可以匯出。'); return; }
  const dateStr = document.getElementById('report-date').value || new Date().toISOString().slice(0,10);

  const header1 = ['組別','Batch','日期','Agent'].concat(ovColumnOrder.map(id=> OV_BLK_LABEL[ovColDefsMap[id].blk]));
  const header2 = ['','','',''].concat(ovColumnOrder.map(id=> ovColDefsMap[id].label));
  const data = [header1, header2];
  ovLastRows.forEach(r=>{
    const rowVals = ovColumnOrder.map(id=>{
      const col = ovColDefsMap[id];
      if(col.blk === 'blank' || ovBlankSet.has(id)) return '';
      return col.get(r);
    });
    data.push([r.manager, r.batch || '-', dateStr, r.name].concat(rowVals));
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '產能總覽');
  XLSX.writeFile(wb, `產能總覽_${dateStr}.xlsx`);
};

/* ============ 標準檢視 / 產能總覽 子分頁切換 ============ */
window.__overviewStale = true;
document.getElementById('subtab-standard').onclick = ()=>{
  document.getElementById('subtab-standard').classList.add('active');
  document.getElementById('subtab-overview').classList.remove('active');
  document.getElementById('result-view-standard').style.display = '';
  document.getElementById('result-view-overview').style.display = 'none';
};
document.getElementById('subtab-overview').onclick = ()=>{
  document.getElementById('subtab-standard').classList.remove('active');
  document.getElementById('subtab-overview').classList.add('active');
  document.getElementById('result-view-standard').style.display = 'none';
  document.getElementById('result-view-overview').style.display = '';
  if(window.__overviewStale){
    ovGenerate();
  }
};
