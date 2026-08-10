/* ============================================================
   report-callsummary.js — 報表樣板：Call 摘要（複製貼上友善格式）
   完全獨立成自己一份，不依賴其他 report-*.js。
   固定 22 列輸出：產能 11 列 + 含IACT產能 11 列。
   BBT 不計入。半天「不排除」，只算 0.5 人力（跟即時產能的
   半天規則不同，是這份報表獨立的計算邏輯）。
   Jackie / Kelly / BPO 系列目前是固定佔位，無實際資料來源。
   ============================================================ */

function csFmt(v){ return (v===null || v===undefined) ? '-' : v.toFixed(1); }
function csFmtCombined(callV, iactV){
  if(callV===null && iactV===null) return '-';
  return ((callV||0) + (iactV||0)).toFixed(1);
}

// Call均：一律用 Call>0 的人當分母（半天不排除，只算0.5人力）
// IACT均：這裡刻意算出「兩種」，因為單一主管列跟合計列(IH/Total)的分母規則不一樣：
//   - 單一主管列(Patty/Lucy)：用 IACT 自己的分母（IACT>0的人力）
//   - 合計列(非全技能IH/全技能IH/Total)：沿用 Call 的分母，IACT總和則是該分類全部人加總
function csGroupStats(list){
  const callPositive = list.filter(a=>a.icCount>0);
  const manpower = callPositive.length;
  const halfDayCount = callPositive.filter(a=>a.halfDay).length;
  const denom = manpower - halfDayCount*0.5;
  const callSum = callPositive.reduce((s,a)=>s+a.icCount,0);
  const callAvg = denom>0 ? callSum/denom : null;

  // 合計列用：IACT總和＝該分類「全部人」加總，分母沿用Call的分母
  const iactSumAll = list.reduce((s,a)=>s+(a.iactCount||0),0);
  const iactAvgAggregate = denom>0 ? iactSumAll/denom : null;

  // 單一主管列用：只算IACT>0的人，用IACT自己的分母
  const iactPositive = list.filter(a=>a.iactCount>0);
  const iactManpower = iactPositive.length;
  const iactHalfDayCount = iactPositive.filter(a=>a.halfDay).length;
  const iactDenom = iactManpower - iactHalfDayCount*0.5;
  const iactSumOwn = iactPositive.reduce((s,a)=>s+a.iactCount,0);
  const iactAvgIndividual = iactDenom>0 ? iactSumOwn/iactDenom : null;

  return {
    callAvg, manpower, halfDayCount, denom, callSum,
    iactAvgAggregate, iactSumAll,
    iactAvgIndividual, iactManpower, iactHalfDayCount, iactDenom, iactSumOwn
  };
}

let lastCallSummaryRows = null;

document.getElementById('btn-generate-callsummary').onclick = ()=>{
  const statusEl = document.getElementById('callsummary-status');
  const wbox = document.getElementById('callsummary-warnings');
  try{
    if(!state.ic.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳 Internet Call 明細</strong>，請先到「①上傳資料」完成上傳。</div>`;
      document.getElementById('callsummary-table-produce').innerHTML = '';
      document.getElementById('callsummary-table-iact').innerHTML = '';
      statusEl.textContent = '尚未上傳資料';
      return;
    }

    const {agents, emails, warnings} = buildRawAgentStats();

    const all = emails.map(e=>{
      const a = agents[e];
      return {
        name: a.name||e, managerShort: a.manager, fullSkill: a.fullSkill, bbt: a.bbt,
        halfDay: a.halfDay, countedInScore: a.countedInScore,
        icCount: a.icCount||0, iactCount: a.iactCount||0
      };
    }).filter(a=> a.countedInScore && !a.bbt);

    const pattyFull = all.filter(a=>a.managerShort==='Patty' && a.fullSkill);
    const lucyFull = all.filter(a=>a.managerShort==='Lucy' && a.fullSkill);
    const fullAll = all.filter(a=>a.fullSkill);
    const nonFullAll = all.filter(a=>!a.fullSkill);

    const sPatty = csGroupStats(pattyFull);
    const sLucy = csGroupStats(lucyFull);
    const sFull = csGroupStats(fullAll);
    const sNonFull = csGroupStats(nonFullAll);
    const sTotal = csGroupStats(all);

    // mode: 'individual' = Patty/Lucy 用IACT自己的分母；'aggregate' = 合計列沿用Call分母
    function refOf(s, mode){
      if(!s) return null;
      if(mode==='individual'){
        return {
          manpower:s.manpower, halfDayCount:s.halfDayCount, denom:s.denom, callSum:s.callSum,
          iactManpower:s.iactManpower, iactHalfDayCount:s.iactHalfDayCount, iactDenom:s.iactDenom, iactSum:s.iactSumOwn
        };
      }
      return {
        manpower:s.manpower, halfDayCount:s.halfDayCount, denom:s.denom, callSum:s.callSum,
        iactManpower:s.manpower, iactHalfDayCount:s.halfDayCount, iactDenom:s.denom, iactSum:s.iactSumAll
      };
    }
    function iactValOf(s, mode){ return mode==='individual' ? s.iactAvgIndividual : s.iactAvgAggregate; }

    const produceRows = [
      ['產能','Call-Jackie', '-', null],
      ['產能','Call-Patty', csFmt(sPatty.callAvg), refOf(sPatty,'individual')],
      ['產能','Call-Lucy', csFmt(sLucy.callAvg), refOf(sLucy,'individual')],
      ['產能','Call-Kelly', '-', null],
      ['產能','Call-非全技能(IH)', csFmt(sNonFull.callAvg), refOf(sNonFull,'aggregate')],
      ['產能','Call-非全技能(BPO)', '', null],
      ['產能','Call -全技能(IH)', csFmt(sFull.callAvg), refOf(sFull,'aggregate')],
      ['產能','Call -全技能(BPO)', '', null],
      ['產能','Call -(非全技能Total)', csFmt(sNonFull.callAvg), refOf(sNonFull,'aggregate')],
      ['產能','Call -(全技能Total)', csFmt(sFull.callAvg), refOf(sFull,'aggregate')],
      ['產能','Call -(Total)', csFmt(sTotal.callAvg), refOf(sTotal,'aggregate')]
    ];
    const iactRows = [
      ['含IACT產能','Call-Jackie', '-', null],
      ['含IACT產能','Call-Patty', csFmtCombined(sPatty.callAvg, iactValOf(sPatty,'individual')), refOf(sPatty,'individual')],
      ['含IACT產能','Call-Lucy', csFmtCombined(sLucy.callAvg, iactValOf(sLucy,'individual')), refOf(sLucy,'individual')],
      ['含IACT產能','Call-Kelly', '-', null],
      ['含IACT產能','Call-非全技能(IH)', csFmtCombined(sNonFull.callAvg, iactValOf(sNonFull,'aggregate')), refOf(sNonFull,'aggregate')],
      ['含IACT產能','Call-非全技能(BPO)', '', null],
      ['含IACT產能','Call -全技能(IH)', csFmtCombined(sFull.callAvg, iactValOf(sFull,'aggregate')), refOf(sFull,'aggregate')],
      ['含IACT產能','Call -全技能(BPO)', '', null],
      ['含IACT產能','Call -(非全技能Total)', csFmtCombined(sNonFull.callAvg, iactValOf(sNonFull,'aggregate')), refOf(sNonFull,'aggregate')],
      ['含IACT產能','Call -(全技能Total)', csFmtCombined(sFull.callAvg, iactValOf(sFull,'aggregate')), refOf(sFull,'aggregate')],
      ['含IACT產能','Call -(Total)', csFmtCombined(sTotal.callAvg, iactValOf(sTotal,'aggregate')), refOf(sTotal,'aggregate')]
    ];
    lastCallSummaryRows = {produce: produceRows, iact: iactRows};

    function renderTable(tblId, rows, showIact){
      const tbl = document.getElementById(tblId);
      const extraHead = showIact
        ? '<th>Call人力</th><th>Call半天</th><th>Call分母</th><th>Call總和</th><th>IACT人力</th><th>IACT半天</th><th>IACT分母</th><th>IACT總和</th>'
        : '<th>人力</th><th>半天人力</th><th>分母</th><th>Call總和</th>';
      const bodyHtml = rows.map(r=>{
        const ref = r[3];
        const refCells = ref
          ? (showIact
              ? `<td>${ref.manpower}</td><td>${ref.halfDayCount}</td><td>${ref.denom}</td><td>${ref.callSum}</td><td>${ref.iactManpower}</td><td>${ref.iactHalfDayCount}</td><td>${ref.iactDenom}</td><td>${ref.iactSum}</td>`
              : `<td>${ref.manpower}</td><td>${ref.halfDayCount}</td><td>${ref.denom}</td><td>${ref.callSum}</td>`)
          : (showIact ? '<td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td><td>-</td>' : '<td>-</td><td>-</td><td>-</td><td>-</td>');
        return `<tr><td style="text-align:left;">${r[0]}</td><td style="text-align:left;">${r[1]}</td><td>${r[2]||'&nbsp;'}</td>${refCells}</tr>`;
      }).join('');
      tbl.innerHTML = `<thead><tr><th>分類</th><th>項目</th><th>數值</th>${extraHead}</tr></thead><tbody>${bodyHtml}</tbody>`;
    }
    renderTable('callsummary-table-produce', produceRows, false);
    renderTable('callsummary-table-iact', iactRows, true);

    let warnHtml = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
    if(!state.iact.rows.length){
      warnHtml += `<div class="warn-box"><strong>尚未上傳 IACT 明細</strong>——「含IACT產能」那幾列目前只會等於「產能」那幾列（IACT均當作0），不是算錯，是還沒有 IACT 資料。</div>`;
    }
    if(!pattyFull.length){
      warnHtml += `<div class="warn-box">找不到主管簡稱為「Patty」的全技能專員，Call-Patty 那列會是 -，麻煩確認③名單裡的主管簡稱是否精確等於「Patty」。</div>`;
    }
    if(!lucyFull.length){
      warnHtml += `<div class="warn-box">找不到主管簡稱為「Lucy」的全技能專員，Call-Lucy 那列會是 -，麻煩確認③名單裡的主管簡稱是否精確等於「Lucy」。</div>`;
    }
    wbox.innerHTML = warnHtml;
    statusEl.textContent = `已產出 22 列`;
  }catch(err){
    console.error('Call摘要產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};

async function csCopyRows(rows, statusEl, label){
  const text = rows.map(r=>r[2]).join('\n');
  try{
    await navigator.clipboard.writeText(text);
    statusEl.textContent = `已複製「${label}」${rows.length}個數值到剪貼簿 ✓`;
  }catch(err){
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{
      document.execCommand('copy');
      statusEl.textContent = `已複製「${label}」${rows.length}個數值到剪貼簿 ✓`;
    }catch(err2){
      statusEl.textContent = '複製失敗，請直接用滑鼠拖曳選取右欄手動複製';
    }
    document.body.removeChild(ta);
  }
}

document.getElementById('btn-copy-callsummary-produce').onclick = ()=>{
  const statusEl = document.getElementById('callsummary-status');
  if(!lastCallSummaryRows){ alert('請先按「產出」，才會有資料可以複製。'); return; }
  csCopyRows(lastCallSummaryRows.produce, statusEl, '產能');
};
document.getElementById('btn-copy-callsummary-iact').onclick = ()=>{
  const statusEl = document.getElementById('callsummary-status');
  if(!lastCallSummaryRows){ alert('請先按「產出」，才會有資料可以複製。'); return; }
  csCopyRows(lastCallSummaryRows.iact, statusEl, '含IACT產能');
};
