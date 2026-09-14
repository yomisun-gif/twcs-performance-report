/* ============================================================
   announcement.js — 更新公告 Modal
   每次改版有新公告時，換一個新的 ANNOUNCEMENT_ID（例如日期或功能名），
   舊的「不再顯示」紀錄不會影響新公告，新公告一樣會再跳出來一次。
   儲存邏輯沿用 engine.js 的 storageGet/storageSet（優先 Claude artifact
   storage，否則自動退回 localStorage），跟②③分頁的持久化是同一套。
   ============================================================ */

const ANNOUNCEMENT_ID = 'iact_support_2026-09-15';

(async ()=>{
  const overlay = document.getElementById('announcement-overlay');
  const closeBtn = document.getElementById('announcement-close');
  const dontShowBox = document.getElementById('announcement-dont-show');
  if(!overlay || !closeBtn) return;

  const dismissed = await storageGet('ann_dismissed_' + ANNOUNCEMENT_ID);
  if(dismissed === '1') return;

  overlay.style.display = 'flex';

  closeBtn.onclick = async ()=>{
    overlay.style.display = 'none';
    if(dontShowBox.checked){
      await storageSet('ann_dismissed_' + ANNOUNCEMENT_ID, '1');
    }
  };
})();
