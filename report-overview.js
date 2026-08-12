/* ============================================================
   report-overview.js — 報表樣板：產能總覽（欄位可拖曳排序版）
   資料完全複用 computeReport()（跟④日報表同一套算法，含新版ACW）。
   排序的單位是「欄」，不是「列」：每一欄的表頭都可以拖曳調整順序
   （單欄拖，或同一區塊內連續拖幾次等於整塊搬動），也可以把任一欄
   切換成「空白」（保留位置但不顯示資料，例如Q欄）。
   組別/Batch 這裡維持跟標準檢視一樣的合併儲存格（因為拖曳的是欄
   不是列，不會互相衝突）。
   完全獨立成自己一份，不影響 report-daily.js。
   ============================================================ */

// ---- 欄位定義：每一欄一個唯一id、顯示名稱、所屬區塊(決定顏色)、怎麼從row取值 ----
function ovColumnDefs(){
  return [
    {id:'ic_count',      label:'產能',   blk:'ic',       get:r=>r.icCount},
    {id:'ic_aht',        label:'AHT',    blk:'ic',       get:r=>r.aht},
    {id:'ic_acd',        label:'ACD',    blk:'ic',       get:r=>r.acd},
    {id:'ic_csat',       label:'滿意度', blk:'ic',       get:r=>r.icCsat},
    {id:'ic_csatrate',   label:'回收率', blk:'ic',       get:r=>r.icCsatRate},

    {id:'chat_count',    label:'產能',   blk:'chat',     get:r=>r.chatCount},
    {id:'chat_aht',      label:'AHT',    blk:'chat',     get:r=>r.chatAht},
    {id:'chat_csat',     label:'滿意度', blk:'chat',     get:r=>r.chatCsat},

    {id:'sp1',           label:'',       blk:'blank',    get:()=>''},

    {id:'cc_count',      label:'產能',   blk:'callchat', get:r=>{
      const ic = typeof r.icCount==='number' ? r.icCount : 0;
      const ct = typeof r.chatCount==='number' ? r.chatCount : 0;
      return (ic || ct) ? (ic+ct) : '-';
    }},
    {id:'cc_acw',        label:'ACW',    blk:'callchat', get:r=>r.acw},

    {id:'q',             label:'',       blk:'blank',    get:()=>''},

    {id:'on_ic',         label:'網路電話', blk:'online', get:r=>r.onIC},
    {id:'on_chat',       label:'即時客服', blk:'online', get:r=>r.onChat},
    {id:'on_icchat',     label:'雙渠道',   blk:'online', get:r=>r.onICChat},
    {id:'on_call',       label:'電話',     blk:'online', get:r=>r.onCall},
    {id:'on_case',       label:'文書',     blk:'online', get:r=>r.onCase},

    {id:'busy_wrap',     label:'話後',     blk:'busy', get:r=>r.busyWrap},
    {id:'busy_train',    label:'訓練',     blk:'busy', get:r=>r.busyTrain},
    {id:'busy_meet',     label:'會議',     blk:'busy', get:r=>r.busyMeet},
    {id:'busy_coach',    label:'輔導',     blk:'busy', get:r=>r.busyCoach},
    {id:'busy_esc',      label:'轉單諮詢', blk:'busy', get:r=>r.busyEsc},
    {id:'busy_out',      label:'外撥',     blk:'busy', get:r=>r.busyOut},
    {id:'busy_outcount', label:'外撥(通數)', blk:'busy', get:r=>r.busyOutCount},

    {id:'away_break',    label:'休息',     blk:'away', get:r=>r.awayBreak},
    {id:'away_meal',     label:'用餐',     blk:'away', get:r=>r.awayMeal},
    {id:'away_breakmeal',label:'休息+用餐', blk:'away', get:r=>r.awayBreakMeal},
    {id:'away_consult',  label:'諮詢',     blk:'away', get:r=>r.awayConsult},
    {id:'away_personal', label:'其他',     blk:'away', get:r=>r.awayPersonal},

    {id:'offline_time',  label:'離線(時間)', blk:'offline', get:r=>r.offlineTime},
    {id:'offline_count', label:'離線(次數)', blk:'offline', get:r=>r.offlineCount},

    {id:'total_a',       label:'Online Busy',      blk:'total', get:r=>r.totalA},
    {id:'total_b',       label:'Online Busy Away', blk:'total', get:r=>r.totalB}
  ];
}
const OV_BLK_LABEL = {ic:'Call', chat:'Chat', callchat:'Call+Chat', online:'線上 Online', busy:'忙碌 Busy', away:'離開 Away', offline:'離線 Offline', total:'合計', blank:''};

let ovColDefsMap = {};
ovColumnDefs().forEach(c=> ovColDefsMap[c.id] = c);
let ovColumnOrder = ovColumnDefs().map(c=>c.id); // 目前欄位順序（可被拖曳改變）
let ovBlankSet = new Set(); // 使用者手動切成空白的欄位id
let ovLastRows = null;

function ovResetLayout(){
  ovColumnOrder = ovColumnDefs().map(c=>c.id);
  ovBlankSet = new Set();
}

function ovRenderTable(rows){
  ovLastRows = rows;
  const tbl = document.getElementById('overview-table');
  const dateStr = document.getElementById('report-date').value || '';

  // ---- 表頭：單一列，每一欄各自可拖曳、各自可切換空白 ----
  let headHtml = '<tr><th class="idcol id1">組別</th><th class="idcol id2">Batch</th><th class="idcol id3">日期</th><th class="idcol id4">Agent</th>';
  ovColumnOrder.forEach(colId=>{
    const col = ovColDefsMap[colId];
    const isBlankType = col.blk === 'blank';
    const isToggledBlank = ovBlankSet.has(colId);
    const cls = `blk-${col.blk} ov-col-header${isToggledBlank ? ' ov-col-blanked' : ''}`;
    const toggleBtn = isBlankType ? '' :
      `<button type="button" class="ov-blank-toggle" data-colid="${colId}" title="切換顯示/空白">${isToggledBlank ? '🚫' : '👁'}</button>`;
    headHtml += `<th class="${cls}" draggable="true" data-colid="${colId}">
        <span class="ov-drag-grip">⠿</span>
        <span class="ov-col-label">${isBlankType ? '' : col.label}</span>
        ${toggleBtn}
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
    statusEl.textContent = `已產出 ${rows.length} 位專員資料（欄位表頭可拖曳排序，👁可切換空白）`;
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
