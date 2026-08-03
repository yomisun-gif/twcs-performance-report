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
  const byManager = {};
  list.forEach(a=>{
    const key = a.managerShort || '(未設定)';
    if(!byManager[key]) byManager[key] = [];
    byManager[key].push(a);
  });

  function computeGroupStats(group){
    const n = group.length;
    const halfN = group.filter(a=>a.halfDay).length;
    const effN = n - halfN*0.5;
    const callSum = group.reduce((s,a)=>s+a.icCount,0);
    const chatSum = group.reduce((s,a)=>s+a.chatCount,0);
    const totalSum = callSum+chatSum;
    const onCaseSum = group.reduce((s,a)=>s+a.onCaseSec,0);

    const callPctList = group.filter(a=>(a.icGood+a.icBad)>0).map(a=>a.icGood/(a.icGood+a.icBad));
    const chatPctList = group.filter(a=>(a.chatGood+a.chatBad)>0).map(a=>a.chatGood/(a.chatGood+a.chatBad));
    const callCsatAvg = callPctList.length ? callPctList.reduce((s,v)=>s+v,0)/callPctList.length : null;
    const chatCsatAvg = chatPctList.length ? chatPctList.reduce((s,v)=>s+v,0)/chatPctList.length : null;

    return {
      n, halfN, effN,
      callAvg: avgOrNull(callSum, effN), chatAvg: avgOrNull(chatSum, effN), totalAvg: avgOrNull(totalSum, effN),
      callCsatAvg, chatCsatAvg,
      onCaseAvg: n>0 ? onCaseSum/n : null
    };
  }

  const managers = Object.keys(byManager).sort().map(key=>({
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

function renderManagerTable(mgr){
  const g = mgr.groupAvg;
  const avgRow = `<tr class="rt-avg-row">
    <td>組平均</td>
    <td>${numOrDash(g.callAvg)}</td><td>${pctRT(g.callCsatAvg)}</td>
    <td>${numOrDash(g.chatAvg)}</td><td>${pctRT(g.chatCsatAvg)}</td>
    <td>${numOrDash(g.totalAvg)}</td><td>${secToHMSRT(g.onCaseAvg)}</td>
  </tr>`;
  const agentRows = mgr.agents.map(a=>{
    const callCsat = (a.icGood+a.icBad)>0 ? pctRT(a.icGood/(a.icGood+a.icBad)) : '-';
    const chatCsat = (a.chatGood+a.chatBad)>0 ? pctRT(a.chatGood/(a.chatGood+a.chatBad)) : '-';
    return `<tr>
      <td>${a.name}${a.halfDay?' (半)':''}</td>
      <td>${a.icCount}</td><td>${callCsat}</td>
      <td>${a.chatCount}</td><td>${chatCsat}</td>
      <td>${a.icCount+a.chatCount}</td><td>${secToHMSRT(a.onCaseSec)}</td>
    </tr>`;
  }).join('');
  return `<table class="rt-mgr-table">
    <thead>
      <tr><th class="rt-mgr-name" colspan="7">${mgr.managerShort}</th></tr>
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
  const mgrTables = managers.map(renderManagerTable).join('');
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
      .filter(a=> a.countedInScore && (a.icCount+a.chatCount)>0);

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
