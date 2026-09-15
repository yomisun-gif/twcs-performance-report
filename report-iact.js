/* ============================================================
   report-iact.js — 報表樣板：IACT（多渠道產能，排除 Internet Call）
   結構參考 report-realtime.js，但完全獨立成自己一份，
   不依賴 report-realtime.js 是否有載入／載入順序，改動互不影響。
   初版顯示：在「文書」右側多一欄「IACT產能」，個人數字直接顯示；
   組平均/全隊平均的 IACT 均，先比照 Call均 同一套規則（排除半天，
   分母＝IACT>0的人）試算，最終計算方式之後再依實際需求調整。
   ============================================================ */

function iactSecToHMS(sec){
  if(sec===null || sec===undefined || isNaN(sec)) return '0:00:00';
  sec = Math.round(sec);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function iactPct(fraction){
  if(fraction===null || fraction===undefined || isNaN(fraction)) return '-';
  return (fraction*100).toFixed(1)+'%';
}
function iactNumOrDash(n){ return (n===null || n===undefined) ? '-' : n.toFixed(1); }

const IACT_CSAT_ALERT_THRESHOLD = 0.97;
const IACT_ONCASE_ALERT_THRESHOLD_SEC = 5400;
function iactCsatCellClass(fraction){
  return (fraction !== null && fraction < IACT_CSAT_ALERT_THRESHOLD) ? ' class="cell-alert"' : '';
}
function iactOnCaseCellClass(sec){
  return (sec >= IACT_ONCASE_ALERT_THRESHOLD_SEC) ? ' class="cell-alert"' : '';
}
function iactBelowAvgCellClass(value, benchmark){
  return (value > 0 && benchmark !== null && value < benchmark) ? ' class="cell-alert"' : '';
}

const IACT_MGR_PALETTE = [
  {light:{bg:'#E5EEF5',text:'#25597E'}, dark:{bg:'#273B49',text:'#81B5DA'}},
  {light:{bg:'#E5F5ED',text:'#257E52'}, dark:{bg:'#274938',text:'#81DAAD'}},
  {light:{bg:'#EEE5F5',text:'#59257E'}, dark:{bg:'#3B2749',text:'#B581DA'}},
  {light:{bg:'#F5EEE5',text:'#7E5925'}, dark:{bg:'#493B27',text:'#DAB581'}},
  {light:{bg:'#F5E5F0',text:'#7E2561'}, dark:{bg:'#49273E',text:'#DA81BC'}},
  {light:{bg:'#EDF5E5',text:'#527E25'}, dark:{bg:'#384927',text:'#ADDA81'}},
  {light:{bg:'#E8E5F5',text:'#34257E'}, dark:{bg:'#2D2749',text:'#8F81DA'}},
  {light:{bg:'#F5E9E5',text:'#7E3B25'}, dark:{bg:'#493027',text:'#DA9781'}}
];
function iactMgrColor(index){
  const isDark = document.documentElement.classList.contains('dark');
  const pair = IACT_MGR_PALETTE[index % IACT_MGR_PALETTE.length];
  return isDark ? pair.dark : pair.light;
}

function extractIactAgent(email, a){
  const onCaseSec = (a.status && a.status.on_case) ? a.status.on_case.sec : 0;
  return {
    email, name: a.name || email, managerShort: a.manager,
    fullSkill: a.fullSkill, bbt: a.bbt, halfDay: a.halfDay, countedInScore: a.countedInScore,
    icCount: a.icCount||0, chatCount: a.chatCount||0,
    icGood: a.icGood||0, icBad: a.icBad||0,
    chatGood: a.chatGood||0, chatBad: a.chatBad||0,
    onCaseSec, iactCount: a.iactCount||0
  };
}

function iactSummarizeSkillGroup(list){
  const byManager = {};
  const managerOrder = [];
  list.forEach(a=>{
    const key = a.managerShort || '(未設定)';
    if(!byManager[key]){ byManager[key] = []; managerOrder.push(key); }
    byManager[key].push(a);
  });

  function avgBy(list, valueFn){
    if(!list.length) return null;
    return list.reduce((s,a)=> s+valueFn(a), 0) / list.length;
  }

  function computeGroupStats(group){
    const eligible = group.filter(a => !a.halfDay);
    const callList = eligible.filter(a => a.icCount > 0);
    const chatList = eligible.filter(a => a.chatCount > 0);
    const totalList = eligible.filter(a => (a.icCount + a.chatCount) > 0);
    const onCaseList = totalList;
    const iactList = eligible.filter(a => a.iactCount > 0);

    const callCsatList = callList.filter(a => (a.icGood + a.icBad) > 0);
    const chatCsatList = chatList.filter(a => (a.chatGood + a.chatBad) > 0);

    return {
      callAvg: avgBy(callList, a=>a.icCount),
      chatAvg: avgBy(chatList, a=>a.chatCount),
      totalAvg: avgBy(totalList, a=>a.icCount+a.chatCount),
      onCaseAvg: avgBy(onCaseList, a=>a.onCaseSec),
      iactAvg: avgBy(iactList, a=>a.iactCount),
      callCsatAvg: avgBy(callCsatList, a=>a.icGood/(a.icGood+a.icBad)),
      chatCsatAvg: avgBy(chatCsatList, a=>a.chatGood/(a.chatGood+a.chatBad))
    };
  }

  const managers = managerOrder.map(key=>({
    managerShort: key,
    agents: byManager[key],
    groupAvg: computeGroupStats(byManager[key])
  }));

  const orgSummary = computeGroupStats(list);
  return {orgSummary, managers};
}

function iactRenderMergedTable(managers, orgSummary, dateStr, timeStr){
  const totalCols = managers.length * 8; // 比即時產能多一欄 IACT產能

  const summaryLabelRow = '<tr class="rt-summary-row">' +
    '<th>Day</th><th>Call產能(均)</th><th>Chat產能(均)</th><th>Total產能(均)</th><th>Call滿意度(均)</th><th>Chat滿意度(均)</th><th>文書(均)</th><th>IACT產能(均)</th><th>報表時間</th>' +
    (totalCols>9 ? `<th colspan="${totalCols-9}"></th>` : '') +
    '</tr>';
  const summaryValueRow = '<tr class="rt-summary-row rt-summary-value">' +
    `<th>${dateStr}</th><th>${iactNumOrDash(orgSummary.callAvg)}</th><th>${iactNumOrDash(orgSummary.chatAvg)}</th>` +
    `<th>${iactNumOrDash(orgSummary.totalAvg)}</th><th>${iactPct(orgSummary.callCsatAvg)}</th><th>${iactPct(orgSummary.chatCsatAvg)}</th>` +
    `<th>${iactSecToHMS(orgSummary.onCaseAvg)}</th><th>${iactNumOrDash(orgSummary.iactAvg)}</th><th class="rt-report-time">${timeStr}</th>` +
    (totalCols>9 ? `<th colspan="${totalCols-9}"></th>` : '') +
    '</tr>';

  const maxAgents = Math.max(0, ...managers.map(m=>m.agents.length));

  let h1 = '<tr>';
  managers.forEach((mgr, i)=>{
    const color = iactMgrColor(i);
    h1 += `<th colspan="8" style="background:${color.bg};color:${color.text};">${mgr.managerShort}</th>`;
  });
  h1 += '</tr>';

  let h2 = '<tr>';
  managers.forEach(()=>{
    h2 += `<th>姓名</th>
      <th title="Call>0的人才算，半天完全排除">Call產能</th>
      <th title="Good÷(Good+Bad)，分母是「Call>0的人」，低於97%會標紅">Call滿意度</th>
      <th title="Chat>0的人才算，半天完全排除">Chat產能</th>
      <th title="Good÷(Good+Bad)，分母是「Chat>0的人」">Chat滿意度</th>
      <th title="(Call+Chat)>0的人才算；半天完全排除，不是打折。低於全隊Total產能均會標紅">Total產能</th>
      <th title="有上班(Call+Chat>0)就算，不要求文書>0。≥1:30:00會標紅">文書</th>
      <th title="IACT>0的人才算(排除Internet Call渠道後的產能)，半天完全排除。低於全隊IACT產能均會標紅">IACT產能</th>`;
  });
  h2 += '</tr>';

  let avgRow = '<tr class="rt-avg-row">';
  managers.forEach(mgr=>{
    const g = mgr.groupAvg;
    avgRow += `<td>組平均</td>
      <td>${iactNumOrDash(g.callAvg)}</td>
      <td${iactCsatCellClass(g.callCsatAvg)}>${iactPct(g.callCsatAvg)}</td>
      <td>${iactNumOrDash(g.chatAvg)}</td>
      <td>${iactPct(g.chatCsatAvg)}</td>
      <td${iactBelowAvgCellClass(g.totalAvg, orgSummary.totalAvg)}>${iactNumOrDash(g.totalAvg)}</td>
      <td${iactOnCaseCellClass(g.onCaseAvg||0)}>${iactSecToHMS(g.onCaseAvg)}</td>
      <td${iactBelowAvgCellClass(g.iactAvg, orgSummary.iactAvg)}>${iactNumOrDash(g.iactAvg)}</td>`;
  });
  avgRow += '</tr>';

  let bodyRows = '';
  for(let idx=0; idx<maxAgents; idx++){
    bodyRows += '<tr>';
    managers.forEach((mgr, mi)=>{
      const a = mgr.agents[idx];
      if(!a){ bodyRows += '<td class="rt-blank-cell"></td>'.repeat(8); return; }
      const color = iactMgrColor(mi);
      const callFrac = (a.icGood+a.icBad)>0 ? a.icGood/(a.icGood+a.icBad) : null;
      const chatFrac = (a.chatGood+a.chatBad)>0 ? a.chatGood/(a.chatGood+a.chatBad) : null;
      const total = a.icCount+a.chatCount;
      bodyRows += `<td style="background:${color.bg}66;">${a.name}${a.halfDay?' (半)':''}</td>
        <td>${a.icCount}</td>
        <td${iactCsatCellClass(callFrac)}>${callFrac!==null?iactPct(callFrac):'-'}</td>
        <td>${a.chatCount}</td>
        <td>${chatFrac!==null?iactPct(chatFrac):'-'}</td>
        <td${iactBelowAvgCellClass(total, mgr.groupAvg.totalAvg)}>${total}</td>
        <td${iactOnCaseCellClass(a.onCaseSec)}>${iactSecToHMS(a.onCaseSec)}</td>
        <td${iactBelowAvgCellClass(a.iactCount, mgr.groupAvg.iactAvg)}>${a.iactCount}</td>`;
    });
    bodyRows += '</tr>';
  }

  return `<table class="rt-merged-table">
    <thead>${summaryLabelRow}${summaryValueRow}${h1}${h2}</thead>
    <tbody>${avgRow}${bodyRows}</tbody>
  </table>`;
}

function iactRenderSkillSection(title, dateStr, timeStr, data){
  if(!data.managers.length){
    return `<div class="rt-skill-title"><span class="dot"></span>${title}</div><p class="rt-empty-note">目前沒有符合條件的專員資料（計入成績已勾選，且當時段已有 Call 或 Chat 產能）。</p>`;
  }
  return `<div class="rt-skill-title"><span class="dot"></span>${title}</div>
    <div class="report-wrap" style="overflow-x:auto;max-height:none;">
      ${iactRenderMergedTable(data.managers, data.orgSummary, dateStr, timeStr)}
    </div>`;
}

let lastIactData = null;

document.getElementById('btn-generate-iact').onclick = ()=>{
  const statusEl = document.getElementById('iact-status');
  const wbox = document.getElementById('iact-warnings');
  try{
    if(!state.ic.rows.length && !state.chat.rows.length && !state.status.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳任何明細資料</strong>，請先到「①上傳資料」完成上傳。</div>`;
      document.getElementById('iact-output').innerHTML = '';
      statusEl.textContent = '尚未上傳資料';
      return;
    }
    if(!state.iact.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳 IACT 產量明細</strong>，請到「①上傳資料」上傳第5份 IACT 檔案（選填欄位那格）。</div>`;
      document.getElementById('iact-output').innerHTML = '';
      statusEl.textContent = '尚未上傳 IACT 明細';
      return;
    }
    if(!state.iact.map.email || !state.iact.map.channel_type){
      wbox.innerHTML = `<div class="warn-box"><strong>請先到②欄位對應完成 IACT 明細的欄位設定</strong>（Agent Email / Channel Type）。</div>`;
      statusEl.textContent = '欄位尚未對應';
      return;
    }

    const {agents, emails, warnings} = buildRawAgentStats();

    const now = new Date();
    const dateStr = (now.getMonth()+1)+'/'+now.getDate();
    const timeStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');

    const all = emails.map(e=> extractIactAgent(e, agents[e]))
      .filter(a=> a.countedInScore);

    const bbtList = all.filter(a=>a.bbt);
    const fullSkillList = all.filter(a=>!a.bbt && a.fullSkill);
    const nonFullSkillList = all.filter(a=>!a.bbt && !a.fullSkill);

    const fullData = iactSummarizeSkillGroup(fullSkillList);
    const nonFullData = iactSummarizeSkillGroup(nonFullSkillList);
    const bbtData = iactSummarizeSkillGroup(bbtList);
    lastIactData = {dateStr, timeStr, full:fullData, nonFull:nonFullData, bbt:bbtData};

    const html = iactRenderSkillSection('全技能', dateStr, timeStr, fullData)
      + iactRenderSkillSection('非全技能', dateStr, timeStr, nonFullData)
      + iactRenderSkillSection('BBT', dateStr, timeStr, bbtData);

    document.getElementById('iact-output').innerHTML = html;

    let warnHtml = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
    if(!all.length){
      warnHtml += `<div class="warn-box"><strong>目前沒有任何專員符合條件</strong>——請確認：①「③專員名單」裡至少有人「計入成績」有勾選，②上傳的明細資料裡有這些人的通數。</div>`;
    }
    wbox.innerHTML = warnHtml;
    statusEl.textContent = `已產出（${timeStr}）・全技能 ${fullSkillList.length} 人・非全技能 ${nonFullSkillList.length} 人・BBT ${bbtList.length} 人`;
  }catch(err){
    console.error('IACT 產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};

document.getElementById('btn-export-iact-xlsx').onclick = ()=>{
  if(!lastIactData){ alert('請先按「產出 IACT」，才會有資料可以匯出。'); return; }
  const rows = [];
  function addSection(title, data){
    rows.push([title]);
    const s = data.orgSummary;
    rows.push([
      'Day', lastIactData.dateStr,
      'Call產能(均)', iactNumOrDash(s.callAvg), 'Chat產能(均)', iactNumOrDash(s.chatAvg), 'Total產能(均)', iactNumOrDash(s.totalAvg),
      'Call滿意度(均)', iactPct(s.callCsatAvg), 'Chat滿意度(均)', iactPct(s.chatCsatAvg),
      '文書(均)', iactSecToHMS(s.onCaseAvg), 'IACT產能(均)', iactNumOrDash(s.iactAvg), '報表時間', lastIactData.timeStr
    ]);
    rows.push([]);
    if(!data.managers.length){
      rows.push(['（無符合條件的專員資料）']);
      rows.push([]);
      return;
    }
    data.managers.forEach(mgr=>{
      rows.push([mgr.managerShort]);
      rows.push(['姓名','Call產能','Call滿意度','Chat產能','Chat滿意度','Total產能','文書','IACT產能']);
      const g = mgr.groupAvg;
      rows.push(['組平均', iactNumOrDash(g.callAvg), iactPct(g.callCsatAvg), iactNumOrDash(g.chatAvg), iactPct(g.chatCsatAvg), iactNumOrDash(g.totalAvg), iactSecToHMS(g.onCaseAvg), iactNumOrDash(g.iactAvg)]);
      mgr.agents.forEach(a=>{
        const callFrac = (a.icGood+a.icBad)>0 ? a.icGood/(a.icGood+a.icBad) : null;
        const chatFrac = (a.chatGood+a.chatBad)>0 ? a.chatGood/(a.chatGood+a.chatBad) : null;
        rows.push([
          a.name + (a.halfDay ? '(半)' : ''),
          a.icCount, callFrac!==null ? iactPct(callFrac) : '-',
          a.chatCount, chatFrac!==null ? iactPct(chatFrac) : '-',
          a.icCount + a.chatCount, iactSecToHMS(a.onCaseSec), a.iactCount
        ]);
      });
      rows.push([]);
    });
  }
  addSection('全技能', lastIactData.full);
  addSection('非全技能', lastIactData.nonFull);
  addSection('BBT', lastIactData.bbt);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'IACT');
  const fname = `IACT_${lastIactData.dateStr.replace('/','-')}_${lastIactData.timeStr.replace(':','')}.xlsx`;
  XLSX.writeFile(wb, fname);
};

/* ============================================================
   支援名單（EMAIL/CHAT組臨時支援）
   不進③專員名單，直接用 Email 算 Call/Chat/IACT 產能，跟上面 IACT
   報表同一套篩選規則（Call排除Missed、IACT排除Internet Call）。
   不透過 buildRawAgentStats()（該函式的 iactCount 只補給③名單裡的人），
   改成直接掃描三份原始明細，避免非③名單的人抓不到 IACT 數字。

   分兩組：Chat / Email，各自像③專員名單一樣可新增/刪除列，只需填 Email。
   這批人一律當全天（不支援半天0.5人力）。
   早/晚班目前無資料可判斷，不特別拆分：複製摘要每組只出一組
   「未含IACT/含IACT」數字，算法沿用 report-callsummary.js 的
   csGroupStats()/csFmt()/csFmtCombined()，跟主要 Call 摘要同一套邏輯。
   ============================================================ */

function iactComputeSupportAgent(email){
  const icMap = state.ic.map, chatMap = state.chat.map, iactMap = state.iact.map;
  const e = email.toLowerCase().trim();

  let icCount = 0;
  state.ic.rows.forEach(r=>{
    if(String(r[icMap.last_agent_email]||'').toLowerCase().trim() !== e) return;
    if(String(r[icMap.call_status]||'').trim().toLowerCase() === 'missed') return;
    icCount++;
  });

  let chatCount = 0;
  state.chat.rows.forEach(r=>{
    if(String(r[chatMap.chat_owner]||'').toLowerCase().trim() === e) chatCount++;
  });

  let iactCount = 0;
  state.iact.rows.forEach(r=>{
    if(String(r[iactMap.email]||'').toLowerCase().trim() !== e) return;
    if(String(r[iactMap.channel_type]||'').trim().toLowerCase() === 'internet call') return;
    iactCount++;
  });

  return {icCount, chatCount, iactCount};
}

const SUPPORT_GROUPS = ['chat', 'email'];
const SUPPORT_GROUP_LABEL = {chat:'Chat', email:'Email'};

function supportRowHTML(email){
  return `<tr>
    <td class="ag-text-col"><input type="text" class="sp-email" value="${email||''}" placeholder="email"></td>
    <td class="sp-ic">-</td>
    <td class="sp-chat">-</td>
    <td class="sp-iact">-</td>
    <td class="sp-total">-</td>
    <td><button class="btn-row-del" type="button" title="刪除此列">✕</button></td>
  </tr>`;
}

function addSupportRow(groupKey, email){
  const tbody = document.querySelector(`.support-tbody[data-group="${groupKey}"]`);
  const wrap = document.createElement('tbody');
  wrap.innerHTML = supportRowHTML(email||'');
  const row = wrap.firstElementChild;
  tbody.appendChild(row);
  row.querySelector('.btn-row-del').onclick = ()=> row.remove();
}

function renderSupportGroups(saved){
  SUPPORT_GROUPS.forEach(g=>{
    const tbody = document.querySelector(`.support-tbody[data-group="${g}"]`);
    tbody.innerHTML = '';
    const emails = (saved && saved[g] && saved[g].length) ? saved[g] : [''];
    emails.forEach(e=> addSupportRow(g, e));
  });
}

function getSupportGroupsFromDOM(){
  const out = {};
  SUPPORT_GROUPS.forEach(g=>{
    out[g] = Array.from(document.querySelectorAll(`.support-tbody[data-group="${g}"] .sp-email`))
      .map(inp=>inp.value.trim().toLowerCase())
      .filter(Boolean);
  });
  return out;
}

document.querySelectorAll('.btn-support-add-row').forEach(btn=>{
  btn.onclick = ()=> addSupportRow(btn.dataset.group, '');
});

let lastIactSupportSummary = null;

document.getElementById('btn-generate-iact-support').onclick = ()=>{
  const statusEl = document.getElementById('iact-support-status');
  const wbox = document.getElementById('iact-support-warnings');
  const groups = getSupportGroupsFromDOM();
  const totalPeople = SUPPORT_GROUPS.reduce((s,g)=> s+groups[g].length, 0);

  if(!totalPeople){
    wbox.innerHTML = `<div class="warn-box"><strong>尚未輸入任何 Email</strong>，請至少在 Chat 或 Email 其中一組填一列。</div>`;
    statusEl.textContent = '';
    return;
  }
  if(!state.ic.rows.length && !state.chat.rows.length && !state.iact.rows.length){
    wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳任何明細資料</strong>，請先到「①上傳資料」完成上傳。</div>`;
    statusEl.textContent = '尚未上傳資料';
    return;
  }

  const groupStats = {};
  let notFoundEmails = [];

  SUPPORT_GROUPS.forEach(g=>{
    const rows = document.querySelectorAll(`.support-tbody[data-group="${g}"] tr`);
    const list = [];
    rows.forEach(row=>{
      const email = row.querySelector('.sp-email').value.trim().toLowerCase();
      if(!email) return;
      const s = iactComputeSupportAgent(email);
      row.querySelector('.sp-ic').textContent = s.icCount;
      row.querySelector('.sp-chat').textContent = s.chatCount;
      row.querySelector('.sp-iact').textContent = s.iactCount;
      row.querySelector('.sp-total').textContent = s.icCount + s.chatCount;
      if(s.icCount+s.chatCount+s.iactCount === 0) notFoundEmails.push(email);
      list.push({icCount:s.icCount, iactCount:s.iactCount, halfDay:false});
    });
    groupStats[g] = csGroupStats(list);
  });

  const summaryTbl = document.getElementById('iact-support-summary-table');
  summaryTbl.innerHTML = `<thead><tr><th>組別</th><th title="未含IACT/含IACT，算法同 Call 摘要">未含IACT / 含IACT</th></tr></thead>
    <tbody>${SUPPORT_GROUPS.map(g=>{
      const s = groupStats[g];
      const combined = csFmtCombined(s.callAvg, s.iactAvgAggregate);
      const value = s.callAvg===null ? '0.0/0.0' : `${csFmt(s.callAvg)}/${combined}`;
      return `<tr><td>${SUPPORT_GROUP_LABEL[g]}</td><td>${value}</td></tr>`;
    }).join('')}</tbody>`;
  lastIactSupportSummary = SUPPORT_GROUPS.map(g=>{
    const s = groupStats[g];
    const combined = csFmtCombined(s.callAvg, s.iactAvgAggregate);
    return s.callAvg===null ? '0.0/0.0' : `${csFmt(s.callAvg)}/${combined}`;
  });

  let warnHtml = '';
  if(notFoundEmails.length){
    warnHtml += `<div class="warn-box"><strong>查無資料：</strong>${notFoundEmails.join('、')}——請確認 Email 拼字，或當天是否真的有上傳到這些人的明細。</div>`;
  }
  wbox.innerHTML = warnHtml;
  statusEl.textContent = `已計算 ${totalPeople} 人（早/晚班目前無法區分，摘要為當日整組平均，未含IACT/含IACT）`;
};

document.getElementById('btn-copy-iact-support-summary').onclick = async ()=>{
  const statusEl = document.getElementById('iact-support-status');
  if(!lastIactSupportSummary){ alert('請先按「計算支援名單」，才會有數字可以複製。'); return; }
  const text = lastIactSupportSummary.join('\n');
  try{
    await navigator.clipboard.writeText(text);
    statusEl.textContent = '已複製摘要到剪貼簿 ✓';
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
      statusEl.textContent = '已複製摘要到剪貼簿 ✓';
    }catch(err2){
      statusEl.textContent = '複製失敗，請直接用滑鼠拖曳選取手動複製';
    }
    document.body.removeChild(ta);
  }
};

document.getElementById('btn-save-iact-support').onclick = async ()=>{
  await storageSet('iact_support_groups', JSON.stringify(getSupportGroupsFromDOM()));
  document.getElementById('iact-support-status').textContent = '名單已儲存';
};

(async ()=>{
  const saved = await storageGet('iact_support_groups');
  let parsed = null;
  try{ parsed = saved ? JSON.parse(saved) : null; }catch(e){}
  renderSupportGroups(parsed);
})();
