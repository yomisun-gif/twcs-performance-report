/* ============================================================
   report-realtime.js — 報表樣板：即時產能（一天可產出多次）
   吃 buildRawAgentStats() 產出的原始 agents 數據，
   依「全技能／非全技能」分組，組內再依主管並排呈現。
   完全不動 engine.js 既有輸出格式，也不影響 report-daily.js。
   ============================================================ */

function secToHMSRT(sec){
  if(sec===null || sec===undefined || isNaN(sec)) return '0:00:00';
  sec = Math.round(sec);
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec%60;
  return h+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
}
function pctRT(fraction){
  if(fraction===null || fraction===undefined || isNaN(fraction)) return '-';
  return (fraction*100).toFixed(1)+'%';
}
function numOrDash(n){ return (n===null || n===undefined) ? '-' : n.toFixed(1); }

// ---- 條件式格式門檻 ----
const CSAT_ALERT_THRESHOLD = 0.97;      // 滿意度 < 97% 標紅
const ONCASE_ALERT_THRESHOLD_SEC = 5400; // 文書 >= 1/16天(1:30:00) 標紅

function csatCellClass(fraction){
  return (fraction !== null && fraction < CSAT_ALERT_THRESHOLD) ? ' class="cell-alert"' : '';
}
function onCaseCellClass(sec){
  return (sec >= ONCASE_ALERT_THRESHOLD_SEC) ? ' class="cell-alert"' : '';
}
// 產能低於基準值就標紅：要求 >0（有出勤）且 < 基準
function belowAvgCellClass(value, benchmark){
  return (value > 0 && benchmark !== null && value < benchmark) ? ' class="cell-alert"' : '';
}

// ---- 主管識別色（低飽和度，各主管一個顏色，深色模式另有一套） ----
const MGR_PALETTE = [
  {light:{bg:'#E5EEF5',text:'#25597E'}, dark:{bg:'#273B49',text:'#81B5DA'}},
  {light:{bg:'#E5F5ED',text:'#257E52'}, dark:{bg:'#274938',text:'#81DAAD'}},
  {light:{bg:'#EEE5F5',text:'#59257E'}, dark:{bg:'#3B2749',text:'#B581DA'}},
  {light:{bg:'#F5EEE5',text:'#7E5925'}, dark:{bg:'#493B27',text:'#DAB581'}},
  {light:{bg:'#F5E5F0',text:'#7E2561'}, dark:{bg:'#49273E',text:'#DA81BC'}},
  {light:{bg:'#EDF5E5',text:'#527E25'}, dark:{bg:'#384927',text:'#ADDA81'}},
  {light:{bg:'#E8E5F5',text:'#34257E'}, dark:{bg:'#2D2749',text:'#8F81DA'}},
  {light:{bg:'#F5E9E5',text:'#7E3B25'}, dark:{bg:'#493027',text:'#DA9781'}}
];
function mgrColor(index){
  const isDark = document.documentElement.classList.contains('dark');
  const pair = MGR_PALETTE[index % MGR_PALETTE.length];
  return isDark ? pair.dark : pair.light;
}

// 把 buildRawAgentStats() 的原始 agents 轉成這份報表要用的精簡欄位
function extractRealtimeAgent(email, a){
  const onCaseSec = (a.status && a.status.on_case) ? a.status.on_case.sec : 0;
  return {
    email, name: a.name || email, managerShort: a.manager, managerEmail: a.managerEmail,
    fullSkill: a.fullSkill, bbt: a.bbt, halfDay: a.halfDay, countedInScore: a.countedInScore,
    icCount: a.icCount||0, chatCount: a.chatCount||0,
    icGood: a.icGood||0, icBad: a.icBad||0,
    chatGood: a.chatGood||0, chatBad: a.chatBad||0,
    onCaseSec
  };
}

// 依技能分類彙總：回傳 { orgSummary, managers: [{managerShort, groupAvg, agents}] }
// 每個指標(Call均/Chat均/Total均/文書均)各自有獨立的分母，不是共用同一個人數：
//   Call均  分母 = Call>0 的人
//   Chat均  分母 = Chat>0 的人
//   Total均 分母 = (Call+Chat)>0 的人（=當日有上班）
//   文書均  分母 = (Call+Chat)>0 的人（有上班就算，不要求文書>0；文書=0且沒上班=休假，不算）
// 半天的人一律完全排除於所有平均計算之外（不是打折），但仍會顯示在名單列表裡當參考。
function summarizeSkillGroup(list){
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
    const eligible = group.filter(a => !a.halfDay); // 半天完全不參與任何平均計算

    const callList = eligible.filter(a => a.icCount > 0);
    const chatList = eligible.filter(a => a.chatCount > 0);
    const totalList = eligible.filter(a => (a.icCount + a.chatCount) > 0);
    const onCaseList = totalList; // 文書均分母跟Total均一樣：有上班就算

    const callCsatList = callList.filter(a => (a.icGood + a.icBad) > 0);
    const chatCsatList = chatList.filter(a => (a.chatGood + a.chatBad) > 0);

    return {
      callAvg: avgBy(callList, a=>a.icCount),
      chatAvg: avgBy(chatList, a=>a.chatCount),
      totalAvg: avgBy(totalList, a=>a.icCount+a.chatCount),
      onCaseAvg: avgBy(onCaseList, a=>a.onCaseSec),
      callCsatAvg: avgBy(callCsatList, a=>a.icGood/(a.icGood+a.icBad)),
      chatCsatAvg: avgBy(chatCsatList, a=>a.chatGood/(a.chatGood+a.chatBad))
    };
  }

  // 主管排序：保留在「③專員名單」設定的區塊順序，不做字母排序
  const managers = managerOrder.map(key=>({
    managerShort: key,
    agents: byManager[key],
    groupAvg: computeGroupStats(byManager[key])
  }));

  const orgSummary = computeGroupStats(list);
  return {orgSummary, managers};
}

function renderOrgBar(dateStr, timeStr, summary){
  function chip(label, value, primary){
    return `<div class="stat-chip${primary?' stat-primary':''}"><span class="stat-label">${label}</span><span class="stat-value">${value}</span></div>`;
  }
  return `<div class="rt-org-bar">
    ${chip('Day', dateStr)}
    ${chip('Call產能(均)', numOrDash(summary.callAvg))}
    ${chip('Chat產能(均)', numOrDash(summary.chatAvg))}
    ${chip('Total產能(均)', numOrDash(summary.totalAvg), true)}
    ${chip('Call滿意度(均)', pctRT(summary.callCsatAvg))}
    ${chip('Chat滿意度(均)', pctRT(summary.chatCsatAvg))}
    ${chip('文書(均)', secToHMSRT(summary.onCaseAvg))}
    ${chip('報表時間', timeStr, true)}
  </div>`;
}

function renderMergedManagersTable(managers, orgSummary){
  const maxAgents = Math.max(0, ...managers.map(m=>m.agents.length));

  let h1 = '<tr>';
  managers.forEach((mgr, i)=>{
    const color = mgrColor(i);
    h1 += `<th colspan="7" style="background:${color.bg};color:${color.text};">${mgr.managerShort}</th>`;
  });
  h1 += '</tr>';

  let h2 = '<tr>';
  managers.forEach(()=>{
    h2 += '<th>姓名</th><th>Call產能</th><th>Call滿意度</th><th>Chat產能</th><th>Chat滿意度</th><th>Total產能</th><th>文書</th>';
  });
  h2 += '</tr>';

  let avgRow = '<tr class="rt-avg-row">';
  managers.forEach(mgr=>{
    const g = mgr.groupAvg;
    avgRow += `<td>組平均</td>
      <td>${numOrDash(g.callAvg)}</td>
      <td${csatCellClass(g.callCsatAvg)}>${pctRT(g.callCsatAvg)}</td>
      <td>${numOrDash(g.chatAvg)}</td>
      <td>${pctRT(g.chatCsatAvg)}</td>
      <td${belowAvgCellClass(g.totalAvg, orgSummary.totalAvg)}>${numOrDash(g.totalAvg)}</td>
      <td${onCaseCellClass(g.onCaseAvg||0)}>${secToHMSRT(g.onCaseAvg)}</td>`;
  });
  avgRow += '</tr>';

  let bodyRows = '';
  for(let idx=0; idx<maxAgents; idx++){
    bodyRows += '<tr>';
    managers.forEach((mgr, mi)=>{
      const a = mgr.agents[idx];
      if(!a){ bodyRows += '<td colspan="7"></td>'; return; }
      const color = mgrColor(mi);
      const callFrac = (a.icGood+a.icBad)>0 ? a.icGood/(a.icGood+a.icBad) : null;
      const chatFrac = (a.chatGood+a.chatBad)>0 ? a.chatGood/(a.chatGood+a.chatBad) : null;
      const total = a.icCount+a.chatCount;
      bodyRows += `<td style="background:${color.bg}66;">${a.name}${a.halfDay?' (半)':''}</td>
        <td>${a.icCount}</td>
        <td${csatCellClass(callFrac)}>${callFrac!==null?pctRT(callFrac):'-'}</td>
        <td>${a.chatCount}</td>
        <td>${chatFrac!==null?pctRT(chatFrac):'-'}</td>
        <td${belowAvgCellClass(total, mgr.groupAvg.totalAvg)}>${total}</td>
        <td${onCaseCellClass(a.onCaseSec)}>${secToHMSRT(a.onCaseSec)}</td>`;
    });
    bodyRows += '</tr>';
  }

  return `<table class="rt-merged-table">
    <thead>${h1}${h2}</thead>
    <tbody>${avgRow}${bodyRows}</tbody>
  </table>`;
}

function renderSkillSection(title, dateStr, timeStr, data){
  if(!data.managers.length){
    return `<div class="rt-skill-title"><span class="dot"></span>${title}</div><p class="rt-empty-note">目前沒有符合條件的專員資料（計入成績已勾選，且當時段已有 Call 或 Chat 產能）。</p>`;
  }
  return `<div class="rt-skill-title"><span class="dot"></span>${title}</div>
    ${renderOrgBar(dateStr, timeStr, data.orgSummary)}
    <div class="report-wrap" style="overflow-x:auto;max-height:none;">
      ${renderMergedManagersTable(data.managers, data.orgSummary)}
    </div>`;
}

let lastRealtimeData = null;

document.getElementById('btn-generate-realtime').onclick = ()=>{
  const statusEl = document.getElementById('realtime-status');
  const wbox = document.getElementById('realtime-warnings');
  try{
    if(!state.ic.rows.length && !state.chat.rows.length && !state.status.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳任何明細資料</strong>，請先到「①上傳資料」完成上傳，再回來產出即時產能。</div>`;
      document.getElementById('realtime-output').innerHTML = '';
      statusEl.textContent = '尚未上傳資料';
      return;
    }

    const {agents, emails, warnings} = buildRawAgentStats();

    const now = new Date();
    const dateStr = (now.getMonth()+1)+'/'+now.getDate();
    const timeStr = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');

    const all = emails.map(e=> extractRealtimeAgent(e, agents[e]))
      .filter(a=> a.countedInScore); // 計入成績有勾就列出來，包含當天0產能的人（顯示0）

    // BBT 優先：勾選 BBT 的人只會出現在 BBT 區塊，不會同時出現在全技能/非全技能
    const bbtList = all.filter(a=>a.bbt);
    const fullSkillList = all.filter(a=>!a.bbt && a.fullSkill);
    const nonFullSkillList = all.filter(a=>!a.bbt && !a.fullSkill);

    const fullData = summarizeSkillGroup(fullSkillList);
    const nonFullData = summarizeSkillGroup(nonFullSkillList);
    const bbtData = summarizeSkillGroup(bbtList);
    lastRealtimeData = {dateStr, timeStr, full:fullData, nonFull:nonFullData, bbt:bbtData};

    const html = renderSkillSection('全技能', dateStr, timeStr, fullData)
      + renderSkillSection('非全技能', dateStr, timeStr, nonFullData)
      + renderSkillSection('BBT', dateStr, timeStr, bbtData);

    document.getElementById('realtime-output').innerHTML = html;

    let warnHtml = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
    if(!all.length){
      warnHtml += `<div class="warn-box"><strong>目前沒有任何專員符合條件</strong>——請確認：①「③專員名單」裡至少有人「計入成績」有勾選，②上傳的明細資料裡有這些人的通數。</div>`;
    }
    wbox.innerHTML = warnHtml;
    statusEl.textContent = `已產出（${timeStr}）・全技能 ${fullSkillList.length} 人・非全技能 ${nonFullSkillList.length} 人・BBT ${bbtList.length} 人`;
  }catch(err){
    console.error('即時產能產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};

/* ============ 匯出 ============ */
function buildRealtimeExportRows(){
  const rows = [];
  function addSection(title, data){
    rows.push([title]);
    const s = data.orgSummary;
    rows.push([
      'Day', lastRealtimeData.dateStr,
      'Call產能(均)', numOrDash(s.callAvg), 'Chat產能(均)', numOrDash(s.chatAvg), 'Total產能(均)', numOrDash(s.totalAvg),
      'Call滿意度(均)', pctRT(s.callCsatAvg), 'Chat滿意度(均)', pctRT(s.chatCsatAvg),
      '文書(均)', secToHMSRT(s.onCaseAvg), '報表時間', lastRealtimeData.timeStr
    ]);
    rows.push([]);
    if(!data.managers.length){
      rows.push(['（無符合條件的專員資料）']);
      rows.push([]);
      return;
    }
    data.managers.forEach(mgr=>{
      rows.push([mgr.managerShort]);
      rows.push(['姓名','Call產能','Call滿意度','Chat產能','Chat滿意度','Total產能','文書']);
      const g = mgr.groupAvg;
      rows.push(['組平均', numOrDash(g.callAvg), pctRT(g.callCsatAvg), numOrDash(g.chatAvg), pctRT(g.chatCsatAvg), numOrDash(g.totalAvg), secToHMSRT(g.onCaseAvg)]);
      mgr.agents.forEach(a=>{
        const callFrac = (a.icGood+a.icBad)>0 ? a.icGood/(a.icGood+a.icBad) : null;
        const chatFrac = (a.chatGood+a.chatBad)>0 ? a.chatGood/(a.chatGood+a.chatBad) : null;
        rows.push([
          a.name + (a.halfDay ? '(半)' : ''),
          a.icCount, callFrac!==null ? pctRT(callFrac) : '-',
          a.chatCount, chatFrac!==null ? pctRT(chatFrac) : '-',
          a.icCount + a.chatCount, secToHMSRT(a.onCaseSec)
        ]);
      });
      rows.push([]);
    });
  }
  addSection('全技能', lastRealtimeData.full);
  addSection('非全技能', lastRealtimeData.nonFull);
  addSection('BBT', lastRealtimeData.bbt);
  return rows;
}

document.getElementById('btn-export-realtime-xlsx').onclick = ()=>{
  if(!lastRealtimeData){ alert('請先按「產出即時產能」，才會有資料可以匯出。'); return; }
  const rows = buildRealtimeExportRows();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '即時產能');
  const fname = `即時產能_${lastRealtimeData.dateStr.replace('/','-')}_${lastRealtimeData.timeStr.replace(':','')}.xlsx`;
  XLSX.writeFile(wb, fname);
};

document.getElementById('btn-export-realtime-html').onclick = ()=>{
  if(!lastRealtimeData){ alert('請先按「產出即時產能」，才會有資料可以匯出。'); return; }
  const blob = new Blob(
    ['<!DOCTYPE html><meta charset="utf-8"><title>即時產能</title>' + document.getElementById('realtime-output').innerHTML],
    {type:'text/html'}
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `即時產能_${lastRealtimeData.dateStr.replace('/','-')}_${lastRealtimeData.timeStr.replace(':','')}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=> URL.revokeObjectURL(url), 1000);
};
