// playlist-editor.js

class PlaylistEditorClass {
  constructor() {
    this.queue = [];
    this.currentIndex = 0;
    this.onQueueChange = null; // Callback for when the UI modifies the queue
    this.onSkipTo = null; // Callback for when user clicks a track to play

    this.initDOM();
    this.bindEvents();
  }

  initDOM() {
    // Inject Editor Overlay
    const editorHTML = `
      <div id="playlist-editor-module" class="hidden">
        <div class="pe-header">
          <h3>Playlist Editor</h3>
          <button class="pe-close-btn" id="pe-close-btn">&times;</button>
        </div>
        <div class="pe-actions">
          <input type="text" id="pe-link-input" class="pe-link-input" placeholder="Add URL(s) separate by space...">
          <button class="pe-btn pe-btn-primary" id="pe-add-btn">Add Links</button>
          <button class="pe-btn" id="pe-clear-btn">Clear All</button>
        </div>
        <div class="pe-list-container">
          <div class="pe-list" id="pe-list"></div>
        </div>
      </div>

      <div id="pe-status-overlay" class="hidden">
        <div class="pe-status-header">
          <span>Now Playing</span>
          <button class="pe-close-btn" id="pe-status-close" style="font-size:16px;">&times;</button>
        </div>
        <div class="pe-status-current" id="pe-status-current">Nothing playing</div>
        <div class="pe-status-upcoming-label">Up Next:</div>
        <div class="pe-status-upcoming-list" id="pe-status-upcoming-list"></div>
      </div>
    `;

    const container = document.createElement('div');
    container.innerHTML = editorHTML;
    document.body.appendChild(container);

    this.els = {
      editor: document.getElementById('playlist-editor-module'),
      closeBtn: document.getElementById('pe-close-btn'),
      linkInput: document.getElementById('pe-link-input'),
      addBtn: document.getElementById('pe-add-btn'),
      clearBtn: document.getElementById('pe-clear-btn'),
      list: document.getElementById('pe-list'),
      statusOverlay: document.getElementById('pe-status-overlay'),
      statusClose: document.getElementById('pe-status-close'),
      statusCurrent: document.getElementById('pe-status-current'),
      statusUpcoming: document.getElementById('pe-status-upcoming-list')
    };

    // Add toggle button to original UI
    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = 'Open Playlist Editor';
    toggleBtn.style.marginTop = '10px';
    toggleBtn.style.background = '#e5a00d'; // distinctive color
    toggleBtn.style.color = '#fff';
    toggleBtn.onclick = () => this.toggleEditor();

    const leftPanel = document.querySelector('.left');
    if (leftPanel) {
      leftPanel.appendChild(toggleBtn);
    }
  }

  bindEvents() {
    this.els.closeBtn.addEventListener('click', () => this.toggleEditor(false));
    this.els.statusClose.addEventListener('click', () => this.toggleStatus(false));
    
    this.els.addBtn.addEventListener('click', () => {
      const val = this.els.linkInput.value.trim();
      if (!val) return;
      const urls = val.split(/\\s+/).filter(Boolean);
      this.addItems(urls.map(u => ({
        url: u,
        title: 'Custom Link',
        source: 'Manual',
        views: 0,
        rating: 0
      })));
      this.els.linkInput.value = '';
    });

    this.els.clearBtn.addEventListener('click', () => {
      if (confirm('Clear the entire playlist?')) {
        this.queue = [];
        this.renderList();
        this.notifyChange();
      }
    });

    // Delegated events for remove / drag
    this.els.list.addEventListener('click', (e) => {
      if (e.target.classList.contains('pe-item-remove')) {
        const index = parseInt(e.target.dataset.index, 10);
        this.queue.splice(index, 1);
        this.renderList();
        this.notifyChange();
      }
    });

    // Native Drag and Drop
    let draggedIndex = null;

    this.els.list.addEventListener('dragstart', (e) => {
      const itemEl = e.target.closest('.pe-item');
      if (itemEl) {
        draggedIndex = parseInt(itemEl.dataset.index, 10);
        e.dataTransfer.effectAllowed = 'move';
        // Delay adding class so drag image looks right
        setTimeout(() => itemEl.classList.add('dragging'), 0);
      }
    });

    this.els.list.addEventListener('dragover', (e) => {
      e.preventDefault();
      const afterElement = this.getDragAfterElement(this.els.list, e.clientY);
      const draggable = document.querySelector('.dragging');
      if (draggable) {
        if (afterElement == null) {
          this.els.list.appendChild(draggable);
        } else {
          this.els.list.insertBefore(draggable, afterElement);
        }
      }
    });

    this.els.list.addEventListener('dragend', (e) => {
      const itemEl = e.target.closest('.pe-item');
      if (itemEl) {
        itemEl.classList.remove('dragging');
        this.reorderBasedOnDOM();
      }
    });
  }

  getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.pe-item:not(.dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  reorderBasedOnDOM() {
    const newItems = [];
    const elements = this.els.list.querySelectorAll('.pe-item');
    elements.forEach(el => {
      const idx = parseInt(el.dataset.index, 10);
      newItems.push(this.queue[idx]);
    });
    this.queue = newItems;
    this.renderList();
    this.notifyChange();
  }

  addItems(items) {
    this.queue.push(...items);
    this.renderList();
    this.notifyChange();
  }

  setQueue(newQueue, currentIndex) {
    this.queue = [...newQueue];
    this.currentIndex = currentIndex;
    this.renderList();
    this.updateStatus();
  }

  updatePlaybackState(index) {
    this.currentIndex = index;
    this.renderList();
    this.updateStatus();
    if (this.queue.length > 0) {
      this.toggleStatus(true);
    }
  }

  renderList() {
    this.els.list.innerHTML = '';
    this.queue.forEach((item, i) => {
      let isPlaying = (this.currentIndex % this.queue.length) === i;
      
      const el = document.createElement('div');
      el.className = 'pe-item';
      if (isPlaying) el.style.borderLeft = '4px solid #0a84ff';
      el.draggable = true;
      el.dataset.index = i;

      el.innerHTML = \`
        <div class="pe-item-drag-handle">☰</div>
        <div class="pe-item-content">
          <div class="pe-item-title">\${item.title || item.url || 'Unknown Track'}</div>
          <div class="pe-item-meta">
            \${item.source ? \`<span>Source: \${item.source}</span>\` : ''}
            \${item.views ? \`<span>Plays: \${item.views}</span>\` : ''}
            \${item.rating ? \`<span>Rating: \${item.rating}%</span>\` : ''}
          </div>
        </div>
        <button class="pe-item-remove" data-index="\${i}">Remove</button>
      \`;
      
      this.els.list.appendChild(el);
    });
  }

  updateStatus() {
    if (!this.queue.length) {
      this.els.statusCurrent.textContent = 'Queue is empty';
      this.els.statusUpcoming.innerHTML = '';
      return;
    }

    const effectiveIndex = this.currentIndex % this.queue.length;
    const currentItem = this.queue[effectiveIndex];
    this.els.statusCurrent.textContent = currentItem.title || currentItem.url;

    this.els.statusUpcoming.innerHTML = '';
    for (let i = 1; i <= 3; i++) {
       const nextIndex = (effectiveIndex + i) % this.queue.length;
       if (nextIndex === effectiveIndex) break; // looped around
       const nextItem = this.queue[nextIndex];
       const div = document.createElement('div');
       div.className = 'pe-status-upcoming-item';
       div.textContent = \`\${i}. \${nextItem.title || nextItem.url}\`;
       this.els.statusUpcoming.appendChild(div);
    }
  }

  toggleEditor(force) {
    const isHidden = this.els.editor.classList.contains('hidden');
    const show = force !== undefined ? force : isHidden;
    if (show) {
      this.els.editor.classList.remove('hidden');
    } else {
      this.els.editor.classList.add('hidden');
    }
  }

  toggleStatus(force) {
    const isHidden = this.els.statusOverlay.classList.contains('hidden');
    const show = force !== undefined ? force : isHidden;
    if (show) {
      this.els.statusOverlay.classList.remove('hidden');
    } else {
      this.els.statusOverlay.classList.add('hidden');
    }
  }

  notifyChange() {
    if (typeof this.onQueueChange === 'function') {
      this.onQueueChange(this.queue);
    }
  }
}

// Instantiate globally
window.PlaylistEditor = new PlaylistEditorClass();
