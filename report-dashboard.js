/* ============================================================
   report-dashboard.js — 報表樣板：產能儀表板（排行榜 + SeaTalk 公告文字）
   吃 buildRawAgentStats() 的原始數據，跟 report-daily.js / report-realtime.js
   完全獨立，互不影響。
   ============================================================ */

const DEFAULT_BOILERPLATE =
`※滿意度、文書、狀態時間反紅的朋友，再請多留意 💪
※明細請參閱：💯每日成績(各項) → [請填入您的成績表連結]
---------------------------
📌 文書亮燈+嚴重超時的夥伴請加快作業，減少 Case 處理時間，異常或離線記得回報喔
📌 用餐或休息超時的朋朋請主動補回，並截圖回報職代
📌 外撥請使用 IHS 登入小Pu，若因登 Purecloud 跳離線，請手動調整狀態（除下班後外撥）
📌 雙渠道進CHAT時若需切話後，務必PO組上群組回報原因
📌 下班前記得切離線`;

async function loadBoilerplate(){
  const saved = await storageGet('dashboard_boilerplate');
  document.getElementById('dashboard-boilerplate').value = (saved !== null && saved !== undefined) ? saved : DEFAULT_BOILERPLATE;
}
loadBoilerplate();

document.getElementById('btn-save-boilerplate').onclick = async ()=>{
  await storageSet('dashboard_boilerplate', document.getElementById('dashboard-boilerplate').value);
  alert('已儲存提醒事項內容');
};

function rankTableHTML(title, list){
  const rows = list.map((a,i)=>`<tr><td>${a.name}</td><td>${a.total}</td></tr>`).join('');
  return `<table class="rank-table">
    <thead><tr><th colspan="2">${title}</th></tr><tr><th>姓名</th><th>總產能SUM</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="2" class="rt-empty-note">無資料</td></tr>'}</tbody>
  </table>`;
}

let lastDashboardLists = {all:[], full:[], nonFull:[]};

document.getElementById('btn-generate-dashboard').onclick = ()=>{
  const statusEl = document.getElementById('dashboard-status');
  const wbox = document.getElementById('dashboard-warnings');
  try{
    if(!state.ic.rows.length && !state.chat.rows.length && !state.status.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳任何明細資料</strong>，請先到「①上傳資料」完成上傳。</div>`;
      document.getElementById('dashboard-rank-output').innerHTML = '';
      statusEl.textContent = '尚未上傳資料';
      return;
    }

    const {agents, emails, warnings} = buildRawAgentStats();

    const all = emails.map(e=>{
      const a = agents[e];
      return {
        name: a.name || e, fullSkill: a.fullSkill,
        total: (a.icCount||0) + (a.chatCount||0)
      };
    }).filter(a=> a.total > 0).sort((x,y)=> y.total - x.total);

    const fullList = all.filter(a=>a.fullSkill);
    const nonFullList = all.filter(a=>!a.fullSkill);
    lastDashboardLists = {all, full:fullList, nonFull:nonFullList};

    document.getElementById('dashboard-rank-output').innerHTML =
      `<div class="rank-columns">
        ${rankTableHTML('*ALL', all)}
        ${rankTableHTML('全技能', fullList)}
        ${rankTableHTML('單技能', nonFullList)}
      </div>`;

    wbox.innerHTML = warnings.length ? `<div class="warn-box"><strong>提醒：</strong><br>${warnings.join('<br>')}</div>` : '';
    statusEl.textContent = `已產出・共 ${all.length} 人有產能（全技能 ${fullList.length} / 單技能 ${nonFullList.length}）`;

    buildAnnounceText();
  }catch(err){
    console.error('產能儀表板產出失敗：', err);
    statusEl.textContent = '產出失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};

function medalLines(list, label){
  const medals = ['🥇','🥈','🥉'];
  const ranks = ['第一','第二','第三'];
  if(!list.length) return `【${label}】\n（無資料）`;
  const lines = list.slice(0,3).map((a,i)=> `${medals[i]}通數${ranks[i]}：${a.name}`);
  return `【${label}】\n${lines.join('\n')}`;
}

function buildAnnounceText(){
  const dateVal = document.getElementById('report-date') ? document.getElementById('report-date').value : '';
  let dateStr = '';
  if(dateVal){
    const d = new Date(dateVal+'T00:00:00');
    if(!isNaN(d)) dateStr = (d.getMonth()+1)+'/'+d.getDate();
  }
  if(!dateStr){
    const now = new Date();
    dateStr = (now.getMonth()+1)+'/'+now.getDate();
  }

  const boilerplate = document.getElementById('dashboard-boilerplate').value;
  const text =
`@所有人  ${dateStr} 產能成績如下

${medalLines(lastDashboardLists.full, '全技能')}

${medalLines(lastDashboardLists.nonFull, '非全技能')}

${boilerplate}`;

  document.getElementById('dashboard-announce-output').value = text;
}

document.getElementById('dashboard-boilerplate').addEventListener('input', ()=>{
  if(lastDashboardLists.all.length || lastDashboardLists.full.length || lastDashboardLists.nonFull.length){
    buildAnnounceText();
  }
});

document.getElementById('btn-copy-announce').onclick = async ()=>{
  const el = document.getElementById('dashboard-announce-output');
  const copyStatus = document.getElementById('copy-status');
  if(!el.value.trim()){
    alert('請先按「產出排行榜」，才會有內容可以複製。');
    return;
  }
  try{
    await navigator.clipboard.writeText(el.value);
    copyStatus.textContent = '已複製到剪貼簿 ✓';
  }catch(err){
    // 部分瀏覽器環境不允許 clipboard API，改用傳統選取複製法當備援
    el.removeAttribute('readonly');
    el.focus();
    el.select();
    try{
      document.execCommand('copy');
      copyStatus.textContent = '已複製到剪貼簿 ✓';
    }catch(err2){
      copyStatus.textContent = '複製失敗，請手動選取文字複製';
    }
    el.setAttribute('readonly', 'readonly');
  }
};
