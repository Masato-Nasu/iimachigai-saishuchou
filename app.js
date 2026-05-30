(() => {
  'use strict';

  const DB_NAME = 'iimachigai-saishucho-db';
  const DB_VERSION = 1;
  const STORE = 'entries';
  const SETTINGS_KEY = 'iimachigai-saishucho-settings-v1';
  const EXPORT_VERSION = '1.2.0';

  const defaultSettings = { children: [] };

  const els = {
    appTitle: document.getElementById('appTitle'),
    appSubtitle: document.getElementById('appSubtitle'),
    setupPanel: document.getElementById('setupPanel'),
    setupForm: document.getElementById('setupForm'),
    childrenNames: document.getElementById('childrenNames'),
    form: document.getElementById('entryForm'),
    entryId: document.getElementById('entryId'),
    entryDate: document.getElementById('entryDate'),
    childName: document.getElementById('childName'),
    recorder: document.getElementById('recorder'),
    phrase: document.getElementById('phrase'),
    originalMeaning: document.getElementById('originalMeaning'),
    sceneNote: document.getElementById('sceneNote'),
    papaComment: document.getElementById('papaComment'),
    mamaComment: document.getElementById('mamaComment'),
    imageInput: document.getElementById('imageInput'),
    uploadStatus: document.getElementById('uploadStatus'),
    imagePreview: document.getElementById('imagePreview'),
    favorite: document.getElementById('favorite'),
    saveBtn: document.getElementById('saveBtn'),
    resetFormBtn: document.getElementById('resetFormBtn'),
    searchInput: document.getElementById('searchInput'),
    filterChild: document.getElementById('filterChild'),
    filterYear: document.getElementById('filterYear'),
    filterFavorite: document.getElementById('filterFavorite'),
    entryList: document.getElementById('entryList'),
    entryCounter: document.getElementById('entryCounter'),
    emptyState: document.getElementById('emptyState'),
    archiveGrid: document.getElementById('archiveGrid'),
    archiveEmpty: document.getElementById('archiveEmpty'),
    settingsCurrentTitle: document.getElementById('settingsCurrentTitle'),
    settingsForm: document.getElementById('settingsForm'),
    settingsChildrenText: document.getElementById('settingsChildrenText'),
    exportBtn: document.getElementById('exportBtn'),
    importInput: document.getElementById('importInput'),
    clearBtn: document.getElementById('clearBtn'),
    detailDialog: document.getElementById('detailDialog'),
    detailContent: document.getElementById('detailContent'),
    closeDialogBtn: document.getElementById('closeDialogBtn'),
    toast: document.getElementById('toast')
  };

  let db = null;
  let entries = [];
  let settings = { ...defaultSettings };
  let currentImages = [];
  let toastTimer = null;

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    settings = loadSettings();
    setToday();
    bindEvents();
    renderSettingsUi();
    try {
      db = await openDb();
      entries = (await dbGetAll()).map(normalizeEntry);
      maybeInferChildrenFromEntries();
      sortEntries();
      renderAll();
    } catch (error) {
      console.error(error);
      showToast('保存領域を開けませんでした。ブラウザ設定をご確認ください。');
    }

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }

  function bindEvents() {
    document.querySelectorAll('[data-view-target]').forEach((button) => {
      button.addEventListener('click', () => switchView(button.dataset.viewTarget));
    });

    els.setupForm.addEventListener('submit', onSettingsSubmit);
    els.settingsForm.addEventListener('submit', onSettingsSubmit);
    els.form.addEventListener('submit', onSubmit);
    els.resetFormBtn.addEventListener('click', resetForm);
    els.imageInput.addEventListener('change', onImagesSelected);

    [els.searchInput, els.filterChild, els.filterYear, els.filterFavorite].forEach((el) => {
      el.addEventListener('input', renderEntries);
      el.addEventListener('change', renderEntries);
    });

    els.exportBtn.addEventListener('click', exportJson);
    els.importInput.addEventListener('change', importJson);
    els.clearBtn.addEventListener('click', clearAllData);
    els.closeDialogBtn.addEventListener('click', () => els.detailDialog.close());
    els.detailDialog.addEventListener('click', (event) => {
      if (event.target === els.detailDialog) els.detailDialog.close();
    });
  }

  function switchView(viewName) {
    document.querySelectorAll('.view').forEach((view) => view.classList.remove('is-visible'));
    document.getElementById(`view-${viewName}`).classList.add('is-visible');
    document.querySelectorAll('.tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.viewTarget === viewName);
    });
    if (viewName === 'capture') setTimeout(() => els.phrase.focus(), 80);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function onSettingsSubmit(event) {
    event.preventDefault();
    const source = event.currentTarget === els.setupForm ? els.childrenNames : els.settingsChildrenText;
    const children = parseChildren(source.value);
    if (!children.length) {
      showToast('子どもの名前を1つ以上入力してください。');
      return;
    }
    settings = { children };
    saveSettings();
    renderSettingsUi();
    resetForm(false);
    renderEntries();
    showToast(`${getBookTitle()}に設定しました。`);
  }

  async function onSubmit(event) {
    event.preventDefault();
    const phrase = els.phrase.value.trim();
    if (!phrase) {
      showToast('ことば・できごとを入力してください。');
      return;
    }

    const existing = entries.find((item) => item.id === els.entryId.value);
    const now = new Date().toISOString();
    const entry = {
      id: existing?.id || newId(),
      date: els.entryDate.value || getLocalDateString(),
      childName: els.childName.value || '',
      recorder: els.recorder.value,
      phrase,
      originalMeaning: els.originalMeaning.value.trim(),
      sceneNote: els.sceneNote.value.trim(),
      papaComment: els.papaComment.value.trim(),
      mamaComment: els.mamaComment.value.trim(),
      images: currentImages,
      favorite: els.favorite.checked,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    try {
      await dbPut(entry);
      const index = entries.findIndex((item) => item.id === entry.id);
      if (index >= 0) entries[index] = entry;
      else entries.push(entry);
      sortEntries();
      renderAll();
      resetForm();
      showToast(existing ? '更新しました。' : '採取しました。');
      switchView('book');
    } catch (error) {
      console.error(error);
      showToast('保存できませんでした。写真を減らすか、バックアップ後に再度お試しください。');
    }
  }

  async function onImagesSelected(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    showToast('写真を読み込んでいます。');
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const dataUrl = await compressImage(file, 1600, 0.82);
        currentImages.push({
          id: newId(),
          name: file.name,
          dataUrl,
          createdAt: new Date().toISOString()
        });
      } catch (error) {
        console.error(error);
        showToast(`${file.name}を読み込めませんでした。`);
      }
    }
    event.target.value = '';
    renderImagePreview();
    showToast('写真を追加しました。');
  }

  function renderAll() {
    renderSettingsUi();
    renderFilterYears();
    renderFilterChildren();
    renderEntries();
    renderArchive();
  }

  function renderSettingsUi() {
    const title = getBookTitle();
    document.title = title;
    els.appTitle.textContent = title;
    els.appSubtitle.textContent = settings.children.length
      ? 'こどもの言葉と、家族のまなざしを残す採取帳。'
      : '最初に子どもの名前を入れると、語録としてはじめられます。';
    els.setupPanel.classList.toggle('is-hidden', settings.children.length > 0);
    const namesText = settings.children.join('\n');
    els.childrenNames.value = namesText;
    els.settingsChildrenText.value = namesText;
    els.settingsCurrentTitle.textContent = `現在の題名：${title}`;
    renderSpeakerOptions();
  }

  function renderSpeakerOptions(selectedValue = els.childName.value) {
    const children = settings.children;
    if (!children.length) {
      els.childName.innerHTML = '<option value="">名前を設定してください</option>';
      return;
    }
    const extra = selectedValue && !children.includes(selectedValue) ? [selectedValue] : [];
    const all = [...children, ...extra];
    els.childName.innerHTML = all.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('') +
      '<option value="その他">その他</option>';
    if (selectedValue && [...els.childName.options].some((option) => option.value === selectedValue)) {
      els.childName.value = selectedValue;
    } else {
      els.childName.value = children[0] || '';
    }
  }

  function renderFilterChildren() {
    const previous = els.filterChild.value;
    const names = [...new Set([
      ...settings.children,
      ...entries.map((entry) => entry.childName).filter(Boolean)
    ])];
    els.filterChild.innerHTML = '<option value="all">すべての話した人</option>' +
      names.map((name) => `<option value="${escapeAttr(name)}">${escapeHtml(name)}</option>`).join('');
    if ([...els.filterChild.options].some((option) => option.value === previous)) els.filterChild.value = previous;
  }

  function renderFilterYears() {
    const previous = els.filterYear.value;
    const years = [...new Set(entries.map((entry) => entry.date?.slice(0, 4)).filter(Boolean))].sort((a, b) => b.localeCompare(a));
    els.filterYear.innerHTML = '<option value="all">すべての年</option>' +
      years.map((year) => `<option value="${escapeAttr(year)}">${escapeHtml(year)}年</option>`).join('');
    if ([...els.filterYear.options].some((option) => option.value === previous)) els.filterYear.value = previous;
  }

  function getFilteredEntries() {
    const query = normalize(els.searchInput.value);
    const child = els.filterChild.value;
    const year = els.filterYear.value;
    const favorite = els.filterFavorite.value;

    return entries.filter((entry) => {
      if (child !== 'all' && entry.childName !== child) return false;
      if (year !== 'all' && !entry.date?.startsWith(year)) return false;
      if (favorite === 'favorite' && !entry.favorite) return false;
      if (!query) return true;
      const haystack = normalize([
        entry.phrase,
        entry.originalMeaning,
        entry.sceneNote,
        entry.papaComment,
        entry.mamaComment,
        entry.childName,
        entry.recorder
      ].join(' '));
      return haystack.includes(query);
    });
  }

  function renderEntries() {
    const filtered = getFilteredEntries();
    els.entryCounter.textContent = `${filtered.length}件 / 全${entries.length}件`;
    els.emptyState.classList.toggle('is-visible', entries.length === 0);

    if (!filtered.length) {
      els.entryList.innerHTML = entries.length ? '<div class="empty-state is-visible"><h3>該当する採取がありません</h3><p>検索やフィルターを変えてみてください。</p></div>' : '';
      return;
    }

    els.entryList.innerHTML = filtered.map((entry) => {
      const comments = [];
      if (entry.papaComment) comments.push('パパ');
      if (entry.mamaComment) comments.push('ママ');
      const thumb = entry.images?.[0]?.dataUrl ? `<img class="card-thumb" alt="原本写真" src="${entry.images[0].dataUrl}">` : '';
      return `
        <article class="entry-card" tabindex="0" role="button" data-entry-id="${escapeAttr(entry.id)}">
          ${entry.favorite ? '<div class="favorite-mark" aria-label="お気に入り">♥</div>' : ''}
          <div class="card-date">${escapeHtml(formatDate(entry.date))}</div>
          <h3 class="card-title">${escapeHtml(entry.phrase)}</h3>
          <div class="badges">
            ${entry.childName ? `<span class="badge">${escapeHtml(entry.childName)}</span>` : '<span class="badge neutral">話した人 未設定</span>'}
            ${entry.recorder ? `<span class="badge neutral">記録：${escapeHtml(entry.recorder)}</span>` : ''}
            ${comments.length ? `<span class="badge neutral">コメント：${escapeHtml(comments.join('・'))}</span>` : ''}
          </div>
          ${thumb}
        </article>
      `;
    }).join('');

    els.entryList.querySelectorAll('.entry-card').forEach((card) => {
      card.addEventListener('click', () => openDetail(card.dataset.entryId));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(card.dataset.entryId);
        }
      });
    });
  }

  function renderArchive() {
    const imageEntries = [];
    entries.forEach((entry) => {
      (entry.images || []).forEach((image) => imageEntries.push({ entry, image }));
    });

    els.archiveEmpty.classList.toggle('is-visible', imageEntries.length === 0);
    els.archiveGrid.innerHTML = imageEntries.map(({ entry, image }) => `
      <article class="archive-item" role="button" tabindex="0" data-entry-id="${escapeAttr(entry.id)}">
        <img alt="原本写真" src="${image.dataUrl}">
        <div class="archive-item__text">
          <small>${escapeHtml(formatDate(entry.date))}${entry.childName ? ` / ${escapeHtml(entry.childName)}` : ''}</small>
          <strong>${escapeHtml(truncate(entry.phrase, 44))}</strong>
        </div>
      </article>
    `).join('');

    els.archiveGrid.querySelectorAll('.archive-item').forEach((card) => {
      card.addEventListener('click', () => openDetail(card.dataset.entryId));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openDetail(card.dataset.entryId);
        }
      });
    });
  }

  function renderImagePreview() {
    if (!currentImages.length) {
      els.imagePreview.innerHTML = '';
      els.uploadStatus.textContent = 'まだ選択されていません';
      return;
    }
    els.uploadStatus.textContent = `${currentImages.length}枚追加済み`;
    els.imagePreview.innerHTML = currentImages.map((image) => `
      <div class="preview-item">
        <img alt="追加した写真" src="${image.dataUrl}">
        <button type="button" aria-label="写真を削除" data-image-id="${escapeAttr(image.id)}">×</button>
      </div>
    `).join('');

    els.imagePreview.querySelectorAll('button[data-image-id]').forEach((button) => {
      button.addEventListener('click', () => {
        currentImages = currentImages.filter((image) => image.id !== button.dataset.imageId);
        renderImagePreview();
      });
    });
  }

  function openDetail(id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    const comments = [];
    if (entry.papaComment) comments.push('パパ');
    if (entry.mamaComment) comments.push('ママ');

    els.detailContent.innerHTML = `
      <div class="detail-meta">
        <span class="badge">${escapeHtml(formatDate(entry.date))}</span>
        ${entry.childName ? `<span class="badge">${escapeHtml(entry.childName)}</span>` : ''}
        ${entry.recorder ? `<span class="badge neutral">記録：${escapeHtml(entry.recorder)}</span>` : ''}
        ${comments.length ? `<span class="badge neutral">コメント：${escapeHtml(comments.join('・'))}</span>` : ''}
        ${entry.favorite ? '<span class="badge">お気に入り</span>' : ''}
      </div>
      <h2 class="detail-title">${escapeHtml(entry.phrase)}</h2>
      ${entry.originalMeaning ? block('ほんとうは？', entry.originalMeaning) : ''}
      ${entry.sceneNote ? block('その時のこと', entry.sceneNote) : ''}
      ${entry.papaComment ? block('パパのコメント', entry.papaComment) : ''}
      ${entry.mamaComment ? block('ママのコメント', entry.mamaComment) : ''}
      ${(entry.images || []).length ? `
        <div class="detail-block">
          <h4>原本写真・絵・手紙</h4>
          <div class="detail-images">
            ${entry.images.map((image) => `<div class="detail-image-wrap"><img alt="原本写真" src="${image.dataUrl}"></div>`).join('')}
          </div>
        </div>
      ` : ''}
      <div class="detail-actions">
        <button class="primary" data-action="download-card" data-entry-id="${escapeAttr(entry.id)}">カードPNG保存</button>
        <button class="ghost" data-action="edit" data-entry-id="${escapeAttr(entry.id)}">編集</button>
        <button class="ghost" data-action="favorite" data-entry-id="${escapeAttr(entry.id)}">${entry.favorite ? 'お気に入り解除' : 'お気に入り'}</button>
        <button class="danger" data-action="delete" data-entry-id="${escapeAttr(entry.id)}">削除</button>
      </div>
    `;

    els.detailContent.querySelectorAll('[data-action]').forEach((button) => {
      button.addEventListener('click', async () => handleDetailAction(button.dataset.action, button.dataset.entryId));
    });

    if (!els.detailDialog.open) els.detailDialog.showModal();
  }

  function block(title, value) {
    return `<div class="detail-block"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(value)}</p></div>`;
  }

  async function handleDetailAction(action, id) {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    if (action === 'edit') {
      loadEntryIntoForm(entry);
      els.detailDialog.close();
      switchView('capture');
      showToast('編集できます。');
      return;
    }
    if (action === 'favorite') {
      entry.favorite = !entry.favorite;
      entry.updatedAt = new Date().toISOString();
      await dbPut(entry);
      renderAll();
      openDetail(id);
      showToast(entry.favorite ? 'お気に入りにしました。' : 'お気に入りを解除しました。');
      return;
    }
    if (action === 'delete') {
      if (!confirm('この採取を削除しますか？')) return;
      await dbDelete(id);
      entries = entries.filter((item) => item.id !== id);
      renderAll();
      els.detailDialog.close();
      showToast('削除しました。');
      return;
    }
    if (action === 'download-card') {
      await downloadCardPng(entry);
    }
  }

  function loadEntryIntoForm(entry) {
    els.entryId.value = entry.id;
    els.entryDate.value = entry.date || getLocalDateString();
    renderSpeakerOptions(entry.childName || '');
    els.recorder.value = entry.recorder || '';
    els.phrase.value = entry.phrase || '';
    els.originalMeaning.value = entry.originalMeaning || '';
    els.sceneNote.value = entry.sceneNote || '';
    els.papaComment.value = entry.papaComment || '';
    els.mamaComment.value = entry.mamaComment || '';
    els.favorite.checked = Boolean(entry.favorite);
    currentImages = [...(entry.images || [])];
    renderImagePreview();
    els.saveBtn.textContent = '更新する';
  }

  function resetForm(clearImages = true) {
    els.form.reset();
    els.entryId.value = '';
    if (clearImages) currentImages = [];
    renderSpeakerOptions();
    renderImagePreview();
    setToday();
    els.saveBtn.textContent = '採取する';
  }

  async function exportJson() {
    const data = {
      app: '言い間違い採取帳',
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      settings,
      entries
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const date = getLocalDateString().replaceAll('-', '');
    a.href = url;
    a.download = `iimachigai-saishucho-backup-${date}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('バックアップを書き出しました。');
  }

  async function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const incoming = Array.isArray(parsed) ? parsed : parsed.entries;
      if (!Array.isArray(incoming)) throw new Error('Invalid backup');
      if (!confirm(`${incoming.length}件を現在の採取帳に追加・上書きします。よろしいですか？`)) return;
      if (parsed.settings?.children?.length) {
        settings = { children: parseChildren(parsed.settings.children.join('\n')) };
        saveSettings();
      }
      for (const raw of incoming) {
        if (!raw || !raw.phrase) continue;
        const entry = normalizeEntry(raw);
        await dbPut(entry);
      }
      entries = (await dbGetAll()).map(normalizeEntry);
      maybeInferChildrenFromEntries();
      sortEntries();
      renderAll();
      showToast('復元しました。');
    } catch (error) {
      console.error(error);
      showToast('JSONを読み込めませんでした。');
    } finally {
      event.target.value = '';
    }
  }

  async function clearAllData() {
    if (!entries.length) {
      showToast('削除するデータがありません。');
      return;
    }
    if (!confirm('本当にすべて削除しますか？この操作は元に戻せません。')) return;
    if (!confirm('バックアップは取りましたか？')) return;
    await dbClear();
    entries = [];
    resetForm();
    renderAll();
    showToast('すべて削除しました。');
  }

  function normalizeEntry(raw) {
    return {
      id: String(raw.id || newId()),
      date: raw.date || getLocalDateString(),
      childName: raw.childName || '',
      recorder: raw.recorder || '',
      phrase: String(raw.phrase || '').trim(),
      originalMeaning: raw.originalMeaning || '',
      sceneNote: raw.sceneNote || '',
      papaComment: raw.papaComment || '',
      mamaComment: raw.mamaComment || '',
      images: Array.isArray(raw.images) ? raw.images.filter((img) => img && img.dataUrl) : [],
      favorite: Boolean(raw.favorite),
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString()
    };
  }

  async function compressImage(file, maxSide, quality) {
    const dataUrl = await readFileAsDataUrl(file);
    const img = await loadImage(dataUrl);
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffaf1';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  async function downloadCardPng(entry) {
    const canvas = document.createElement('canvas');
    const width = 1200;
    const height = 1600;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#fffaf1';
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = 'rgba(125, 101, 69, 0.20)';
    ctx.lineWidth = 4;
    roundRect(ctx, 70, 70, width - 140, height - 140, 44);
    ctx.stroke();

    ctx.fillStyle = 'rgba(217,146,40,0.12)';
    roundRect(ctx, 840, 110, 170, 88, 14);
    ctx.fill();

    ctx.fillStyle = '#d99228';
    ctx.font = '700 34px sans-serif';
    ctx.fillText(formatDate(entry.date), 118, 150);

    ctx.fillStyle = '#27231e';
    ctx.font = '700 66px sans-serif';
    let y = 265;
    y = drawWrappedText(ctx, entry.phrase, 118, y, width - 236, 88, 7);

    const meta = [entry.childName, entry.recorder ? `記録：${entry.recorder}` : ''].filter(Boolean).join(' / ');
    if (meta) {
      ctx.fillStyle = '#7c7164';
      ctx.font = '700 28px sans-serif';
      y += 38;
      y = drawWrappedText(ctx, meta, 118, y, width - 236, 42, 2);
    }

    const sections = [
      ['ほんとうは？', entry.originalMeaning],
      ['その時のこと', entry.sceneNote],
      ['パパのコメント', entry.papaComment],
      ['ママのコメント', entry.mamaComment]
    ].filter(([, value]) => value);

    ctx.font = '700 28px sans-serif';
    for (const [label, value] of sections) {
      y += 42;
      if (y > 1230) break;
      ctx.fillStyle = '#d99228';
      ctx.fillText(label, 118, y);
      y += 50;
      ctx.fillStyle = '#27231e';
      ctx.font = '400 34px sans-serif';
      y = drawWrappedText(ctx, value, 118, y, width - 236, 52, 5);
      ctx.font = '700 28px sans-serif';
    }

    ctx.strokeStyle = 'rgba(125,101,69,0.18)';
    ctx.beginPath();
    ctx.moveTo(118, 1390);
    ctx.lineTo(width - 118, 1390);
    ctx.stroke();

    ctx.fillStyle = '#27231e';
    ctx.font = '700 32px sans-serif';
    ctx.fillText(getBookTitle(), 118, 1456);
    ctx.fillStyle = '#7c7164';
    ctx.font = '400 25px sans-serif';
    ctx.fillText('なおす前に、残しておきたい言葉がある。', 118, 1506);

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `iimachigai-card-${(entry.date || '').replaceAll('-', '') || 'date'}-${entry.id.slice(0, 6)}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('カードPNGを保存しました。');
  }

  function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 99) {
    const lines = [];
    let line = '';
    const chars = String(text).split('');
    for (const char of chars) {
      if (char === '\n') {
        lines.push(line);
        line = '';
        continue;
      }
      const testLine = line + char;
      if (ctx.measureText(testLine).width > maxWidth && line) {
        lines.push(line);
        line = char;
      } else {
        line = testLine;
      }
    }
    if (line) lines.push(line);
    const shown = lines.slice(0, maxLines);
    shown.forEach((lineText, index) => {
      let out = lineText;
      if (index === maxLines - 1 && lines.length > maxLines) out = out.replace(/.$/, '…');
      ctx.fillText(out, x, y + index * lineHeight);
    });
    return y + shown.length * lineHeight;
  }

  function roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE)) {
          const store = database.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('category', 'category', { unique: false });
        }
      };
    });
  }

  function dbGetAll() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  function dbPut(entry) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).put(entry);
    });
  }

  function dbDelete(id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).delete(id);
    });
  }

  function dbClear() {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.objectStore(STORE).clear();
    });
  }

  function sortEntries() {
    entries.sort((a, b) => {
      const dateCompare = (b.date || '').localeCompare(a.date || '');
      if (dateCompare) return dateCompare;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  function setToday() {
    els.entryDate.value = getLocalDateString();
  }

  function getLocalDateString() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatDate(value) {
    if (!value) return '日付なし';
    const [year, month, day] = value.split('-');
    if (!year || !month || !day) return value;
    return `${Number(year)} / ${Number(month)} / ${Number(day)}`;
  }

  function truncate(text, length) {
    const value = String(text || '');
    return value.length > length ? `${value.slice(0, length)}…` : value;
  }

  function normalize(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, '');
  }

  function parseChildren(value) {
    const raw = Array.isArray(value) ? value.join('\n') : String(value || '');
    const names = raw.split(/[\n,、&＆]+/)
      .map((name) => name.trim())
      .filter(Boolean);
    return [...new Set(names)];
  }

  function getBookTitle() {
    if (!settings.children.length) return '言い間違い採取帳';
    return `${settings.children.join('＆')}語録`;
  }

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...defaultSettings };
      const parsed = JSON.parse(raw);
      return { children: parseChildren(parsed.children || []) };
    } catch {
      return { ...defaultSettings };
    }
  }

  function saveSettings() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }

  function maybeInferChildrenFromEntries() {
    if (settings.children.length) return;
    const inferred = [...new Set(entries.map((entry) => entry.childName).filter(Boolean))];
    if (!inferred.length) return;
    settings = { children: inferred };
    saveSettings();
  }

  function newId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll('`', '&#096;');
  }

  function showToast(message) {
    els.toast.textContent = message;
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2600);
  }
})();
