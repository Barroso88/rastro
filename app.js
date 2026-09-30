const modal = document.querySelector('#modal');
const title = document.querySelector('#note-title');
const githubModal = document.querySelector('#github-modal');
const openModal = () => { modal.classList.add('open'); title.focus(); };
const closeModal = () => modal.classList.remove('open');
document.querySelector('#new-note').addEventListener('click', openModal);
document.querySelector('#quick-note').addEventListener('click', openModal);
document.querySelector('#diy-link').addEventListener('click', (event) => { event.preventDefault(); githubModal.classList.add('open'); document.querySelector('#github-url').focus(); });
document.querySelector('#close-modal').addEventListener('click', closeModal);
document.querySelector('#cancel-modal').addEventListener('click', closeModal);
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });
document.querySelector('#close-github').addEventListener('click', () => githubModal.classList.remove('open'));
document.querySelector('#cancel-github').addEventListener('click', () => githubModal.classList.remove('open'));
githubModal.addEventListener('click', (event) => { if (event.target === githubModal) githubModal.classList.remove('open'); });
document.addEventListener('keydown', (event) => { if (event.key.toLowerCase() === 'n' && !['INPUT','TEXTAREA'].includes(document.activeElement.tagName)) openModal(); if (event.key === 'Escape') closeModal(); });
document.querySelector('#save-note').addEventListener('click', () => {
  const value = title.value.trim();
  if (!value) { title.focus(); return; }
  const content = document.querySelector('.modal textarea').value.trim();
  const youtube_url = document.querySelector('#youtube-url').value.trim() || null;
  fetch('/api/notes', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ title: value, content, youtube_url }) })
    .then(response => { if (!response.ok) throw new Error('Não foi possível guardar'); return response.json(); })
    .then(note => {
      const card = document.createElement('article');
      card.className = 'note-card featured';
      card.dataset.title = note.title;
      const videoId = getYoutubeId(note.youtube_url);
      card.innerHTML = `<div class="note-top"><span class="tag coral-tag">${note.project.toUpperCase()}</span><button class="more">•••</button></div>${videoId ? `<a class="youtube-thumb" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener"><img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Thumbnail do vídeo" /><span>▶</span></a>` : ''}<h3>${escapeHtml(note.title)}</h3><p>${escapeHtml(note.content || 'Sem descrição adicional.')}</p>${note.youtube_url ? `<a class="youtube-link" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener">▶ Ver tutorial no YouTube</a>` : ''}<div class="note-footer"><span>Agora</span><span class="read-progress"><i></i></span><span>1 min</span></div>`;
      document.querySelector('.note-list').prepend(card);
      closeModal(); document.querySelector('.modal textarea').value = ''; document.querySelector('#youtube-url').value = ''; title.value = '';
      showToast('Nota guardada no teu rastro ✓');
    }).catch(() => showToast('Não foi possível guardar a nota'));
});
document.querySelector('#search-button').addEventListener('click', () => {
  const query = window.prompt('O que procuras no teu rastro?');
  if (!query) return;
  const cards = [...document.querySelectorAll('.note-card')];
  cards.forEach(card => { card.style.display = card.dataset.title.toLowerCase().includes(query.toLowerCase()) ? '' : 'none'; });
  document.querySelector('.recent-block h2').textContent = `Resultados para “${query}”`;
});
const savedTheme = localStorage.getItem('rastro-theme');
if (savedTheme === 'dark') document.body.classList.add('dark');
document.querySelector('#theme-toggle').addEventListener('click', () => { const dark = document.body.classList.toggle('dark'); localStorage.setItem('rastro-theme', dark ? 'dark' : 'light'); document.querySelector('#theme-toggle').textContent = dark ? '☀' : '☾'; });
document.querySelector('#import-github').addEventListener('click', () => {
  const input = document.querySelector('#github-url'); const url = input.value.trim(); if (!url) return input.focus();
  const button = document.querySelector('#import-github'); button.disabled = true; button.innerHTML = 'A organizar…';
  fetch('/api/import/github', { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ url }) })
    .then(response => response.ok ? response.json() : response.json().then(error => Promise.reject(new Error(error.error))))
    .then(note => { githubModal.classList.remove('open'); input.value = ''; button.disabled = false; button.innerHTML = 'Organizar guia <span>→</span>'; showToast('Guia DIY criado em português ✓'); window.location.reload(); })
    .catch(error => { button.disabled = false; button.innerHTML = 'Organizar guia <span>→</span>'; showToast(error.message || 'Não foi possível importar o repositório'); });
});
function escapeHtml(value) { return value.replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char])); }
function getYoutubeId(url) { const match = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return match?.[1] || ''; }
function showToast(message) { const toast = document.querySelector('.toast'); toast.textContent = message; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2800); }
