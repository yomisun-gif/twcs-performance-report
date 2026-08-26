/* ============================================================
   report-devvars.js — 🧪 隱藏測試分頁：CALL 自訂變數系統
   只有網址帶 ?dev=1 才會顯示這個分頁，一般使用者完全看不到、
   不會誤點。這是「Phase 1」：把現在寫死在 engine.js 裡的欄位，
   變成使用者可以自訂名稱、自訂對應的變數，預設值＝現行邏輯，
   公式本身這次還沒開放自訂（ACD/ACW/AHT怎麼算還是寫死的）。

   完全獨立成自己一份：
   - 直接讀 state.ic/chat/status.rows（沿用①上傳資料的機制，不重傳）
   - 不改 state.ic.map 等正式的②欄位對應，自己另外存一份 dvVars
   - 不改 engine.js / report-daily.js 任何一行
   算出來的結果會跟 computeReport()（正式日報表）並排比對，
   驗證「變數化」這層本身有沒有算錯。
   ============================================================ */

// ---- 顯示/隱藏這個分頁：只有網址帶 ?dev=1 才顯示 ----
(function(){
  const isDev = new URLSearchParams(location.search).get('dev') === '1';
  if(isDev){
    document.querySelectorAll('.dev-only').forEach(el=> el.style.display = '');
  }
})();

// ---- 預設變數清單：varName 對應現行 engine.js REQ 的哪個 key（用來預填目前正式站已經抓好的欄位） ----
const DV_DEFAULT_VARS = {
  ic: [
    {varName:'ic_email',        reqKey:'last_agent_email', label:'Last Agent Email（決定產能/ACD歸屬）'},
    {varName:'ic_call_status',  reqKey:'call_status',      label:'Call Status（值＝Missed 的整筆排除）'},
    {varName:'ic_is_answered',  reqKey:'is_answered',      label:'Is Answered（決定要不要算入ACD）'},
    {varName:'ic_csat',         reqKey:'csat',             label:'CSAT（滿意度評價文字）'},
    {varName:'ic_end_time',     reqKey:'call_end_time',    label:'Call End Time'},
    {varName:'ic_routed_time',  reqKey:'last_routed_time', label:'Last Routed to Agent Time'}
  ],
  chat: [
    {varName:'chat_owner', reqKey:'chat_owner', label:'Chat Owner（決定產能歸屬）'},
    {varName:'chat_csat',  reqKey:'csat',       label:'CSAT Level（滿意度評價文字，完全比對）'}
  ],
  status: [
    {varName:'status_email', reqKey:'email',          label:'Agent Email'},
    {varName:'status_sub',   reqKey:'sub_status',     label:'Sub Status（子狀態文字）'},
    {varName:'status_start', reqKey:'start_datetime', label:'Status Start Time'},
    {varName:'status_end',   reqKey:'end_datetime',   label:'Status End Time'}
  ]
};

// 目前使用者手上這份變數設定：{ic:[{varName,header}], chat:[...], status:[...]}
// header 是「實際檔案裡的欄位表頭文字」，不是內部代碼
let dvVars = {ic:[], chat:[], status:[]};

// ---- Phase 2：篩選規則。預設＝現行邏輯（IC的 Call Status=Missed 排除）----
// 每條規則：{id, source:'ic'|'chat', varName, operator:'equals'|'not_equals'|'contains', value}
// 符合規則的整筆資料直接排除，不計入任何計算。Status Log 的跨日/EndTime=0
// 排除規則性質不同（比較兩個日期，不是欄位比對值），這次不放進來，維持原本 classifyStatusRow 的寫法。
let dvRuleIdCounter = 1;
let dvRules = [];

function dvBuildDefaultRules(){
  dvRuleIdCounter = 1;
  return [
    {id: dvRuleIdCounter++, source:'ic', varName:'ic_call_status', operator:'equals', value:'Missed'}
  ];
}

function dvRuleMatches(row, rule, varMap){
  const header = varMap[rule.varName];
  if(!header) return false; // 變數沒對應到欄位，這條規則視為不生效，不是誤排除全部資料
  const cellVal = String(row[header]||'').trim().toLowerCase();
  const ruleVal = String(rule.value||'').trim().toLowerCase();
  if(rule.operator === 'equals') return cellVal === ruleVal;
  if(rule.operator === 'not_equals') return cellVal !== ruleVal;
  if(rule.operator === 'contains') return ruleVal !== '' && cellVal.includes(ruleVal);
  return false;
}

// 這一列在該 source 底下，有沒有符合「任何一條」排除規則
function dvRowExcluded(row, source, varMap){
  return dvRules.some(rule => rule.source === source && dvRuleMatches(row, rule, varMap));
}

function dvRenderRuleEditor(){
  const container = document.getElementById('devvars-rules-list');
  const srcLabel = {ic:'IC', chat:'Chat'};
  const opLabel = {equals:'等於', not_equals:'不等於', contains:'包含'};
  container.innerHTML = dvRules.map(rule=>{
    const varOptions = (dvVars[rule.source]||[]).map(v=>
      `<option value="${v.varName}" ${v.varName===rule.varName?'selected':''}>${v.varName}</option>`
    ).join('');
    const opOptions = Object.keys(opLabel).map(op=>
      `<option value="${op}" ${op===rule.operator?'selected':''}>${opLabel[op]}</option>`
    ).join('');
    return `<div class="dv-rule-row" data-ruleid="${rule.id}">
      <select class="dv-rule-source" data-ruleid="${rule.id}">
        <option value="ic" ${rule.source==='ic'?'selected':''}>IC</option>
        <option value="chat" ${rule.source==='chat'?'selected':''}>Chat</option>
      </select>
      <select class="dv-rule-var" data-ruleid="${rule.id}">${varOptions}</select>
      <select class="dv-rule-op" data-ruleid="${rule.id}">${opOptions}</select>
      <input type="text" class="dv-rule-value" data-ruleid="${rule.id}" value="${rule.value||''}" placeholder="比對值">
      <span class="hint" style="margin:0;">符合就整筆排除</span>
      <button type="button" class="btn-row-del" data-ruleid="${rule.id}" title="刪除此規則">✕</button>
    </div>`;
  }).join('') || '<p class="hint">目前沒有任何篩選規則，所有資料都會被計入。</p>';

  container.querySelectorAll('.dv-rule-source').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      const rule = dvRules.find(r=>r.id==sel.dataset.ruleid);
      rule.source = sel.value;
      rule.varName = (dvVars[rule.source]||[])[0] ? dvVars[rule.source][0].varName : '';
      dvRenderRuleEditor();
    });
  });
  container.querySelectorAll('.dv-rule-var').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      dvRules.find(r=>r.id==sel.dataset.ruleid).varName = sel.value;
    });
  });
  container.querySelectorAll('.dv-rule-op').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      dvRules.find(r=>r.id==sel.dataset.ruleid).operator = sel.value;
    });
  });
  container.querySelectorAll('.dv-rule-value').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      dvRules.find(r=>r.id==inp.dataset.ruleid).value = inp.value;
    });
  });
  container.querySelectorAll('.btn-row-del').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      dvRules = dvRules.filter(r=>r.id != btn.dataset.ruleid);
      dvRenderRuleEditor();
    });
  });
}

document.getElementById('btn-devvars-add-rule').onclick = ()=>{
  const defaultVar = (dvVars.ic||[])[0] ? dvVars.ic[0].varName : '';
  dvRules.push({id: dvRuleIdCounter++, source:'ic', varName: defaultVar, operator:'equals', value:''});
  dvRenderRuleEditor();
};

function dvBuildDefault(){
  const out = {};
  ['ic','chat','status'].forEach(src=>{
    out[src] = DV_DEFAULT_VARS[src].map(def=>{
      const mappedHeader = state[src].map ? state[src].map[def.reqKey] : null;
      return {varName: def.varName, header: mappedHeader || '', hint: def.label};
    });
  });
  return out;
}

document.getElementById('btn-devvars-init').onclick = ()=>{
  dvVars = dvBuildDefault();
  dvRules = dvBuildDefaultRules();
  dvRenderVarEditors();
  dvRenderRuleEditor();
  document.getElementById('devvars-status').textContent = '已載入目前①上傳資料的欄位（預設對應現行邏輯）';
};

document.getElementById('btn-devvars-reset').onclick = ()=>{
  dvVars = dvBuildDefault();
  dvRules = dvBuildDefaultRules();
  dvRenderVarEditors();
  dvRenderRuleEditor();
  document.getElementById('devvars-status').textContent = '已還原成預設值（現行邏輯對應的欄位與規則）';
};

function dvRenderVarEditors(){
  const srcTitle = {ic:'Internet Call 明細', chat:'Chat 明細', status:'Status Log 明細'};
  ['ic','chat','status'].forEach(src=>{
    const container = document.getElementById(`devvars-${src}-vars`);
    const headers = state[src].headers || [];
    const rowsHtml = (dvVars[src]||[]).map((v, idx)=>{
      const options = ['<option value="">（未對應）</option>'].concat(
        headers.map(h=> `<option value="${h}" ${h===v.header?'selected':''}>${h}</option>`)
      ).join('');
      return `<div class="dv-var-row">
        <input type="text" class="dv-varname" data-src="${src}" data-idx="${idx}" value="${v.varName}">
        <span>→</span>
        <select class="dv-header-select" data-src="${src}" data-idx="${idx}">${options}</select>
        <span class="hint" style="margin:0;">${v.hint||''}</span>
      </div>`;
    }).join('');
    container.innerHTML = `<div class="dv-var-source-title">${srcTitle[src]}${!headers.length ? '（尚未上傳，請先到①上傳資料）' : ''}</div>${rowsHtml}`;
  });

  document.querySelectorAll('.dv-varname').forEach(inp=>{
    inp.addEventListener('input', ()=>{
      dvVars[inp.dataset.src][inp.dataset.idx].varName = inp.value.trim();
    });
  });
  document.querySelectorAll('.dv-header-select').forEach(sel=>{
    sel.addEventListener('change', ()=>{
      dvVars[sel.dataset.src][sel.dataset.idx].header = sel.value;
    });
  });
}

// 把 dvVars[src] 陣列轉成 {varName: header} 方便查找
function dvVarMap(src){
  const m = {};
  (dvVars[src]||[]).forEach(v=>{ if(v.varName) m[v.varName] = v.header; });
  return m;
}

// ---- 用自訂變數重新算一次，邏輯完全比照 engine.js 現行公式，只是欄位來源改用變數對應 ----
function dvComputeWithVars(){
  const icMap = dvVarMap('ic');
  const chatMap = dvVarMap('chat');
  const statusMap = dvVarMap('status');

  const agents = {};
  function ensure(e){
    if(!agents[e]) agents[e] = {
      icCount:0, icGood:0, icBad:0, acdSum:0, acdCount:0,
      chatCount:0, chatGood:0, chatBad:0,
      onCaseSec:0
    };
    return agents[e];
  }

  // IC：套用「篩選規則」（預設＝Call Status=Missed排除），其餘比照現行邏輯
  state.ic.rows.forEach(r=>{
    const e = String(r[icMap.ic_email]||'').toLowerCase().trim();
    if(!e) return;
    if(dvRowExcluded(r, 'ic', icMap)) return;
    const a = ensure(e);
    a.icCount++;
    if(isYes(r[icMap.ic_is_answered])){
      const dur = secBetween(r[icMap.ic_routed_time], r[icMap.ic_end_time]);
      if(dur!==null){ a.acdSum += dur; a.acdCount++; }
    }
    const csat = String(r[icMap.ic_csat]||'').trim();
    if(/good/i.test(csat)) a.icGood++;
    else if(/bad/i.test(csat)) a.icBad++;
  });

  // Chat：套用「篩選規則」（預設＝空，沿用現行邏輯無排除），CSAT完全比對
  state.chat.rows.forEach(r=>{
    const e = String(r[chatMap.chat_owner]||'').toLowerCase().trim();
    if(!e) return;
    if(dvRowExcluded(r, 'chat', chatMap)) return;
    const a = ensure(e);
    a.chatCount++;
    const csat = String(r[chatMap.chat_csat]||'').trim().toLowerCase();
    if(csat === 'good') a.chatGood++;
    else if(csat === 'bad') a.chatBad++;
  });

  // Status Log：重用全域 classifyStatusRow()（跨日/EndTime=0排除規則），只算 on_case 秒數（ACW用）
  const stMapForClassify = {
    email: statusMap.status_email, sub_status: statusMap.status_sub,
    start_datetime: statusMap.status_start, end_datetime: statusMap.status_end
  };
  state.status.rows.forEach(r=>{
    const e = String(r[stMapForClassify.email]||'').toLowerCase().trim();
    if(!e) return;
    const cls = classifyStatusRow(r, stMapForClassify);
    if(!cls.included || cls.code !== 'on_case') return;
    const dur = secBetween(r[stMapForClassify.start_datetime], r[stMapForClassify.end_datetime]);
    if(dur!==null) ensure(e).onCaseSec += dur;
  });

  const result = {};
  Object.keys(agents).forEach(e=>{
    const a = agents[e];
    const totalProduction = a.icCount + a.chatCount;
    const acw = totalProduction ? a.onCaseSec / totalProduction : null;
    const acd = a.acdCount ? a.acdSum/a.acdCount : null;
    const aht = (acd!==null && acw!==null) ? acd+acw : null;
    result[e] = {
      icCount: a.icCount || 0,
      acd: a.icCount ? (acd!==null?secToHMS(acd):'-') : '-',
      acw: totalProduction ? (acw!==null?secToHMS(acw):'-') : '-',
      aht: a.icCount ? (aht!==null?secToHMS(aht):'-') : '-',
      icCsat: (a.icGood+a.icBad) ? pct(a.icGood, a.icGood+a.icBad) : '-',
      icCsatRate: a.icCount ? pct(a.icGood+a.icBad, a.icCount) : '-',
      chatCount: a.chatCount || 0,
      chatCsat: (a.chatGood+a.chatBad) ? pct(a.chatGood, a.chatGood+a.chatBad) : '-'
    };
  });
  return result;
}

document.getElementById('btn-devvars-run').onclick = ()=>{
  const statusEl = document.getElementById('devvars-status');
  const wbox = document.getElementById('devvars-warnings');
  try{
    if(!state.ic.rows.length && !state.chat.rows.length && !state.status.rows.length){
      wbox.innerHTML = `<div class="warn-box"><strong>尚未上傳任何明細資料</strong>，請先到「①上傳資料」完成上傳。</div>`;
      statusEl.textContent = '尚未上傳資料';
      return;
    }
    if(!dvVars.ic.length){
      wbox.innerHTML = `<div class="warn-box"><strong>請先按「載入目前欄位」，才會有變數可以計算。</strong></div>`;
      return;
    }

    const dvResult = dvComputeWithVars();
    const {rows: officialRows} = computeReport();

    const tbl = document.getElementById('devvars-compare-table');
    let mismatchCount = 0;
    const bodyRows = officialRows.map(r=>{
      const dv = dvResult[r.email] || {icCount:0, acd:'-', acw:'-', aht:'-', icCsat:'-', icCsatRate:'-', chatCount:0, chatCsat:'-'};
      const officialIcCount = typeof r.icCount==='number' ? r.icCount : 0;
      const officialChatCount = typeof r.chatCount==='number' ? r.chatCount : 0;

      function cell(dvVal, officialVal){
        const same = String(dvVal) === String(officialVal);
        if(!same) mismatchCount++;
        return `<td${same?'':' class="cell-alert"'}>${dvVal}<br><span class="hint" style="margin:0;">正式:${officialVal}</span></td>`;
      }

      return `<tr>
        <td style="text-align:left;">${r.name}</td>
        ${cell(dv.icCount, officialIcCount)}
        ${cell(dv.acd, r.acd)}
        ${cell(dv.acw, r.acw)}
        ${cell(dv.aht, r.aht)}
        ${cell(dv.icCsat, r.icCsat)}
        ${cell(dv.icCsatRate, r.icCsatRate)}
        ${cell(dv.chatCount, officialChatCount)}
        ${cell(dv.chatCsat, r.chatCsat)}
      </tr>`;
    }).join('');

    tbl.innerHTML = `<thead><tr>
        <th>Agent</th><th>Call產能</th><th>ACD</th><th>ACW</th><th>AHT</th><th>Call滿意度</th><th>Call回收率</th><th>Chat產能</th><th>Chat滿意度</th>
      </tr></thead><tbody>${bodyRows}</tbody>`;

    wbox.innerHTML = '';
    statusEl.textContent = mismatchCount === 0
      ? `✅ 完全一致，共比對 ${officialRows.length} 人、0 處不同`
      : `⚠️ 共 ${mismatchCount} 個儲存格跟正式報表不一致，請檢查上方變數對應`;
  }catch(err){
    console.error('自訂變數計算失敗：', err);
    statusEl.textContent = '計算失敗：' + err.message;
    wbox.innerHTML = `<div class="warn-box"><strong>發生錯誤：</strong>${err.message}（詳細內容請按F12看Console）</div>`;
  }
};
