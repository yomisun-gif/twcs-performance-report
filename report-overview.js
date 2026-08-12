/* ============================================================
   report-overview.js — 報表樣板：產能總覽
   資料完全複用 computeReport()（跟④日報表同一套算法，含新版ACW），
   只是重新排版欄位順序，並支援「同一主管底下」自由拖曳排序。
   組別/Batch 這裡改成每列各自顯示（不用合併儲存格），
   這是為了讓拖曳排序不會破壞合併格範圍，刻意的取捨。
   完全獨立成自己一份，不影響 report-daily.js。
   ============================================================ */

let ovDragSrc = null;
let ovOriginalRows = null;

function ovToNum(v){ return typeof v === 'number' ? v : 0; }

function renderOverviewTable(rows){
  const tbl = document.getElementById('overview-table');
  const dateStr = document.getElementById('report-date').value || '';

  const h1 = `<tr>
    <th rowspan="2"></th>
    <th rowspan="2">組別</th>
    <th rowspan="2">Batch</th>
    <th rowspan="2">日期</th>
    <th rowspan="2">Agent</th>
    <th class="blk-ic" colspan="5">Call</th>
    <th class="blk-chat" colspan="1">Chat</th>
    <th></th>
    <th class="blk-callchat" colspan="2">Call+Chat</th>
    <th>Q</th>
  </tr>`;
  const h2 = `<tr>
    <th class="blk-ic">產能</th><th class="blk-ic">AHT</th><th class="blk-ic">ACD</th><th class="blk-ic">滿意度</th><th class="blk-ic">回收率</th>
    <th class="blk-chat">產能</th>
    <th></th>
    <th class="blk-callchat">產能</th><th class="blk-callchat">ACW</th>
    <th></th>
  </tr>`;

  const body = rows.map(r=>{
    const icNum = ovToNum(r.icCount);
    const chatNum = ovToNum(r.chatCount);
    const totalNum = (icNum || chatNum) ? (icNum + chatNum) : '-';
    return `<tr class="ov-row" draggable="true" data-manager="${r.manager}">
      <td class="ov-drag-handle" title="拖曳調整順序">⠿</td>
      <td style="text-align:left;">${r.manager}</td>
      <td>${r.batch || '-'}</td>
      <td>${dateStr || '-'}</td>
      <td style="text-align:left;font-weight:700;">${r.name}</td>
      <td class="blk-ic">${r.icCount}</td>
      <td class="blk-ic">${r.aht}</td>
      <td class="blk-ic">${r.acd}</td>
      <td class="blk-ic">${r.icCsat}</td>
      <td class="blk-ic">${r.icCsatRate}</td>
      <td class="blk-chat">${r.chatCount}</td>
      <td></td>
      <td class="blk-callchat">${totalNum}</td>
      <td class="blk-callchat">${r.acw}</td>
      <td></td>
    </tr>`;
  }).join('');

  tbl.innerHTML = `<thead>${h1}${h2}</thead><tbody>${body}</tbody>`;
  ovEnableDrag();
}

function ovEnableDrag(){
  const tbody = document.querySelector('#overview-table tbody');
  if(!tbody) return;
  tbody.querySelectorAll('tr.ov-row').forEach(row=>{
    row.addEventListener('dragstart', (e)=>{
      ovDragSrc = row;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', ()=>{
      row.classList.remove('dragging');
      tbody.querySelectorAll('.drag-over').forEach(r=>r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover', (e)=>{
      e.preventDefault();
      if(!ovDragSrc || ovDragSrc===row) return;
      if(ovDragSrc.dataset.manager !== row.dataset.manager) return;
      row.classList.add('drag-over');
    });
    row.addEventListener('dragleave', ()=> row.classList.remove('drag-over'));
    row.addEventListener('drop', (e)=>{
      e.preventDefault();
      row.classList.remove('drag-over');
      if(!ovDragSrc || ovDragSrc===row) return;
      if(ovDragSrc.dataset.manager !== row.dataset.manager){
        alert('只能在同一位主管底下調整順序，不能拖到別的主管區塊。');
        return;
      }
      const rows = Array.from(tbody.children);
      const srcIdx = rows.indexOf(ovDragSrc);
      const tgtIdx = rows.indexOf(row);
      if(srcIdx < tgtIdx) row.after(ovDragSrc); else row.before(ovDragSrc);
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
    ovOriginalRows = rows;
    renderOverviewTable(rows);
    statusEl.textContent = `已產出 ${rows.length} 位專員資料（可拖曳同主管內的順序）`;
    window.__overviewStale = false;
  }catch(err){
    console.error('產能總覽產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message + '（詳細內容請按F12看Console）';
  }
}

document.getElementById('btn-reset-overview-order').onclick = ()=>{
  if(!ovOriginalRows){ alert('請先切到「產能總覽」分頁，才有原始順序可以還原。'); return; }
  renderOverviewTable(ovOriginalRows);
};

document.getElementById('btn-export-overview-xlsx').onclick = ()=>{
  const tbody = document.querySelector('#overview-table tbody');
  if(!tbody || !tbody.children.length){ alert('請先切到「產能總覽」分頁產生資料，才會有資料可以匯出。'); return; }
  const header = ['組別','Batch','日期','Agent','Call-產能','Call-AHT','Call-ACD','Call-滿意度','Call-回收率','Chat-產能','','Call+Chat-產能','Call+Chat-ACW','Q'];
  const data = [header];
  Array.from(tbody.children).forEach(tr=>{
    const cells = Array.from(tr.children).slice(1); // 跳過拖曳把手那格
    data.push(cells.map(td=> td.textContent.trim()));
  });
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '產能總覽');
  const dateStr = document.getElementById('report-date').value || new Date().toISOString().slice(0,10);
  XLSX.writeFile(wb, `產能總覽_${dateStr}.xlsx`);
};

/* ============ 標準檢視 / 產能總覽 子分頁切換 ============ */
window.__overviewStale = true; // 一開始還沒產出過，算stale
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
  // 只有第一次切過來、或上面按過「產出報表」讓資料過期時，才重新產生；
  // 否則保留使用者拖曳過的順序，不要每次切分頁就重置
  if(window.__overviewStale){
    ovGenerate();
  }
};
