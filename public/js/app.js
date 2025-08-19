// General frontend: files list, upload, follow, like, comments, admin tools
async function api(url, data, method='POST'){
  const res = await fetch(url, {
    method, headers: { 'Content-Type':'application/json' }, credentials:'include',
    body: method==='GET'? undefined : JSON.stringify(data||{})
  });
  return res.json();
}

function el(sel){ return document.querySelector(sel); }
function els(sel){ return Array.from(document.querySelectorAll(sel)); }

async function initNav(){
  const user = await (await fetch('/api/auth/me', {credentials:'include'})).json().then(d=>d.ok?d.user:null).catch(()=>null);
  const loginBtns = els('[data-guest]');
  const userBtns = els('[data-user]');
  loginBtns.forEach(b => b.style.display = user ? 'none' : '');
  userBtns.forEach(b => b.style.display = user ? '' : 'none');

  if (user) {
    const nameEl = el('#nav-username');
    if (nameEl) nameEl.textContent = user.displayName || user.username;
    const badge = el('#nav-badge');
    if (badge && user.username === 'james') badge.style.display = '';
  }
}

async function loadFiles(){
  const out = await api('/api/files/list', {}, 'GET');
  if(!out.ok) return;
  const wrap = el('#files');
  if(!wrap) return;
  wrap.innerHTML='';
  out.files.forEach(f=>{
    const div = document.createElement('div');
    div.className='card file raise';
    div.innerHTML = `
      <div class="title">${escapeHtml(f.title)}</div>
      <div class="meta">by ${escapeHtml(f.owner?.displayName || f.owner?.username || 'unknown')} · ${new Date(f.createdAt).toLocaleString()}</div>
      <div>${escapeHtml(f.description)}</div>
      <div class="grid cols-3">
        <button class="btn secondary" data-like="${f.id}">❤️ ${f.likes}</button>
        <button class="btn secondary" data-comment="${f.id}">💬 ${f.comments}</button>
        <a class="btn" href="${f.zipUrl || '#'}" target="_blank" rel="noopener">⬇️ Download ZIP</a>
      </div>
    `;
    wrap.appendChild(div);
  });

  wrap.addEventListener('click', async (e)=>{
    const likeId = e.target.closest('[data-like]')?.getAttribute('data-like');
    const cId = e.target.closest('[data-comment]')?.getAttribute('data-comment');
    if (likeId){
      const r = await api('/api/files/like', { fileId: likeId });
      if(r.ok) loadFiles();
    } else if (cId){
      const text = prompt('Comment:');
      if (text) {
        const r = await api('/api/files/comment', { fileId: cId, text });
        if(r.ok) loadFiles();
      }
    }
  }, { once:true });
}

async function loadDevs(){
  const out = await api('/api/dev/list', {}, 'GET');
  if(!out.ok) return;
  const wrap = el('#devs');
  if(!wrap) return;
  wrap.innerHTML='';
  out.devs.forEach(d=>{
    const box = document.createElement('div');
    box.className='card raise';
    box.innerHTML = `
      <div style="display:flex; gap:16px; align-items:center">
        <img class="avatar" src="${d.avatar}" alt="">
        <div>
          <div style="font-weight:800; font-size:18px">${escapeHtml(d.username)} ${d.verified?'<span class="badge">✔ Verified</span>':''}</div>
          <div style="color:#9ec6dd; font-size:13px">${escapeHtml(d.bio||'')}</div>
          <div style="margin-top:10px">
            <button class="btn secondary" data-follow="${d.id}">+ Follow</button>
            ${d.approved?'<span class="badge">Approved</span>':'<span class="badge" style="color:#ffda85;border-color:#ffda85;background:#3a2b0d">Pending</span>'}
          </div>
        </div>
      </div>
    `;
    wrap.appendChild(box);
  });

  wrap.addEventListener('click', async (e)=>{
    const id = e.target.closest('[data-follow]')?.getAttribute('data-follow');
    if(id){
      const r = await api(`/api/follow/${id}`, {}, 'POST');
      if(r.ok) alert('Followed');
    }
  }, { once:true });
}

async function handleUpload(){
  const form = el('#uploadForm'); if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const title = el('#up-title').value.trim();
    const description = el('#up-desc').value.trim();
    const zipUrl = el('#up-url').value.trim();
    const r = await api('/api/files/upload', { title, description, zipUrl });
    if(!r.ok) alert(r.error||'Upload failed');
    else { alert('Uploaded'); loadFiles(); form.reset(); }
  });
}

async function profileForm(){
  const form = el('#profileForm'); if(!form) return;
  form.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const displayName = el('#displayName').value.trim();
    const bio = el('#bio').value.trim();
    const avatar = el('#avatar').value.trim(); // URL
    const r = await api('/api/dev/profile', { displayName, bio, avatar });
    if(r.ok){ alert('Profile updated'); location.reload(); }
    else alert(r.error||'Error');
  });
}

async function adminPanel(){
  const statsBox = el('#stats'); if(!statsBox) return;
  const stats = await api('/api/admin/stats', {}, 'GET');
  if(stats.ok){
    statsBox.textContent = JSON.stringify(stats.totals, null, 2);
  }
  const reportsWrap = el('#reports');
  if (reportsWrap){
    const r = await api('/api/admin/reports', {}, 'GET');
    if(r.ok){
      reportsWrap.innerHTML = '';
      r.reports.forEach(rep=>{
        const div = document.createElement('div');
        div.className='card';
        div.innerHTML = `
          <div><b>File:</b> ${rep.fileId}</div>
          <div><b>Reason:</b> ${escapeHtml(rep.reason)}</div>
          <div style="margin-top:8px"><button class="btn danger" data-del="${rep.fileId}">Delete File</button></div>
        `;
        reportsWrap.appendChild(div);
      });
      reportsWrap.addEventListener('click', async (e)=>{
        const id = e.target.closest('[data-del]')?.getAttribute('data-del');
        if(id){
          const ok = confirm('Delete this file?');
          if(ok){
            const r2 = await api('/api/admin/delete-file', { fileId:id });
            if(r2.ok){ alert('Deleted'); adminPanel(); }
          }
        }
      }, { once:true });
    }
  }

  // Approve developer form
  const approve = el('#approveForm');
  if (approve){
    approve.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const devId = el('#approveId').value.trim();
      const r = await api('/api/admin/approve-dev', { devId });
      alert(r.ok ? 'Approved' : (r.error||'Error'));
    });
  }

  // Verify developer form
  const verify = el('#verifyForm');
  if (verify){
    verify.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const devId = el('#verifyId').value.trim();
      const r = await api('/api/admin/verify', { devId });
      alert(r.ok ? 'Verified' : (r.error||'Error'));
    });
  }

  // Create verified
  const createV = el('#createVForm');
  if (createV){
    createV.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const username = el('#v-username').value.trim();
      const password = el('#v-password').value.trim();
      const followersBoost = Number(el('#v-boost').value||'0');
      const r = await api('/api/admin/create-verified', { username, password, followersBoost });
      alert(r.ok ? 'Created' : (r.error||'Error'));
    });
  }
}

function escapeHtml(s=''){
  return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

document.addEventListener('DOMContentLoaded', ()=>{
  initNav();
  loadFiles();
  loadDevs();
  handleUpload();
  profileForm();
  adminPanel();
});