/* ============================================================

   ============================================================ */

function csFmt(v){ return (v===null || v===undefined) ? '-' : v.toFixed(1); }
function csFmtCombined(callV, iactV){
  if(callV===null && iactV===null) return '-';
  return ((callV||0) + (iactV||0)).toFixed(1);
}

document.getElementById('btn-toggle-cs-ref').dataset.expanded = '0';
document.getElementById('btn-toggle-cs-ref').onclick = function(){
  const expanded = this.dataset.expanded === '1';
  this.dataset.expanded = expanded ? '0' : '1';
  this.textContent = expanded ? '🔍 顯示計算來源' : '🔽 隱藏計算來源';
  document.querySelectorAll('.cs-table').forEach(t=> t.classList.toggle('cs-show-ref', !expanded));
};

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

    // 
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
        ? '<th class="cs-ref-col">Call人力</th><th class="cs-ref-col">Call半天</th><th class="cs-ref-col">Call分母</th><th class="cs-ref-col">Call總和</th><th class="cs-ref-col">IACT人力</th><th class="cs-ref-col">IACT半天</th><th class="cs-ref-col">IACT分母</th><th class="cs-ref-col">IACT總和</th>'
        : '<th class="cs-ref-col">人力</th><th class="cs-ref-col">半天人力</th><th class="cs-ref-col">分母</th><th class="cs-ref-col">Call總和</th>';
      const bodyHtml = rows.map(r=>{
        const ref = r[3];
        const refCells = ref
          ? (showIact
              ? `<td class="cs-ref-col">${ref.manpower}</td><td class="cs-ref-col">${ref.halfDayCount}</td><td class="cs-ref-col">${ref.denom}</td><td class="cs-ref-col">${ref.callSum}</td><td class="cs-ref-col">${ref.iactManpower}</td><td class="cs-ref-col">${ref.iactHalfDayCount}</td><td class="cs-ref-col">${ref.iactDenom}</td><td class="cs-ref-col">${ref.iactSum}</td>`
              : `<td class="cs-ref-col">${ref.manpower}</td><td class="cs-ref-col">${ref.halfDayCount}</td><td class="cs-ref-col">${ref.denom}</td><td class="cs-ref-col">${ref.callSum}</td>`)
          : (showIact ? '<td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td>' : '<td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td><td class="cs-ref-col">-</td>');
        return `<tr><td style="text-align:left;">${r[0]}</td><td style="text-align:left;">${r[1]}</td><td>${r[2]||'&nbsp;'}</td>${refCells}</tr>`;
      }).join('');
      tbl.innerHTML = `<thead><tr><th>分類</th><th>項目</th><th>數值</th>${extraHead}</tr></thead><tbody>${bodyHtml}</tbody>`;
      // 維持目前的展開/收合狀態（重新產出時不要跳回收合）
      tbl.classList.toggle('cs-show-ref', document.getElementById('btn-toggle-cs-ref').dataset.expanded === '1');
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
