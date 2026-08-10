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

// 分母規則：人力 = Call>0 的人（半天不排除，只是denom算0.5）
function csGroupStats(list){
  const positive = list.filter(a=>a.icCount>0);
  const manpower = positive.length;
  const halfDayCount = positive.filter(a=>a.halfDay).length;
  const denom = manpower - halfDayCount*0.5;
  const callSum = positive.reduce((s,a)=>s+a.icCount,0);
  const iactSum = positive.reduce((s,a)=>s+(a.iactCount||0),0);
  return {
    callAvg: denom>0 ? callSum/denom : null,
    iactAvg: denom>0 ? iactSum/denom : null,
    manpower, halfDayCount, denom
  };
}

let lastCallSummaryRows = null;

document.getElementById('btn-generate-callsummary').onclick = ()=>{
  const statusEl = document.getElementById('callsummary-status');
  const wbox = document.getElementById('callsummary-warnings');
  try{
    if(!state.ic.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳 Internet Call 明細</strong>，請先到「①上傳資料」完成上傳。</div>`;
      document.getElementById('callsummary-table').innerHTML = '';
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

    const rows = [
      ['產能','Call-Jackie', '-'],
      ['產能','Call-Patty', csFmt(sPatty.callAvg)],
      ['產能','Call-Lucy', csFmt(sLucy.callAvg)],
      ['產能','Call-Kelly', '-'],
      ['產能','Call-非全技能(IH)', csFmt(sNonFull.callAvg)],
      ['產能','Call-非全技能(BPO)', ''],
      ['產能','Call -全技能(IH)', csFmt(sFull.callAvg)],
      ['產能','Call -全技能(BPO)', ''],
      ['產能','Call -(非全技能Total)', csFmt(sNonFull.callAvg)],
      ['產能','Call -(全技能Total)', csFmt(sFull.callAvg)],
      ['產能','Call -(Total)', csFmt(sTotal.callAvg)],
      ['含IACT產能','Call-Jackie', '-'],
      ['含IACT產能','Call-Patty', csFmtCombined(sPatty.callAvg, sPatty.iactAvg)],
      ['含IACT產能','Call-Lucy', csFmtCombined(sLucy.callAvg, sLucy.iactAvg)],
      ['含IACT產能','Call-Kelly', '-'],
      ['含IACT產能','Call-非全技能(IH)', csFmtCombined(sNonFull.callAvg, sNonFull.iactAvg)],
      ['含IACT產能','Call-非全技能(BPO)', ''],
      ['含IACT產能','Call -全技能(IH)', csFmtCombined(sFull.callAvg, sFull.iactAvg)],
      ['含IACT產能','Call -全技能(BPO)', ''],
      ['含IACT產能','Call -(非全技能Total)', csFmtCombined(sNonFull.callAvg, sNonFull.iactAvg)],
      ['含IACT產能','Call -(全技能Total)', csFmtCombined(sFull.callAvg, sFull.iactAvg)],
      ['含IACT產能','Call -(Total)', csFmtCombined(sTotal.callAvg, sTotal.iactAvg)]
    ];
    lastCallSummaryRows = rows;

    const tbl = document.getElementById('callsummary-table');
    const bodyHtml = rows.map(r=>
      `<tr><td style="text-align:left;">${r[0]}</td><td style="text-align:left;">${r[1]}</td><td>${r[2]||'&nbsp;'}</td></tr>`
    ).join('');
    tbl.innerHTML = `<thead><tr><th>分類</th><th>項目</th><th>數值</th></tr></thead><tbody>${bodyHtml}</tbody>`;

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

document.getElementById('btn-copy-callsummary').onclick = async ()=>{
  const statusEl = document.getElementById('callsummary-status');
  if(!lastCallSummaryRows){
    alert('請先按「產出」，才會有資料可以複製。');
    return;
  }
  const text = lastCallSummaryRows.map(r=>r[2]).join('\n');
  try{
    await navigator.clipboard.writeText(text);
    statusEl.textContent = '已複製 22 個數值到剪貼簿 ✓';
  }catch(err){
    // 備援：用隱藏textarea選取複製
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try{
      document.execCommand('copy');
      statusEl.textContent = '已複製 22 個數值到剪貼簿 ✓';
    }catch(err2){
      statusEl.textContent = '複製失敗，請直接用滑鼠拖曳選取右欄手動複製';
    }
    document.body.removeChild(ta);
  }
};
