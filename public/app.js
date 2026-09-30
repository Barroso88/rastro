const modal = document.querySelector('#modal');
const titleInput = document.querySelector('#note-title');
const contentInput = document.querySelector('#note-content');
const projectInput = document.querySelector('#note-project');
const youtubeInput = document.querySelector('#youtube-url');
const githubModal = document.querySelector('#github-modal');
const githubInput = document.querySelector('#github-url');
const noteList = document.querySelector('#note-list');
const statTotalNotes = document.querySelector('#stat-total-notes');
const statTotalProjects = document.querySelector('#stat-total-projects');
const statTotalGuides = document.querySelector('#stat-total-guides');
const activitySessions = document.querySelector('#activity-sessions');
const recentCount = document.querySelector('#recent-count');
const sectionTitle = document.querySelector('#section-title');
const sectionSubtitle = document.querySelector('#section-subtitle');
const breadcrumbCurrent = document.querySelector('#breadcrumb-current');
const projectsList = document.querySelector('#projects-list');
const projectSuggestions = document.querySelector('#project-suggestions');

let allNotes = [];
let currentFilter = 'all';

// Formatação da data atual no cabeçalho
const todayEyebrow = document.querySelector('#today-eyebrow');
if (todayEyebrow) {
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  const todayStr = new Intl.DateTimeFormat('pt-PT', options).format(new Date());
  todayEyebrow.textContent = todayStr.toUpperCase();
}

// Abertura e fecho de modais
const openModal = (defaultProject = '') => {
  if (defaultProject) projectInput.value = defaultProject;
  modal.classList.add('open');
  titleInput.focus();
};
const closeModal = () => modal.classList.remove('open');
const openGithubModal = () => { githubModal.classList.add('open'); githubInput.focus(); };
const closeGithubModal = () => githubModal.classList.remove('open');

document.querySelector('#new-note')?.addEventListener('click', () => openModal(currentFilter !== 'all' ? currentFilter : 'Geral'));
document.querySelector('#quick-note')?.addEventListener('click', () => openModal());
document.querySelector('#add-project-btn')?.addEventListener('click', () => {
  const name = window.prompt('Nome do novo projeto:');
  if (name?.trim()) openModal(name.trim());
});

document.querySelector('#diy-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  openGithubModal();
});
document.querySelector('#close-modal')?.addEventListener('click', closeModal);
document.querySelector('#cancel-modal')?.addEventListener('click', closeModal);
modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(); });

document.querySelector('#close-github')?.addEventListener('click', closeGithubModal);
document.querySelector('#cancel-github')?.addEventListener('click', closeGithubModal);
githubModal.addEventListener('click', (event) => { if (event.target === githubModal) closeGithubModal(); });

// Atalhos de teclado
document.addEventListener('keydown', (event) => {
  const isInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    triggerSearch();
  } else if (event.key.toLowerCase() === 'n' && !isInput) {
    event.preventDefault();
    openModal(currentFilter !== 'all' ? currentFilter : 'Geral');
  } else if (event.key === 'Escape') {
    closeModal();
    closeGithubModal();
  }
});

// Estilos de etiquetas baseados no nome do projeto
const TAG_COLORS = ['coral', 'blue', 'yellow', 'coral'];
function getTagColorClass(project) {
  const norm = String(project || '').toLowerCase();
  if (norm === 'diy') return 'coral-tag';
  let hash = 0;
  for (let i = 0; i < norm.length; i++) hash = (hash + norm.charCodeAt(i)) % TAG_COLORS.length;
  return `${TAG_COLORS[hash]}-tag`;
}

function formatRelativeTime(dateString) {
  if (!dateString) return 'Agora';
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now - date) / 1000);
  if (diffSec < 60) return 'Agora';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Há ${diffMin} min`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `Há ${diffHours} ${diffHours === 1 ? 'hora' : 'horas'}`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ontem';
  if (diffDays < 7) return `Há ${diffDays} dias`;
  return date.toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' });
}

function calculateReadTime(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.ceil(words / 150));
  return `${minutes} min`;
}

function createNoteElement(note, isFirst = false) {
  const card = document.createElement('article');
  card.className = `note-card ${isFirst ? 'featured' : ''}`;
  card.dataset.id = note.id;
  card.dataset.title = note.title;
  card.dataset.project = note.project || 'Geral';

  const videoId = getYoutubeId(note.youtube_url);
  const tagClass = getTagColorClass(note.project);
  const projectLabel = escapeHtml((note.project || 'Geral').toUpperCase());
  const relativeTime = formatRelativeTime(note.updated_at || note.created_at);
  const readTime = calculateReadTime(note.content);

  card.innerHTML = `
    <div class="note-top">
      <span class="tag ${tagClass}">${projectLabel}</span>
      <div class="note-actions">
        <button class="btn-delete" title="Eliminar nota" aria-label="Eliminar nota">✕</button>
      </div>
    </div>
    ${videoId ? `
      <a class="youtube-thumb" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener">
        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Miniatura do vídeo" />
        <span>▶</span>
      </a>
    ` : ''}
    <h3>${escapeHtml(note.title)}</h3>
    <p>${escapeHtml(note.content || 'Sem descrição adicional.')}</p>
    ${note.youtube_url ? `
      <a class="youtube-link" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener">▶ Ver tutorial no YouTube</a>
    ` : ''}
    <div class="note-footer">
      <span>${relativeTime}</span>
      <span class="read-progress"><i></i></span>
      <span>${readTime}</span>
    </div>
  `;

  card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNote(note.id, card);
  });

  return card;
}

// Carregar notas da API
async function loadNotes(searchQuery = '') {
  try {
    const url = searchQuery ? `/api/notes?search=${encodeURIComponent(searchQuery)}` : '/api/notes';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha ao comunicar com o servidor');
    allNotes = await response.json();
    renderFilteredNotes(searchQuery);
    updateDynamicMetrics(allNotes);
  } catch (error) {
    console.error('Erro ao carregar notas:', error);
    noteList.innerHTML = `
      <div class="empty-notes">
        <p>Não foi possível ligar à base de dados.</p>
        <button onclick="loadNotes()">Tentar novamente</button>
      </div>
    `;
  }
}

function renderFilteredNotes(searchQuery = '') {
  noteList.innerHTML = '';

  let list = allNotes;
  if (currentFilter !== 'all') {
    list = list.filter(n => (n.project || '').toLowerCase() === currentFilter.toLowerCase());
  }

  if (list.length === 0) {
    const msg = searchQuery
      ? `Nenhuma nota encontrada para “${escapeHtml(searchQuery)}”.`
      : currentFilter !== 'all'
      ? `Ainda não tens notas no projeto “${escapeHtml(currentFilter)}”.`
      : 'O teu rastro está limpo. Começa por criar uma nota ou importar um guia DIY!';
    
    noteList.innerHTML = `
      <div class="empty-notes">
        <p>${msg}</p>
        <button id="empty-add-btn">Criar nota agora <span>＋</span></button>
      </div>
    `;
    document.querySelector('#empty-add-btn')?.addEventListener('click', () => openModal(currentFilter !== 'all' ? currentFilter : 'Geral'));
    return;
  }

  list.forEach((note, index) => {
    noteList.appendChild(createNoteElement(note, index === 0));
  });
}

// Atualização de projetos dinâmicos e estatísticas reais
function updateDynamicMetrics(notes) {
  // Contadores globais
  if (statTotalNotes) statTotalNotes.textContent = notes.length;
  if (recentCount) recentCount.textContent = notes.length;

  const guides = notes.filter(n => (n.project || '').toLowerCase() === 'diy' || (n.tags || []).includes('diy'));
  if (statTotalGuides) statTotalGuides.textContent = guides.length;

  // Projetos únicos existentes na base de dados
  const projectMap = new Map();
  notes.forEach(n => {
    const p = (n.project || 'Geral').trim();
    projectMap.set(p, (projectMap.get(p) || 0) + 1);
  });

  // Se a lista estiver vazia, garante pelo menos Geral
  if (projectMap.size === 0) {
    projectMap.set('Geral', 0);
  }

  if (statTotalProjects) statTotalProjects.textContent = projectMap.size;

  // Atividade nos últimos 7 dias
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  const activeThisWeek = notes.filter(n => {
    const d = new Date(n.updated_at || n.created_at);
    return d >= sevenDaysAgo;
  }).length;
  if (activitySessions) activitySessions.textContent = activeThisWeek;

  // Renderizar projetos na barra lateral
  if (projectsList) {
    projectsList.innerHTML = '';

    // Opção "Todos"
    const allLink = document.createElement('a');
    allLink.href = '#';
    allLink.className = `project ${currentFilter === 'all' ? 'active' : ''}`;
    allLink.dataset.filter = 'all';
    allLink.innerHTML = `<i class="dot coral"></i> Todos <span>${notes.length}</span>`;
    allLink.addEventListener('click', (e) => {
      e.preventDefault();
      setProjectFilter('all');
    });
    projectsList.appendChild(allLink);

    // Cada projeto único real
    const dotColors = ['coral', 'blue', 'yellow'];
    let colorIdx = 0;
    projectMap.forEach((count, projName) => {
      const pLink = document.createElement('a');
      pLink.href = '#';
      pLink.className = `project ${currentFilter.toLowerCase() === projName.toLowerCase() ? 'active' : ''}`;
      pLink.dataset.filter = projName;
      const color = dotColors[colorIdx % dotColors.length];
      colorIdx++;
      pLink.innerHTML = `<i class="dot ${color}"></i> ${escapeHtml(projName)} <span>${count}</span>`;
      pLink.addEventListener('click', (e) => {
        e.preventDefault();
        setProjectFilter(projName);
      });
      projectsList.appendChild(pLink);
    });
  }

  // Atualizar sugestões no datalist
  if (projectSuggestions) {
    projectSuggestions.innerHTML = '';
    const uniqueProjects = Array.from(projectMap.keys());
    if (!uniqueProjects.includes('Geral')) uniqueProjects.unshift('Geral');
    if (!uniqueProjects.includes('DIY')) uniqueProjects.push('DIY');
    uniqueProjects.forEach(proj => {
      const opt = document.createElement('option');
      opt.value = proj;
      projectSuggestions.appendChild(opt);
    });
  }
}

function setProjectFilter(filter) {
  currentFilter = filter;
  document.querySelectorAll('.projects .project').forEach(p => {
    p.classList.toggle('active', (p.dataset.filter || '').toLowerCase() === filter.toLowerCase());
  });
  if (breadcrumbCurrent) {
    breadcrumbCurrent.textContent = filter === 'all' ? 'Visão geral' : filter;
  }
  renderFilteredNotes();
}

// Guardar nova nota
document.querySelector('#save-note').addEventListener('click', async () => {
  const title = titleInput.value.trim();
  if (!title) {
    titleInput.focus();
    return;
  }
  const content = contentInput.value.trim();
  const project = projectInput.value.trim() || 'Geral';
  const youtube_url = youtubeInput.value.trim() || null;

  try {
    const response = await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content, project, youtube_url })
    });
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      throw new Error(errData.error || 'Erro ao guardar a nota');
    }

    closeModal();
    titleInput.value = '';
    contentInput.value = '';
    youtubeInput.value = '';

    showToast('Nota guardada no teu rastro ✓');
    await loadNotes();
  } catch (error) {
    showToast(error.message || 'Não foi possível guardar a nota');
  }
});

// Eliminar nota
async function deleteNote(id, cardElement) {
  if (!confirm('Eliminar esta nota do teu rastro?')) return;
  try {
    const response = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Não foi possível eliminar');
    cardElement.remove();
    allNotes = allNotes.filter(n => n.id !== id);
    updateDynamicMetrics(allNotes);
    if (allNotes.length === 0) renderFilteredNotes();
    showToast('Nota eliminada ✓');
  } catch (error) {
    showToast(error.message || 'Erro ao eliminar nota');
  }
}

// Pesquisa
function triggerSearch() {
  const query = window.prompt('O que procuras no teu rastro?');
  if (query === null) return;
  const clean = query.trim();
  if (!clean) {
    sectionTitle.textContent = 'Notas recentes';
    sectionSubtitle.textContent = 'As tuas anotações e tutoriais guardados.';
    loadNotes();
    return;
  }
  sectionTitle.textContent = `Resultados para “${clean}”`;
  sectionSubtitle.textContent = 'A pesquisar em títulos e conteúdos na base de dados.';
  loadNotes(clean);
}

document.querySelector('#search-button')?.addEventListener('click', triggerSearch);
document.querySelector('#reset-filter')?.addEventListener('click', (e) => {
  e.preventDefault();
  setProjectFilter('all');
  sectionTitle.textContent = 'Notas recentes';
  sectionSubtitle.textContent = 'As tuas anotações e tutoriais guardados.';
  loadNotes();
});
document.querySelector('#nav-overview')?.addEventListener('click', (e) => {
  e.preventDefault();
  setProjectFilter('all');
  loadNotes();
});
document.querySelector('#nav-recent')?.addEventListener('click', (e) => {
  e.preventDefault();
  setProjectFilter('all');
  loadNotes();
});

// Importar GitHub com IA
document.querySelector('#import-github').addEventListener('click', async () => {
  const url = githubInput.value.trim();
  if (!url) return githubInput.focus();

  const button = document.querySelector('#import-github');
  button.disabled = true;
  button.innerHTML = 'A organizar guia com IA…';

  try {
    const response = await fetch('/api/import/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível importar o repositório');

    closeGithubModal();
    githubInput.value = '';
    showToast('Guia DIY criado com sucesso ✓');
    await loadNotes();
  } catch (error) {
    showToast(error.message || 'Erro ao importar repositório');
  } finally {
    button.disabled = false;
    button.innerHTML = 'Organizar guia com IA <span>→</span>';
  }
});

// Tema Dark / Light
const savedTheme = localStorage.getItem('rastro-theme');
if (savedTheme === 'dark') {
  document.body.classList.add('dark');
  document.querySelector('#theme-toggle').textContent = '☀';
}
document.querySelector('#theme-toggle')?.addEventListener('click', () => {
  const isDark = document.body.classList.toggle('dark');
  localStorage.setItem('rastro-theme', isDark ? 'dark' : 'light');
  document.querySelector('#theme-toggle').textContent = isDark ? '☀' : '☾';
});

// Funções utilitárias
function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[char]));
}

function getYoutubeId(url) {
  const match = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return match?.[1] || '';
}

function showToast(message) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Inicialização
loadNotes();
