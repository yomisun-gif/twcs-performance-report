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
function avgOrNull(sum, n){ return n>0 ? sum/n : null; }
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
    fullSkill: a.fullSkill, halfDay: a.halfDay, countedInScore: a.countedInScore,
    icCount: a.icCount||0, chatCount: a.chatCount||0,
    icGood: a.icGood||0, icBad: a.icBad||0,
    chatGood: a.chatGood||0, chatBad: a.chatBad||0,
    onCaseSec
  };
}

// 依技能分類彙總：回傳 { orgSummary, managers: [{managerShort, groupAvg, agents}] }
function summarizeSkillGroup(list){
  // list 是「計入成績」的全部人（含當天0產能的人，用來顯示列表）
  // 但組平均/全隊平均只能算「有成績」的人，不然沒上班的0會拉低平均
  const byManager = {};
  const managerOrder = [];
  list.forEach(a=>{
    const key = a.managerShort || '(未設定)';
    if(!byManager[key]){ byManager[key] = []; managerOrder.push(key); }
    byManager[key].push(a);
  });

  function computeGroupStats(group){
    // 有成績 = Call 或 Chat 任一有數字就算，不管半天與否
    const scored = group.filter(a => (a.icCount + a.chatCount) > 0);
    const n = scored.length;
    const halfN = scored.filter(a=>a.halfDay).length;
    const effN = n - halfN*0.5;
    const callSum = scored.reduce((s,a)=>s+a.icCount,0);
    const chatSum = scored.reduce((s,a)=>s+a.chatCount,0);
    const totalSum = callSum+chatSum;
    const onCaseSum = scored.reduce((s,a)=>s+a.onCaseSec,0);

    const callPctList = scored.filter(a=>(a.icGood+a.icBad)>0).map(a=>a.icGood/(a.icGood+a.icBad));
    const chatPctList = scored.filter(a=>(a.chatGood+a.chatBad)>0).map(a=>a.chatGood/(a.chatGood+a.chatBad));
    const callCsatAvg = callPctList.length ? callPctList.reduce((s,v)=>s+v,0)/callPctList.length : null;
    const chatCsatAvg = chatPctList.length ? chatPctList.reduce((s,v)=>s+v,0)/chatPctList.length : null;

    return {
      n, halfN, effN,
      callAvg: avgOrNull(callSum, effN), chatAvg: avgOrNull(chatSum, effN), totalAvg: avgOrNull(totalSum, effN),
      callCsatAvg, chatCsatAvg,
      onCaseAvg: n>0 ? onCaseSum/n : null
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

function renderManagerTable(mgr, orgSummary, index){
  const g = mgr.groupAvg;
  const color = mgrColor(index);
  const avgRow = `<tr class="rt-avg-row">
    <td>組平均</td>
    <td${belowAvgCellClass(g.callAvg, orgSummary.callAvg)}>${numOrDash(g.callAvg)}</td>
    <td${csatCellClass(g.callCsatAvg)}>${pctRT(g.callCsatAvg)}</td>
    <td${belowAvgCellClass(g.chatAvg, orgSummary.chatAvg)}>${numOrDash(g.chatAvg)}</td>
    <td${csatCellClass(g.chatCsatAvg)}>${pctRT(g.chatCsatAvg)}</td>
    <td${belowAvgCellClass(g.totalAvg, orgSummary.totalAvg)}>${numOrDash(g.totalAvg)}</td>
    <td${onCaseCellClass(g.onCaseAvg||0)}>${secToHMSRT(g.onCaseAvg)}</td>
  </tr>`;
  const agentRows = mgr.agents.map(a=>{
    const callFrac = (a.icGood+a.icBad)>0 ? a.icGood/(a.icGood+a.icBad) : null;
    const chatFrac = (a.chatGood+a.chatBad)>0 ? a.chatGood/(a.chatGood+a.chatBad) : null;
    const total = a.icCount+a.chatCount;
    return `<tr>
      <td>${a.name}${a.halfDay?' (半)':''}</td>
      <td${belowAvgCellClass(a.icCount, g.callAvg)}>${a.icCount}</td>
      <td${csatCellClass(callFrac)}>${callFrac!==null?pctRT(callFrac):'-'}</td>
      <td${belowAvgCellClass(a.chatCount, g.chatAvg)}>${a.chatCount}</td>
      <td${csatCellClass(chatFrac)}>${chatFrac!==null?pctRT(chatFrac):'-'}</td>
      <td${belowAvgCellClass(total, g.totalAvg)}>${total}</td>
      <td${onCaseCellClass(a.onCaseSec)}>${secToHMSRT(a.onCaseSec)}</td>
    </tr>`;
  }).join('');
  return `<table class="rt-mgr-table">
    <thead>
      <tr><th class="rt-mgr-name" colspan="7" style="background:${color.bg};color:${color.text};">${mgr.managerShort}</th></tr>
      <tr><th>姓名</th><th>Call產能</th><th>Call滿意度</th><th>Chat產能</th><th>Chat滿意度</th><th>Total產能</th><th>文書</th></tr>
    </thead>
    <tbody>${avgRow}${agentRows}</tbody>
  </table>`;
}

function renderSkillSection(title, dateStr, timeStr, list){
  if(!list.length){
    return `<div class="rt-skill-title"><span class="dot"></span>${title}</div><p class="rt-empty-note">目前沒有符合條件的專員資料（計入成績已勾選，且當時段已有 Call 或 Chat 產能）。</p>`;
  }
  const {orgSummary, managers} = summarizeSkillGroup(list);
  const mgrTables = managers.map((mgr,i)=> renderManagerTable(mgr, orgSummary, i)).join('');
  return `<div class="rt-skill-title"><span class="dot"></span>${title}</div>
    ${renderOrgBar(dateStr, timeStr, orgSummary)}
    <div class="rt-managers-row">${mgrTables}</div>`;
}

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

    const fullSkillList = all.filter(a=>a.fullSkill);
    const nonFullSkillList = all.filter(a=>!a.fullSkill);

    const html = renderSkillSection('全技能', dateStr, timeStr, fullSkillList)
      + renderSkillSection('非全技能', dateStr, timeStr, nonFullSkillList);

    document.getElementById('realtime-output').innerHTML = html;

    let warnHtml = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
    if(!all.length){
      warnHtml += `<div class="warn-box"><strong>目前沒有任何專員符合條件</strong>——請確認：①「③專員名單」裡至少有人「計入成績」有勾選，②上傳的明細資料裡有這些人的通數。</div>`;
    }
    wbox.innerHTML = warnHtml;
    statusEl.textContent = `已產出（${timeStr}）・全技能 ${fullSkillList.length} 人・非全技能 ${nonFullSkillList.length} 人`;
  }catch(err){
    console.error('即時產能產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};
