const modal = document.querySelector('#modal');
const titleInput = document.querySelector('#note-title');
const contentInput = document.querySelector('#note-content');
const projectInput = document.querySelector('#note-project');
const youtubeInput = document.querySelector('#youtube-url');

const githubModal = document.querySelector('#github-modal');
const githubInput = document.querySelector('#github-url');

const viewModal = document.querySelector('#view-modal');
const viewTitle = document.querySelector('#view-title');
const viewTag = document.querySelector('#view-tag');
const viewDate = document.querySelector('#view-date');
const viewContent = document.querySelector('#view-content');
const viewVideo = document.querySelector('#view-video');
const viewCopyBtn = document.querySelector('#view-copy-btn');
const viewDeleteBtn = document.querySelector('#view-delete-btn');

// Vistas da aplicação
const dashboardView = document.querySelector('#dashboard-view');
const categoryView = document.querySelector('#category-view');
const categoryPageTitle = document.querySelector('#category-page-title');
const categoryPageSubtitle = document.querySelector('#category-page-subtitle');
const categoryNotesContainer = document.querySelector('#category-notes-container');
const categoryAddBtn = document.querySelector('#category-add-btn');
const viewGridBtn = document.querySelector('#view-grid-btn');
const viewListBtn = document.querySelector('#view-list-btn');

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
let currentActiveView = 'dashboard'; // 'dashboard' | 'category'
let currentDisplayMode = localStorage.getItem('rastro-view-mode') || 'grid'; // 'grid' | 'list'
let currentViewingNote = null;

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

const closeViewModal = () => {
  viewModal.classList.remove('open');
  currentViewingNote = null;
};

// Eventos dos botões de criação
document.querySelector('#new-note')?.addEventListener('click', () => {
  openModal(currentFilter !== 'all' ? currentFilter : 'Geral');
});
document.querySelector('#quick-note')?.addEventListener('click', () => openModal());
categoryAddBtn?.addEventListener('click', () => {
  openModal(currentFilter !== 'all' ? currentFilter : 'Geral');
});

document.querySelector('#add-project-btn')?.addEventListener('click', () => {
  const name = window.prompt('Nome do novo projeto:');
  if (name?.trim()) {
    openModal(name.trim());
  }
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

document.querySelector('#close-view')?.addEventListener('click', closeViewModal);
document.querySelector('#close-view-btn')?.addEventListener('click', closeViewModal);
viewModal.addEventListener('click', (event) => { if (event.target === viewModal) closeViewModal(); });

// Alternador de Grelha vs Lista na página de categoria
function updateViewModeButtons() {
  if (viewGridBtn && viewListBtn) {
    viewGridBtn.classList.toggle('active', currentDisplayMode === 'grid');
    viewListBtn.classList.toggle('active', currentDisplayMode === 'list');
  }
}
updateViewModeButtons();

viewGridBtn?.addEventListener('click', () => {
  currentDisplayMode = 'grid';
  localStorage.setItem('rastro-view-mode', 'grid');
  updateViewModeButtons();
  renderCategoryNotes();
});

viewListBtn?.addEventListener('click', () => {
  currentDisplayMode = 'list';
  localStorage.setItem('rastro-view-mode', 'list');
  updateViewModeButtons();
  renderCategoryNotes();
});

// Navegação entre Visão Geral (Dashboard) e Página de Categoria
function showDashboardView() {
  currentActiveView = 'dashboard';
  currentFilter = 'all';
  if (dashboardView) dashboardView.style.display = 'block';
  if (categoryView) categoryView.style.display = 'none';

  document.querySelector('#nav-overview')?.classList.add('active');
  document.querySelectorAll('.projects .project').forEach(p => p.classList.remove('active'));
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = 'Visão geral';

  renderDashboardRecentNotes();
}

function showCategoryView(projectName) {
  currentActiveView = 'category';
  currentFilter = projectName;
  if (dashboardView) dashboardView.style.display = 'none';
  if (categoryView) categoryView.style.display = 'block';

  document.querySelector('#nav-overview')?.classList.remove('active');
  document.querySelectorAll('.projects .project').forEach(p => {
    const isTarget = (p.dataset.filter || '').toLowerCase() === projectName.toLowerCase();
    p.classList.toggle('active', isTarget);
  });

  const displayTitle = projectName === 'all' ? 'Todos os Projetos' : projectName;
  if (categoryPageTitle) categoryPageTitle.textContent = displayTitle;
  if (breadcrumbCurrent) breadcrumbCurrent.textContent = displayTitle;

  renderCategoryNotes();
}

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
    closeViewModal();
  }
});

// Paleta dinâmica de temas para cada nota (sem repetir entre notas adjacentes)
const NOTE_THEMES = [
  'theme-coral',
  'theme-blue',
  'theme-emerald',
  'theme-amber',
  'theme-purple',
  'theme-cyan',
  'theme-rose',
  'theme-indigo'
];

function getNoteTheme(note, index = null) {
  if (typeof index === 'number' && index >= 0) {
    return NOTE_THEMES[index % NOTE_THEMES.length];
  }
  const idNum = parseInt(note?.id, 10);
  if (!isNaN(idNum)) {
    return NOTE_THEMES[Math.abs(idNum) % NOTE_THEMES.length];
  }
  let hash = 0;
  const str = String(note?.title || note?.id || 'rastro');
  for (let i = 0; i < str.length; i++) hash = (hash * 31 + str.charCodeAt(i)) & 0xffffffff;
  return NOTE_THEMES[Math.abs(hash) % NOTE_THEMES.length];
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

// Renderizador Markdown
function renderMarkdown(text) {
  if (!text) return '<p><em>Sem conteúdo adicional.</em></p>';

  let escaped = escapeHtml(text);

  // Blocos de código ```lang ... ```
  escaped = escaped.replace(/```(?:[a-zA-Z0-9_-]+)?\n([\s\S]*?)```/g, (_match, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  // Código inline `code`
  escaped = escaped.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Cabeçalhos
  escaped = escaped.replace(/^### (.*$)/gim, '<h4>$1</h4>');
  escaped = escaped.replace(/^## (.*$)/gim, '<h3>$1</h3>');
  escaped = escaped.replace(/^# (.*$)/gim, '<h2>$1</h2>');

  // Negrito e Itálico
  escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');

  // Links [texto](url)
  escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

  // Listas
  escaped = escaped.replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>');
  escaped = escaped.replace(/(<li>.*<\/li>)/gims, '<ul>$1</ul>');
  escaped = escaped.replace(/<\/ul>\s*<ul>/g, '');

  // Parágrafos
  const paragraphs = escaped.split(/\n{2,}/).map(p => {
    const trimmed = p.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('<h') || trimmed.startsWith('<pre') || trimmed.startsWith('<ul')) {
      return trimmed;
    }
    return `<p>${trimmed.replace(/\n/g, '<br>')}</p>`;
  }).filter(Boolean);

  return paragraphs.join('\n');
}

// Abrir modal de leitura completa com o tema dinâmico da nota
function openViewModal(note, themeClass = null) {
  currentViewingNote = note;
  viewTitle.textContent = note.title;

  const modalBox = viewModal.querySelector('.modal');
  if (modalBox) {
    NOTE_THEMES.forEach(t => modalBox.classList.remove(t));
    const chosenTheme = themeClass || getNoteTheme(note);
    modalBox.classList.add(chosenTheme);
  }

  viewTag.className = 'tag';
  viewTag.textContent = (note.project || 'Geral').toUpperCase();

  const formattedDate = new Date(note.updated_at || note.created_at).toLocaleString('pt-PT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
  viewDate.textContent = formattedDate;

  // Vídeo YouTube
  const videoId = getYoutubeId(note.youtube_url);
  if (videoId) {
    viewVideo.innerHTML = `
      <a class="youtube-thumb" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener">
        <img src="https://img.youtube.com/vi/${videoId}/hqdefault.jpg" alt="Miniatura do vídeo" />
        <span>▶</span>
      </a>
      <a class="youtube-link" href="${escapeHtml(note.youtube_url)}" target="_blank" rel="noopener">▶ Abrir vídeo no YouTube</a>
    `;
  } else {
    viewVideo.innerHTML = '';
  }

  viewContent.innerHTML = renderMarkdown(note.content);
  viewModal.classList.add('open');
}

// Copiar conteúdo da nota
viewCopyBtn?.addEventListener('click', () => {
  if (!currentViewingNote) return;
  navigator.clipboard.writeText(currentViewingNote.content || '')
    .then(() => showToast('Texto copiado para a área de transferência ✓'))
    .catch(() => showToast('Não foi possível copiar'));
});

// Eliminar a partir do modal de leitura
viewDeleteBtn?.addEventListener('click', () => {
  if (!currentViewingNote) return;
  const noteId = currentViewingNote.id;
  deleteNote(noteId);
  closeViewModal();
});

// Criar elemento de Cartão (Modo Grelha) com cor temática dinâmica
function createNoteElement(note, index = 0) {
  const themeClass = getNoteTheme(note, index);
  const card = document.createElement('article');
  card.className = `note-card ${themeClass}`;
  card.dataset.id = note.id;
  card.dataset.title = note.title;
  card.dataset.project = note.project || 'Geral';

  const videoId = getYoutubeId(note.youtube_url);
  const projectLabel = escapeHtml((note.project || 'Geral').toUpperCase());
  const relativeTime = formatRelativeTime(note.updated_at || note.created_at);
  const readTime = calculateReadTime(note.content);

  card.innerHTML = `
    <div class="note-top">
      <span class="tag">${projectLabel}</span>
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

  card.addEventListener('click', () => openViewModal(note, themeClass));

  card.querySelector('.btn-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNote(note.id);
  });
  card.querySelectorAll('.youtube-thumb, .youtube-link').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });

  return card;
}

// Criar elemento de Linha (Modo Lista) com cor temática dinâmica
function createNoteListRow(note, index = 0) {
  const themeClass = getNoteTheme(note, index);
  const row = document.createElement('div');
  row.className = `note-list-row ${themeClass}`;
  row.dataset.id = note.id;

  const projectLabel = escapeHtml((note.project || 'Geral').toUpperCase());
  const relativeTime = formatRelativeTime(note.updated_at || note.created_at);
  const readTime = calculateReadTime(note.content);
  const hasVideo = Boolean(getYoutubeId(note.youtube_url));

  row.innerHTML = `
    <span class="tag">${projectLabel}</span>
    ${hasVideo ? '<span class="yt-indicator" title="Contém vídeo YouTube">▶</span>' : ''}
    <div class="row-main">
      <h3>${escapeHtml(note.title)}</h3>
      <p>${escapeHtml(note.content ? note.content.slice(0, 140) : 'Sem descrição adicional.')}</p>
    </div>
    <div class="row-meta">
      <span>${relativeTime}</span>
      <span>${readTime}</span>
      <button class="btn-delete" title="Eliminar nota" aria-label="Eliminar nota">✕</button>
    </div>
  `;

  row.addEventListener('click', () => openViewModal(note, themeClass));

  row.querySelector('.btn-delete')?.addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNote(note.id);
  });

  return row;
}

// Carregar notas da API
async function loadNotes(searchQuery = '') {
  try {
    const url = searchQuery ? `/api/notes?search=${encodeURIComponent(searchQuery)}` : '/api/notes';
    const response = await fetch(url);
    if (!response.ok) throw new Error('Falha ao comunicar com o servidor');
    allNotes = await response.json();

    if (currentActiveView === 'category') {
      renderCategoryNotes(searchQuery);
    } else {
      renderDashboardRecentNotes(searchQuery);
    }

    updateDynamicMetrics(allNotes);
  } catch (error) {
    console.error('Erro ao carregar notas:', error);
    if (noteList) {
      noteList.innerHTML = `
        <div class="empty-notes">
          <p>Não foi possível ligar à base de dados.</p>
          <button onclick="loadNotes()">Tentar novamente</button>
        </div>
      `;
    }
  }
}

// Renderizar notas recentes no Dashboard
function renderDashboardRecentNotes(searchQuery = '') {
  if (!noteList) return;
  noteList.innerHTML = '';

  let list = allNotes;
  if (list.length === 0) {
    const msg = searchQuery
      ? `Nenhuma nota encontrada para “${escapeHtml(searchQuery)}”.`
      : 'O teu rastro está limpo. Começa por criar uma nota ou importar um guia DIY!';
    
    noteList.innerHTML = `
      <div class="empty-notes">
        <p>${msg}</p>
        <button id="empty-add-btn">Criar nota agora <span>＋</span></button>
      </div>
    `;
    document.querySelector('#empty-add-btn')?.addEventListener('click', () => openModal('Geral'));
    return;
  }

  // No dashboard mostra as 6 mais recentes
  const recentList = list.slice(0, 6);
  recentList.forEach((note, index) => {
    noteList.appendChild(createNoteElement(note, index));
  });
}

// Renderizar todas as notas na Página Dedicada da Categoria (Grelha ou Lista)
function renderCategoryNotes(searchQuery = '') {
  if (!categoryNotesContainer) return;
  categoryNotesContainer.innerHTML = '';

  let list = allNotes;
  if (currentFilter !== 'all') {
    list = list.filter(n => (n.project || '').toLowerCase() === currentFilter.toLowerCase());
  }

  if (categoryPageSubtitle) {
    categoryPageSubtitle.textContent = `${list.length} ${list.length === 1 ? 'nota guardada' : 'notas guardadas'}`;
  }

  if (list.length === 0) {
    const msg = searchQuery
      ? `Nenhuma nota encontrada para “${escapeHtml(searchQuery)}”.`
      : currentFilter !== 'all'
      ? `Ainda não tens notas no projeto “${escapeHtml(currentFilter)}”.`
      : 'Ainda não existem notas criadas.';
    
    categoryNotesContainer.className = 'category-notes-grid';
    categoryNotesContainer.innerHTML = `
      <div class="empty-notes">
        <p>${msg}</p>
        <button id="empty-category-add-btn">Criar nota neste projeto <span>＋</span></button>
      </div>
    `;
    document.querySelector('#empty-category-add-btn')?.addEventListener('click', () => {
      openModal(currentFilter !== 'all' ? currentFilter : 'Geral');
    });
    return;
  }

  if (currentDisplayMode === 'grid') {
    categoryNotesContainer.className = 'category-notes-grid';
    list.forEach((note, index) => {
      categoryNotesContainer.appendChild(createNoteElement(note, index));
    });
  } else {
    categoryNotesContainer.className = 'category-notes-list';
    list.forEach((note, index) => {
      categoryNotesContainer.appendChild(createNoteListRow(note, index));
    });
  }
}

// Atualização de projetos dinâmicos e métricas
function updateDynamicMetrics(notes) {
  if (statTotalNotes) statTotalNotes.textContent = notes.length;
  if (recentCount) recentCount.textContent = notes.length;

  const guides = notes.filter(n => (n.project || '').toLowerCase() === 'diy' || (n.tags || []).includes('diy'));
  if (statTotalGuides) statTotalGuides.textContent = guides.length;

  const projectMap = new Map();
  notes.forEach(n => {
    const p = (n.project || 'Geral').trim();
    projectMap.set(p, (projectMap.get(p) || 0) + 1);
  });

  if (projectMap.size === 0) {
    projectMap.set('Geral', 0);
  }

  if (statTotalProjects) statTotalProjects.textContent = projectMap.size;

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
    allLink.className = `project ${currentActiveView === 'category' && currentFilter === 'all' ? 'active' : ''}`;
    allLink.dataset.filter = 'all';
    allLink.innerHTML = `<i class="dot coral"></i> Todos <span>${notes.length}</span>`;
    allLink.addEventListener('click', (e) => {
      e.preventDefault();
      showCategoryView('all');
    });
    projectsList.appendChild(allLink);

    // Projetos da base de dados
    const dotColors = ['coral', 'blue', 'yellow', 'green'];
    let colorIdx = 0;
    projectMap.forEach((count, projName) => {
      const pLink = document.createElement('a');
      pLink.href = '#';
      const isTarget = currentActiveView === 'category' && currentFilter.toLowerCase() === projName.toLowerCase();
      pLink.className = `project ${isTarget ? 'active' : ''}`;
      pLink.dataset.filter = projName;
      const color = dotColors[colorIdx % dotColors.length];
      colorIdx++;
      pLink.innerHTML = `<i class="dot ${color}"></i> ${escapeHtml(projName)} <span>${count}</span>`;
      pLink.addEventListener('click', (e) => {
        e.preventDefault();
        showCategoryView(projName);
      });
      projectsList.appendChild(pLink);
    });
  }

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

// Guardar nova nota
document.querySelector('#save-note')?.addEventListener('click', async () => {
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
async function deleteNote(id) {
  if (!confirm('Eliminar esta nota do teu rastro?')) return;
  try {
    const response = await fetch(`/api/notes/${id}`, { method: 'DELETE' });
    if (!response.ok) throw new Error('Não foi possível eliminar');
    allNotes = allNotes.filter(n => n.id !== id);
    updateDynamicMetrics(allNotes);
    if (currentActiveView === 'category') {
      renderCategoryNotes();
    } else {
      renderDashboardRecentNotes();
    }
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
    if (sectionTitle) sectionTitle.textContent = 'Notas recentes';
    if (sectionSubtitle) sectionSubtitle.textContent = 'As tuas anotações e tutoriais guardados.';
    loadNotes();
    return;
  }
  if (sectionTitle) sectionTitle.textContent = `Resultados para “${clean}”`;
  if (sectionSubtitle) sectionSubtitle.textContent = 'A pesquisar em títulos e conteúdos na base de dados.';
  loadNotes(clean);
}

document.querySelector('#search-button')?.addEventListener('click', triggerSearch);
document.querySelector('#reset-filter')?.addEventListener('click', (e) => {
  e.preventDefault();
  showCategoryView('all');
});
document.querySelector('#nav-overview')?.addEventListener('click', (e) => {
  e.preventDefault();
  showDashboardView();
});
document.querySelector('#nav-recent')?.addEventListener('click', (e) => {
  e.preventDefault();
  showCategoryView('all');
});

// Importar com IA (GitHub, XDA, Fóruns, Tutoriais Web)
document.querySelector('#import-github')?.addEventListener('click', async () => {
  const url = githubInput.value.trim();
  if (!url) return githubInput.focus();

  const button = document.querySelector('#import-github');
  button.disabled = true;
  button.innerHTML = 'A analisar e organizar com IA…';

  try {
    const response = await fetch('/api/import/url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível processar o URL');

    closeGithubModal();
    githubInput.value = '';
    showToast('Guia DIY criado com sucesso ✓');
    await loadNotes();
    showCategoryView('DIY');
    // Abre imediatamente o guia gerado para consulta
    openViewModal(data);
  } catch (error) {
    console.error('Erro na importação com IA:', error);
    showToast(error.message || 'Erro ao importar com IA', true);
  } finally {
    button.disabled = false;
    button.innerHTML = 'Organizar guia com IA <span>⌁</span>';
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

function showToast(message, isError = false) {
  const toast = document.querySelector('#toast');
  if (!toast) return;
  toast.textContent = message;
  toast.style.background = isError ? '#9e2a2b' : 'var(--ink)';
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), isError ? 6000 : 3200);
}

// Inicialização
loadNotes();
