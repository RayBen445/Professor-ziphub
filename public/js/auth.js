// Handles login/register and session check
async function api(url, data, method='POST'){
  const res = await fetch(url, {
    method, headers: { 'Content-Type':'application/json' }, credentials:'include',
    body: method==='GET'? undefined : JSON.stringify(data||{})
  });
  return res.json();
}

async function onRegister(e){
  e.preventDefault();
  const username = document.querySelector('#username').value.trim();
  const password = document.querySelector('#password').value.trim();
  const role = document.querySelector('#role').value;
  const out = await api('/api/auth/register', { username, password, role });
  const msg = document.querySelector('#msg'); msg.textContent='';
  if(!out.ok){ msg.textContent = out.error || 'Error'; msg.style.color='#ff8ea3'; return; }
  location.href = '/html/dashboard.html';
}

async function onLogin(e){
  e.preventDefault();
  const username = document.querySelector('#username').value.trim();
  const password = document.querySelector('#password').value.trim();
  const out = await api('/api/auth/login', { username, password });
  const msg = document.querySelector('#msg'); msg.textContent='';
  if(!out.ok){ msg.textContent = out.error || 'Error'; msg.style.color='#ff8ea3'; return; }
  location.href = '/html/dashboard.html';
}

async function requireAuth(){
  const res = await fetch('/api/auth/me', { credentials:'include' });
  const data = await res.json();
  if(!data.ok){ location.href='/html/login.html'; return; }
  return data.user;
}

async function logout(){
  await api('/api/auth/logout', {}, 'POST');
  location.href='/html/index.html';
}