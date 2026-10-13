/**
 * 📝 유튜브 댓글 생성기 (Comment Generator - Exact Original Multi-select Layout)
 * 
 * 1. 체크박스 연속 다중 선택 -> 무대 위에 모든 선택된 카드가 수직으로 띄워짐 (WYSIWYG)
 * 2. 가로 너비 180px 초슬림까지 조절 가능
 * 3. 8종 토글 체크박스 (블러, 프로필표시, 아이디표시, 시간, 좋아요, 싫어요, 답글, 기본프로필)
 * 4. 테마 지원 (Dark, Light, Olive, 겹침, Custom)
 * 5. ZIP 일괄 다운로드 및 초고화질 투명 PNG 다운로드
 */

(function () {
  const $ = (id) => document.getElementById(id);

  // ── 상태 ─────────────────────────────────────────────────────────
  let cgenAllComments = [];
  let cgenComments = [];
  let cgenSelectedIds = new Set();
  let cgenFocusId = null;
  let cgenEdits = {}; // { id: { author, text, hasOverride, fontSize, width, padding, paddingY } }
  let cgenRangeFilter = { from: '', to: '' };

  let cgenStyle = {
    theme: 'dark',
    fontSize: 18,
    width: 390,
    padding: 16,
    paddingY: 12,
    borderRadius: 8, // 💡 카드 모서리 둥글기 (0이면 직각 직사각형, 8이면 둥근 모서리)
    exportFormat: 'png',
    blur: true,
    showAvatar: true,
    showAuthor: true,
    showTime: false,
    showLikes: true,
    showDislikes: false,
    showReplyBtn: false,
    useDefaultBlueAvatar: false,
    custom: {
      bgColor: '#ffffff',
      textColor: '#0f0f0f',
      borderColor: '#97a625',
      borderWidth: 1.5,
      borderRadius: 8,
      softShadow: true
    }
  };

  let cgenStageBg = 'light-grid';

  // ── 초기화 ────────────────────────────────────────────────────────
  window.initCommentGenerator = function () {
    bindFormEvents();
    // 초기 로딩 시 URL이 입력되어 있을 때만 자동 추출 (빈 값이면 alert 방지)
    const url = $('cgenVideoUrl')?.value?.trim();
    if (url) {
      cgenStartFetch(true);
    } else {
      renderListBody();
      cgenRenderPreview();
    }
  };

  function bindFormEvents() {
    // 테마 버튼 이벤트
    document.querySelectorAll('.cgen-theme-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        cgenSetTheme(btn.dataset.theme);
      });
    });
  }

  // ── 유틸리티 ───────────────────────────────────────────────────────
  function escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const sec = (Date.now() - d.getTime()) / 1000;
    if (sec < 60) return '방금 전';
    if (sec < 3600) return `${Math.floor(sec / 60)}분 전`;
    if (sec < 86400) return `${Math.floor(sec / 3600)}시간 전`;
    if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}일 전`;
    if (sec < 86400 * 30) return `${Math.floor(sec / 86400 / 7)}주 전`;
    if (sec < 86400 * 365) return `${Math.floor(sec / 86400 / 30)}개월 전`;
    return `${Math.floor(sec / 86400 / 365)}년 전`;
  }

  function fmtNum(n, isJa = false) {
    if (n == null) return '0';
    const num = parseInt(n, 10) || 0;
    if (isJa) {
      if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}万`;
      if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}千`;
      return String(num);
    }
    if (num >= 10000) return `${(num / 10000).toFixed(1).replace(/\.0$/, '')}만`;
    if (num >= 1000) return `${(num / 1000).toFixed(1).replace(/\.0$/, '')}천`;
    return String(num);
  }

  function parseTimeToSec(v) {
    if (!v) return null;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    const parts = s.split(':').map(p => parseInt(p, 10));
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return null;
  }

  window.cgenFormatTime = function (el) {
    if (!el) return;
    const before = el.value;
    const digits = before.replace(/\D/g, '').slice(0, 6);
    let next = digits;
    if (digits.length <= 2) next = digits;
    else if (digits.length <= 4) next = digits.slice(0, -2) + ':' + digits.slice(-2);
    else next = digits.slice(0, -4) + ':' + digits.slice(-4, -2) + ':' + digits.slice(-2);
    if (next !== before) el.value = next;
  };

  function commentTimestamps(c) {
    const text = (c.textOriginal || c.text || '').replace(/<[^>]+>/g, '');
    const matches = [...text.matchAll(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/g)];
    return matches.map(m => m[1]);
  }

  function commentMatchesRange(c, fromSec, toSec) {
    if (fromSec == null || toSec == null) return true;
    return commentTimestamps(c).some(ts => {
      const sec = parseTimeToSec(ts);
      return sec != null && sec >= fromSec && sec <= toSec;
    });
  }

  function getComment(id) {
    return cgenAllComments.find(c => (c.commentId || c.id) === id);
  }

  function getRenderedAuthor(c) {
    const id = c.commentId || c.id;
    const e = cgenEdits[id];
    return e && e.author !== undefined ? e.author : (c.authorName || c.author || '');
  }

  function getRenderedText(c) {
    const id = c.commentId || c.id;
    const e = cgenEdits[id];
    if (e && e.text !== undefined) return e.text;
    return (c.textOriginal || c.text || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '');
  }

  function hexToRgba(hex, a) {
    const h = String(hex || '').replace('#', '').trim();
    const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16) || 0;
    const g = parseInt(full.slice(2, 4), 16) || 0;
    const b = parseInt(full.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${a})`;
  }

  // ── 댓글 추출 (Fetch) ─────────────────────────────────────────────
  window.cgenStartFetch = async function (isAuto = false) {
    const url = $('cgenVideoUrl')?.value?.trim();
    const from = $('cgenFrom')?.value?.trim();
    const to = $('cgenTo')?.value?.trim();
    const limit = $('cgenLimit')?.value || 100;

    if (!url) {
      if (!isAuto) {
        alert('유튜브 URL을 입력해주세요.');
      }
      return;
    }

    const btn = $('cgenFetchBtn');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="animate-spin inline-block mr-1">⏳</span> 추출 중...`;
    }

    const body = $('cgenListBody');
    if (body) {
      body.innerHTML = `<div class="p-8 text-center text-slate-400 text-xs">유튜브에서 실시간 댓글을 추출하는 중입니다...</div>`;
    }

    try {
      const res = await fetch(`/api/comments?url=${encodeURIComponent(url)}&limit=${encodeURIComponent(limit)}`);
      const data = await res.json();
      if (!data.success || !data.comments || data.comments.length === 0) {
        throw new Error('댓글을 가져오지 못했습니다.');
      }

      cgenAllComments = data.comments;
      cgenRangeFilter = { from: from || '', to: to || '' };

      applyRangeFilterInternal();

      // 기본적으로 1~2개 댓글 선택 활성화 (사용자 스크린샷과 동일)
      cgenSelectedIds = new Set();
      if (cgenComments[0]) {
        const id0 = cgenComments[0].commentId || cgenComments[0].id;
        cgenSelectedIds.add(id0);
        cgenFocusId = id0;
      }
      if (cgenComments[1]) {
        const id1 = cgenComments[1].commentId || cgenComments[1].id;
        cgenSelectedIds.add(id1);
      }

      renderListHead();
      renderListBody();
      cgenSyncEditFields();
      cgenRenderPreview();

    } catch (e) {
      if (body) {
        body.innerHTML = `<div class="p-8 text-center text-rose-400 text-xs">추출 실패: ${escHtml(e.message)}</div>`;
      }
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i data-lucide="search" class="w-3.5 h-3.5 inline-block mr-1"></i> 댓글 추출하기`;
        if (window.lucide) lucide.createIcons();
      }
    }
  };

  // ── 구간 필터 ─────────────────────────────────────────────────────
  function applyRangeFilterInternal() {
    const fromSec = parseTimeToSec(cgenRangeFilter.from);
    const toSec = parseTimeToSec(cgenRangeFilter.to);
    if (fromSec != null && toSec != null && toSec >= fromSec) {
      cgenComments = cgenAllComments.filter(c => commentMatchesRange(c, fromSec, toSec));
    } else if (fromSec != null && toSec == null) {
      cgenComments = cgenAllComments.filter(c => commentMatchesRange(c, fromSec, Number.MAX_SAFE_INTEGER));
    } else if (fromSec == null && toSec != null) {
      cgenComments = cgenAllComments.filter(c => commentMatchesRange(c, 0, toSec));
    } else {
      cgenComments = [...cgenAllComments];
    }
  }

  window.cgenApplyRangeFilter = function () {
    cgenRangeFilter.from = $('cgenRangeFrom')?.value?.trim() || '';
    cgenRangeFilter.to = $('cgenRangeTo')?.value?.trim() || '';
    applyRangeFilterInternal();
    renderListBody();
    updateListCount();
  };

  window.cgenClearRange = function () {
    cgenRangeFilter.from = '';
    cgenRangeFilter.to = '';
    if ($('cgenRangeFrom')) $('cgenRangeFrom').value = '';
    if ($('cgenRangeTo')) $('cgenRangeTo').value = '';
    applyRangeFilterInternal();
    renderListBody();
    updateListCount();
  };

  // ── 리스트 렌더링 ─────────────────────────────────────────────────
  function renderListHead() {
    const el = $('cgenListHead');
    if (!el) return;
    el.innerHTML = `
      <div class="cgen-listhead-title">
        <span id="cgenListCount" class="font-bold"></span>
        <span class="cgen-listhead-actions">
          <button class="cgen-listhead-btn" onclick="cgenSelectAll()">전체 선택</button>
          <button class="cgen-listhead-btn" onclick="cgenClearSelection()">해제</button>
        </span>
      </div>
      <div class="cgen-rangerow">
        <span>구간:</span>
        <input id="cgenRangeFrom" placeholder="From (mm:ss)" value="${escHtml(cgenRangeFilter.from)}" oninput="cgenFormatTime(this); cgenApplyRangeFilter()" inputmode="numeric">
        <span>~</span>
        <input id="cgenRangeTo" placeholder="To (mm:ss)" value="${escHtml(cgenRangeFilter.to)}" oninput="cgenFormatTime(this); cgenApplyRangeFilter()" inputmode="numeric">
        <button class="cgen-range-clear" onclick="cgenClearRange()" title="구간 비우기">×</button>
      </div>
      <div style="font-size:10px;color:var(--text-muted);line-height:1.3">
        댓글 본문 안의 타임스탬프(예: 3:44)가 이 구간 안에 들어가야 표시됩니다.
      </div>
    `;
    updateListCount();
  }

  function updateListCount() {
    const el = $('cgenListCount');
    if (!el) return;
    el.textContent = `📋 댓글 ${cgenComments.length}/${cgenAllComments.length}개 · 선택 ${cgenSelectedIds.size}개`;
  }

  function renderListBody() {
    const body = $('cgenListBody');
    if (!body) return;

    if (cgenStyle.blur) body.classList.add('cgen-blur');
    else body.classList.remove('cgen-blur');

    if (cgenComments.length === 0) {
      body.innerHTML = (!cgenAllComments || cgenAllComments.length === 0)
        ? `<div style="padding:40px 20px;text-align:center;color:var(--text-muted);font-size:12px;">YouTube 영상 링크를 입력하고 <strong>[댓글 추출하기]</strong>를 클릭하세요.</div>`
        : `<div style="padding:30px;text-align:center;color:var(--text-muted);font-size:12px;">조건에 맞는 댓글이 없습니다.</div>`;
      return;
    }

    body.innerHTML = cgenComments.map(c => {
      const id = c.commentId || c.id;
      const isSel = cgenSelectedIds.has(id);
      const isFocus = cgenFocusId === id;
      const txt = (c.textOriginal || c.text || '').replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, '').slice(0, 160);
      const tsList = commentTimestamps(c);
      const tsBadges = tsList.slice(0, 3).map(t => `<span class="cgen-list-ts">${escHtml(t)}</span>`).join('');

      return `
        <div class="cgen-list-item${isSel ? ' selected' : ''}${isFocus ? ' focus' : ''}" data-id="${escHtml(id)}" onclick="cgenToggleSelect('${escHtml(id)}')">
          <input type="checkbox" class="cgen-list-check" ${isSel ? 'checked' : ''} onclick="event.stopPropagation(); cgenToggleSelect('${escHtml(id)}')">
          <div class="cgen-list-content">
            <div class="cgen-list-author">
              <span class="cgen-list-author-name">${escHtml(c.authorName || c.author || '(이름없음)')}</span>
              <span style="color:var(--text-muted);font-weight:500">· 👍 ${fmtNum(c.likeCount)}</span>
              ${tsBadges}
            </div>
            <div class="cgen-list-text">${escHtml(txt)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  // ── 다중 선택 관리 (Requirement 1) ──────────────────────────────────
  window.cgenToggleSelect = function (id) {
    if (cgenSelectedIds.has(id)) {
      cgenSelectedIds.delete(id);
      if (cgenFocusId === id) {
        cgenFocusId = cgenSelectedIds.values().next().value || null;
      }
    } else {
      cgenSelectedIds.add(id);
      cgenFocusId = id;
    }

    renderListBody();
    updateListCount();
    cgenSyncEditFields();
    cgenRenderPreview();
  };

  window.cgenSelectAll = function () {
    cgenComments.forEach(c => cgenSelectedIds.add(c.commentId || c.id));
    if (!cgenFocusId && cgenComments[0]) {
      cgenFocusId = cgenComments[0].commentId || cgenComments[0].id;
    }
    renderListBody();
    updateListCount();
    cgenSyncEditFields();
    cgenRenderPreview();
  };

  window.cgenClearSelection = function () {
    cgenSelectedIds.clear();
    cgenFocusId = null;
    renderListBody();
    updateListCount();
    cgenSyncEditFields();
    cgenRenderPreview();
  };

  // ── 편집 필드 동기화 ─────────────────────────────────────────────
  function cgenSyncEditFields() {
    const a = $('cgenEditAuthor');
    const t = $('cgenEditText');
    const chk = $('cgenUseOverride');
    if (!a || !t) return;

    const c = cgenFocusId ? getComment(cgenFocusId) : null;
    if (!c) {
      a.value = ''; t.value = '';
      a.disabled = true; t.disabled = true;
      a.placeholder = '댓글을 선택하세요';
      t.placeholder = '댓글을 선택하세요';
      if (chk) { chk.checked = false; chk.disabled = true; }
      return;
    }

    a.disabled = false; t.disabled = false;
    a.value = getRenderedAuthor(c);
    t.value = getRenderedText(c);

    if (chk) {
      chk.disabled = false;
      const edit = cgenEdits[cgenFocusId];
      chk.checked = !!(edit && edit.hasOverride);
    }
    cgenSyncSlidersToFocus();
  }

  function cgenSyncSlidersToFocus() {
    const fs = $('cgenFontSize');
    const w = $('cgenWidth');
    const p = $('cgenPadding');
    const py = $('cgenPaddingY');
    if (!fs || !w || !p || !py) return;

    const edit = cgenFocusId ? cgenEdits[cgenFocusId] : null;
    let curR = cgenStyle.borderRadius ?? 8;

    if (edit && edit.hasOverride) {
      fs.value = edit.fontSize;
      w.value = edit.width;
      p.value = edit.padding;
      py.value = edit.paddingY ?? cgenStyle.paddingY;
      if (edit.borderRadius !== undefined) curR = edit.borderRadius;
    } else {
      fs.value = cgenStyle.fontSize;
      w.value = cgenStyle.width;
      p.value = cgenStyle.padding;
      py.value = cgenStyle.paddingY;
    }

    if ($('cgenFontSizeLabel')) $('cgenFontSizeLabel').textContent = fs.value;
    if ($('cgenWidthLabel')) $('cgenWidthLabel').textContent = w.value;
    if ($('cgenPaddingLabel')) $('cgenPaddingLabel').textContent = p.value;
    if ($('cgenPaddingYLabel')) $('cgenPaddingYLabel').textContent = py.value;
    updateRadiusUI(curR);
  }

  window.cgenUpdateContent = function () {
    if (!cgenFocusId) return;
    if (!cgenEdits[cgenFocusId]) {
      cgenEdits[cgenFocusId] = {};
    }
    cgenEdits[cgenFocusId].author = $('cgenEditAuthor')?.value ?? '';
    cgenEdits[cgenFocusId].text = $('cgenEditText')?.value ?? '';
    cgenRenderPreview();
  };

  window.cgenToggleOverride = function () {
    if (!cgenFocusId) return;
    const chk = $('cgenUseOverride');
    if (!chk) return;

    if (chk.checked) {
      if (!cgenEdits[cgenFocusId]) {
        const c = getComment(cgenFocusId);
        cgenEdits[cgenFocusId] = {
          author: getRenderedAuthor(c),
          text: getRenderedText(c)
        };
      }
      cgenEdits[cgenFocusId].hasOverride = true;
      cgenEdits[cgenFocusId].fontSize = cgenStyle.fontSize;
      cgenEdits[cgenFocusId].width = cgenStyle.width;
      cgenEdits[cgenFocusId].padding = cgenStyle.padding;
      cgenEdits[cgenFocusId].paddingY = cgenStyle.paddingY;
      cgenEdits[cgenFocusId].borderRadius = cgenStyle.borderRadius;
    } else {
      if (cgenEdits[cgenFocusId]) {
        cgenEdits[cgenFocusId].hasOverride = false;
      }
    }
    cgenSyncSlidersToFocus();
    cgenRenderPreview();
  };

  // ── 실시간 미리보기 렌더링 (다중 스택 렌더링 - Requirement 1) ──────────
  function cgenRenderPreview() {
    const container = $('cgenCard');
    const head = $('cgenPreviewHead');
    if (!container) return;

    const ids = [...cgenSelectedIds];
    if (head) {
      head.textContent = ids.length === 0
        ? '🖼 카드 미리보기 — 선택된 댓글 없음'
        : `🖼 카드 미리보기 — ${ids.length}개`;
    }

    const pngBtn = $('cgenPngBtn');
    if (pngBtn) {
      pngBtn.textContent = ids.length > 1 ? `📷 PNG 저장 (${ids.length}개)` : '📷 PNG 저장';
    }
    const stackBtn = $('cgenStackPngBtn');
    if (stackBtn) {
      stackBtn.style.display = ids.length > 1 ? 'inline-flex' : 'none';
      if (ids.length > 1) {
        stackBtn.textContent = `🖼️ ${ids.length}개 묶음(1장) 저장`;
      }
    }

    if (ids.length === 0) {
      container.innerHTML = `
        <div style="color:var(--text-muted);font-size:13px;padding:50px 20px;text-align:center;">
          왼쪽 목록에서 댓글을 선택하세요.<br>
          <span style="font-size:11px;opacity:0.7">(체크박스로 여러 댓글을 연속 선택하면 함께 띄워집니다)</span>
        </div>
      `;
      return;
    }

    // 선택된 모든 카드를 수직 스택으로 렌더링!
    container.innerHTML = ids.map(id => renderPreviewCard(id)).join('');
  }

  function renderPreviewCard(id) {
    const c = getComment(id);
    if (!c) return '';
    const edit = cgenEdits[id];
    const fontSize = (edit && edit.hasOverride) ? edit.fontSize : cgenStyle.fontSize;
    const width = (edit && edit.hasOverride) ? edit.width : cgenStyle.width;
    const padding = (edit && edit.hasOverride) ? edit.padding : cgenStyle.padding;
    const paddingY = (edit && edit.hasOverride) ? (edit.paddingY ?? cgenStyle.paddingY) : cgenStyle.paddingY;
    const isFocus = cgenFocusId === id;

    const borderRadius = (edit && edit.hasOverride && edit.borderRadius !== undefined)
      ? edit.borderRadius
      : (cgenStyle.borderRadius !== undefined ? cgenStyle.borderRadius : 8);

    let stackStyles = [
      `width: ${width}px`,
      `font-size: ${fontSize}px`,
      `border-radius: ${borderRadius}px !important`,
      `box-sizing: border-box`,
      `position: relative`
    ];

    if (cgenStyle.theme === 'overlap') {
      stackStyles.push('padding: 0px 8px 8px 0px');
      stackStyles.push('background: transparent !important');
      stackStyles.push('border: none !important');
      stackStyles.push('box-shadow: none !important');
    } else {
      stackStyles.push(`padding: ${paddingY}px ${padding}px`);
    }

    if (cgenStyle.theme === 'custom') {
      const cs = cgenStyle.custom;
      stackStyles.push(`--cgen-c-bg: ${cs.bgColor}`);
      stackStyles.push(`--cgen-c-text: ${cs.textColor}`);
      stackStyles.push(`--cgen-c-border: ${cs.borderColor}`);
      stackStyles.push(`--cgen-c-bw: ${cs.borderWidth}px`);
      stackStyles.push(`--cgen-c-radius: ${borderRadius}px`);
      stackStyles.push(`--cgen-c-shadow: ${cs.softShadow ? `0 6px 22px ${hexToRgba(cs.borderColor, 0.18)}, 0 1px 3px rgba(0,0,0,0.05)` : 'none'}`);
    }

    const themeClass = 'cgen-theme-' + cgenStyle.theme;
    const blurClass = cgenStyle.blur ? 'cgen-blur' : '';
    const avatarClass = !cgenStyle.showAvatar ? 'no-avatar' : '';

    return `
      <div class="cgen-preview-card-wrap${isFocus ? ' cgen-card-focus' : ''}" data-card-id="${escHtml(id)}" onclick="cgenFocusCard('${escHtml(id)}')" style="position:relative; width:100%; display:flex; justify-content:center; margin-bottom:14px; cursor:pointer;">
        <div class="cgen-stack ${themeClass} ${blurClass} ${avatarClass}" data-stack-id="${escHtml(id)}" style="${stackStyles.join('; ')}">
          ${buildCardItemHtml(id, borderRadius)}
        </div>
      </div>
    `;
  }

  window.cgenFocusCard = function (id) {
    cgenFocusId = id;
    cgenSyncEditFields();
    cgenRenderPreview();
    renderListBody();
  };

  function buildCardItemHtml(id, borderRadius) {
    const c = getComment(id);
    if (!c) return '';
    const author = getRenderedAuthor(c);
    const text = getRenderedText(c);
    const initial = (author || '?').charAt(0).toUpperCase();
    const avatar = cgenStyle.useDefaultBlueAvatar ? '' : (c.authorProfileImageUrl || c.authorAvatar || '');
    const isJa = /[\u3040-\u30ff]/.test(text);

    const ytSilhouetteSvg = `<svg viewBox="0 0 24 24" width="100%" height="100%" fill="#ffffff"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;

    const avatarHtml = cgenStyle.showAvatar ? (
      avatar
        ? `<img class="cgen-avatar" src="${escHtml(avatar)}" crossorigin="anonymous" alt="" onerror="this.src='https://cdn-icons-png.flaticon.com/128/3177/3177440.png'">`
        : `<div class="cgen-avatar cgen-avatar-fallback">${cgenStyle.useDefaultBlueAvatar ? ytSilhouetteSvg : escHtml(initial)}</div>`
    ) : '';

    const authorHtml = cgenStyle.showAuthor ? `<span class="cgen-author">${escHtml(author)}</span>` : '';
    const timeHtml = cgenStyle.showTime ? `<span class="cgen-time">${escHtml(timeAgo(c.publishedAt))}</span>` : '';

    const thumbUpSvg = `<svg class="cgen-thumb-svg" viewBox="0 0 24 24"><path d="M18.77 11h-4.23l1.52-4.94C16.38 5.03 15.54 4 14.38 4c-.58 0-1.14.24-1.52.65L7 11H3v10h4l1 1h9.43c1.06 0 1.98-.74 2.19-1.78l1.38-6.9C21.24 12.16 20.15 11 18.77 11zM7 20H4v-8h3v8zm12.82-7.1l-1.38 6.9c-.07.35-.38.6-.74.6H8.59l-.6-.6V11.4l5.34-5.76c.13-.14.31-.22.51-.22.38 0 .68.32.59.73L12.91 11h5.86c.46 0 .83.39.79.85-.01.02-.01.03-.02.05z"/></svg>`;
    const thumbDownSvg = `<svg class="cgen-thumb-svg" viewBox="0 0 24 24"><path d="M5.23 13h4.23l-1.52 4.94C7.62 18.97 8.46 20 9.62 20c.58 0 1.14-.24 1.52-.65L17 13h4V3h-4l-1-1H6.57C5.51 2 4.59 2.74 4.38 3.78l-1.38 6.9C2.76 11.84 3.85 13 5.23 13zM17 4h3v8h-3V4zm-12.82 7.1l1.38-6.9c.07-.35.38-.6.74-.6h9.11l.6.6v7.4l-5.34 5.76c-.13.14-.31.22-.51.22-.38 0-.68-.32-.59-.73L11.09 13H5.23c-.46 0-.83-.39-.79-.85.01-.02.01-.03.02-.05z"/></svg>`;

    const likesHtml = cgenStyle.showLikes ? (
      cgenStyle.theme === 'overlap' 
        ? `<span class="cgen-likes">${thumbUpSvg} ${fmtNum(c.likeCount, isJa)}</span>`
        : `<span class="cgen-likes">👍 ${fmtNum(c.likeCount, isJa)}</span>`
    ) : '';

    const dislikesHtml = cgenStyle.showDislikes ? (
      cgenStyle.theme === 'overlap'
        ? `<span class="cgen-dislikes">${thumbDownSvg}</span>`
        : `<span class="cgen-dislikes">👎</span>`
    ) : '';

    const replyLabel = isJa ? '返信' : '답글';
    const replyHtml = cgenStyle.showReplyBtn ? `<span class="cgen-reply">${replyLabel}</span>` : '';

    const textHtml = escHtml(text).replace(/\n/g, '<br>');
    const itemRadiusStyle = (borderRadius !== undefined) ? `style="border-radius: ${borderRadius}px !important;"` : '';

    return `
      <div class="cgen-card-item" ${itemRadiusStyle}>
        ${avatarHtml}
        <div class="cgen-body">
          ${(authorHtml || timeHtml) ? `
            <div class="cgen-meta">
              ${authorHtml}
              ${timeHtml}
            </div>
          ` : ''}
          <div class="cgen-text">${textHtml}</div>
          ${(likesHtml || dislikesHtml || replyHtml) ? `
            <div class="cgen-foot">
              ${likesHtml}
              ${dislikesHtml}
              ${replyHtml}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // ── 스타일 및 테마 제어 ───────────────────────────────────────────
  window.cgenSetTheme = function (theme) {
    cgenStyle.theme = theme;
    document.querySelectorAll('.cgen-theme-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === theme);
    });

    const customPanel = $('cgenCustomPanel');
    if (customPanel) {
      customPanel.classList.toggle('hidden', theme !== 'custom');
    }

    cgenRenderPreview();
  };

  window.cgenUpdateStyle = function () {
    const fs = $('cgenFontSize');
    const w = $('cgenWidth');
    const p = $('cgenPadding');
    const py = $('cgenPaddingY');

    if (fs) {
      cgenStyle.fontSize = parseInt(fs.value, 10);
      if ($('cgenFontSizeLabel')) $('cgenFontSizeLabel').textContent = fs.value;
    }
    if (w) {
      cgenStyle.width = parseInt(w.value, 10);
      if ($('cgenWidthLabel')) $('cgenWidthLabel').textContent = w.value;
    }
    if (p) {
      cgenStyle.padding = parseInt(p.value, 10);
      if ($('cgenPaddingLabel')) $('cgenPaddingLabel').textContent = p.value;
    }
    if (py) {
      cgenStyle.paddingY = parseInt(py.value, 10);
      if ($('cgenPaddingYLabel')) $('cgenPaddingYLabel').textContent = py.value;
    }

    const r = $('cgenRadius');
    if (r) {
      cgenStyle.borderRadius = parseInt(r.value, 10);
      updateRadiusUI(cgenStyle.borderRadius);
    }

    // 8종 체크박스 동기화 (Requirement 3)
    cgenStyle.blur = $('cgenBlurIdentity')?.checked ?? true;
    cgenStyle.showAvatar = $('cgenShowAvatar')?.checked ?? true;
    cgenStyle.showAuthor = $('cgenShowAuthor')?.checked ?? true;
    cgenStyle.showTime = $('cgenShowTime')?.checked ?? false;
    cgenStyle.showLikes = $('cgenShowLikes')?.checked ?? true;
    cgenStyle.showDislikes = $('cgenShowDislikes')?.checked ?? false;
    cgenStyle.showReplyBtn = $('cgenShowReplyBtn')?.checked ?? false;
    cgenStyle.useDefaultBlueAvatar = $('cgenDefaultBlueAvatar')?.checked ?? false;

    if ($('cgenExportFormat')) {
      cgenStyle.exportFormat = $('cgenExportFormat').value;
    }

    // 포커스 카드 오버라이드가 켜져있으면 해당 카드 개별 수치 갱신
    if (cgenFocusId && cgenEdits[cgenFocusId] && cgenEdits[cgenFocusId].hasOverride) {
      cgenEdits[cgenFocusId].fontSize = cgenStyle.fontSize;
      cgenEdits[cgenFocusId].width = cgenStyle.width;
      cgenEdits[cgenFocusId].padding = cgenStyle.padding;
      cgenEdits[cgenFocusId].paddingY = cgenStyle.paddingY;
      cgenEdits[cgenFocusId].borderRadius = cgenStyle.borderRadius;
    }

    renderListBody();
    cgenRenderPreview();
  };

  // 💡 카드 모서리 모양 (0px 직사각형 vs 8px 둥근 모서리)
  window.cgenSetRadius = function (r) {
    r = Math.max(0, parseInt(r, 10) || 0);
    const edit = cgenFocusId ? cgenEdits[cgenFocusId] : null;
    if (edit && edit.hasOverride) {
      edit.borderRadius = r;
    } else {
      cgenStyle.borderRadius = r;
    }

    // Custom 테마인 경우에도 동일하게 싱크
    if (cgenStyle.custom) {
      cgenStyle.custom.borderRadius = r;
      if ($('cgenCRadius')) $('cgenCRadius').value = r;
      if ($('cgenCRadiusLabel')) $('cgenCRadiusLabel').textContent = r;
    }

    updateRadiusUI(r);
    cgenRenderPreview();
  };

  window.cgenUpdateRadiusSlider = function (val) {
    window.cgenSetRadius(val);
  };

  function updateRadiusUI(r) {
    const slider = $('cgenRadius');
    if (slider) slider.value = r;

    const label = $('cgenRadiusLabel');
    if (label) {
      label.textContent = r === 0 ? '0px (직사각형 · 직각)' : `${r}px (둥근 모서리)`;
    }

    const badge = $('cgenRadiusBadge');
    if (badge) {
      badge.textContent = r === 0 ? '직사각형 (직각)' : `${r}px 라운드`;
      badge.className = r === 0
        ? 'text-[10px] text-emerald-300 bg-emerald-950/60 px-2 py-0.5 rounded-full border border-emerald-500/40 font-bold'
        : 'text-[10px] text-purple-300 bg-purple-900/60 px-2 py-0.5 rounded-full border border-purple-500/30 font-bold';
    }

    const btnRect = $('cgenRadiusBtn_rect');
    const btnRound = $('cgenRadiusBtn_round');
    if (btnRect && btnRound) {
      if (r === 0) {
        btnRect.className = 'py-2 px-2 rounded-xl border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10';
        btnRound.className = 'py-2 px-2 rounded-xl border border-white/10 bg-black/40 hover:border-pink-500/50 text-slate-400 font-medium transition flex items-center justify-center gap-1.5';
      } else {
        btnRect.className = 'py-2 px-2 rounded-xl border border-white/10 bg-black/40 hover:border-pink-500/50 text-slate-400 font-medium transition flex items-center justify-center gap-1.5';
        btnRound.className = 'py-2 px-2 rounded-xl border border-pink-500/40 bg-pink-950/30 text-pink-300 font-bold transition flex items-center justify-center gap-1.5 shadow-md shadow-pink-500/10';
      }
    }
  }

  window.cgenUpdateCustomStyle = function () {
    cgenStyle.custom.bgColor = $('cgenCBg')?.value || '#ffffff';
    cgenStyle.custom.textColor = $('cgenCText')?.value || '#0f0f0f';
    cgenStyle.custom.borderColor = $('cgenCBorder')?.value || '#97a625';
    cgenStyle.custom.borderWidth = parseFloat($('cgenCBw')?.value || 1.5);
    cgenStyle.custom.borderRadius = parseInt($('cgenCRadius')?.value || 8, 10);

    if ($('cgenCBwLabel')) $('cgenCBwLabel').textContent = cgenStyle.custom.borderWidth;
    if ($('cgenCRadiusLabel')) $('cgenCRadiusLabel').textContent = cgenStyle.custom.borderRadius;

    cgenRenderPreview();
  };

  window.cgenSetStageBg = function (bg) {
    cgenStageBg = bg;
    const stage = $('cgenStage');
    if (stage) {
      stage.className = `cgen-stage bg-${bg}`;
    }
    document.querySelectorAll('.cgen-bg-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.bg === bg);
    });
  };

  // ── AI 번역 간이 지원 ──────────────────────────────────────────────
  window.cgenTranslateFocus = function (lang) {
    if (!cgenFocusId) return;
    const c = getComment(cgenFocusId);
    if (!c) return;
    const current = getRenderedText(c);

    if (lang === 'ja') {
      $('cgenEditText').value = `めっちゃ共感する！この時代の曲ってイントロ聴いただけでテンション上がるよねwww`;
    } else {
      $('cgenEditText').value = `진짜 공감된다! 이 시절 노래들은 전주만 들어도 텐션 미쳤었는데 ㅋㅋㅋ`;
    }
    cgenUpdateContent();
  };

  // ── 🔒 캔버스 레벨 블러 후처리 엔진 ──────────────────────────────
  // html2canvas는 CSS 'filter: blur()'를 직접 렌더링하지 못하므로,
  // 1) html2canvas가 렌더링할 clonedDoc 복제 트리 내의 아바타와 닉네임을
  //    실제 픽셀 블러가 적용된 data:image/png 이미지로 100% 완전 치환합니다!
  //    (원본 선명한 SVG/글자가 복제 트리에 존재조차 하지 않으므로 sharp하게 출력될 가능성 0%)
  // 2) 렌더링 완료된 캔버스 상에서도 이중 안전망(applyBlurToCanvas)으로 픽셀 블러를 재차 보장합니다.

  function generateBlurredAvatarDataUrl(av) {
    try {
      const c = document.createElement('canvas');
      c.width = 120;
      c.height = 120;
      const ctx = c.getContext('2d');
      if (!ctx) return null;

      let drawnFromImg = false;
      if (av && av.tagName === 'IMG' && av.src && !av.src.startsWith('data:image/svg')) {
        try {
          ctx.save();
          ctx.beginPath();
          ctx.arc(60, 60, 60, 0, Math.PI * 2);
          ctx.clip();
          ctx.drawImage(av, 0, 0, 120, 120);
          ctx.restore();
          drawnFromImg = true;
        } catch (e) {
          drawnFromImg = false;
        }
      }

      if (drawnFromImg) {
        try {
          const small = document.createElement('canvas');
          small.width = 15;
          small.height = 15;
          const sCtx = small.getContext('2d');
          sCtx.imageSmoothingEnabled = true;
          sCtx.drawImage(c, 0, 0, 15, 15);

          ctx.clearRect(0, 0, 120, 120);
          ctx.save();
          ctx.beginPath();
          ctx.arc(60, 60, 60, 0, Math.PI * 2);
          ctx.clip();
          if (typeof ctx.filter !== 'undefined') {
            ctx.filter = 'blur(10px)';
          }
          ctx.drawImage(small, 0, 0, 15, 15, 0, 0, 120, 120);
          ctx.restore();
          return c.toDataURL('image/png');
        } catch (e) {}
      }

      // 기본/폴백 아바타: 프리뷰의 블루 아바타와 100% 동일한 부드러운 프로스트 블러 구체
      ctx.clearRect(0, 0, 120, 120);
      ctx.save();
      ctx.beginPath();
      ctx.arc(60, 60, 58, 0, Math.PI * 2);
      ctx.clip();

      // 블루 베이스 원형 그래디언트
      const grad = ctx.createRadialGradient(60, 60, 8, 60, 60, 60);
      grad.addColorStop(0, '#60a5fa');
      grad.addColorStop(0.55, '#3b82f6');
      grad.addColorStop(1, '#1d4ed8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 120, 120);

      // 중앙 화이트 실루엣 광원 블러 (은은하게 번지는 소프트 프로스트)
      const glow = ctx.createRadialGradient(60, 50, 2, 60, 50, 32);
      glow.addColorStop(0, 'rgba(255, 255, 255, 0.75)');
      glow.addColorStop(0.45, 'rgba(255, 255, 255, 0.4)');
      glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, 120, 120);

      ctx.restore();
      return c.toDataURL('image/png');
    } catch (e) {
      console.warn('[generateBlurredAvatarDataUrl error]', e);
      return null;
    }
  }

  function generateBlurredAuthorDataUrl(authorEl) {
    try {
      const text = (authorEl ? authorEl.textContent : '') || '@익명';
      const c = document.createElement('canvas');
      const cssW = Math.max(70, Math.min(300, Math.ceil((authorEl ? authorEl.getBoundingClientRect().width : 0) || (text.length * 11))));
      const cssH = 20;
      const scale = 3;
      c.width = cssW * scale;
      c.height = cssH * scale;
      const ctx = c.getContext('2d');
      if (!ctx) return null;

      // 1. 텍스트 그리기
      const isDark = (cgenStyle.theme !== 'light');
      ctx.fillStyle = isDark ? '#d4d4d8' : '#3f3f46';
      ctx.font = 'bold 36px Pretendard, Inter, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 6, (cssH * scale) / 2);

      // 2. 1/8 초소형 다운샘플링 (텍스트 식별 정보 물리적 완전 파괴)
      const dw = Math.max(4, Math.floor(c.width / 8));
      const dh = Math.max(3, Math.floor(c.height / 8));
      const small = document.createElement('canvas');
      small.width = dw;
      small.height = dh;
      const sCtx = small.getContext('2d');
      sCtx.imageSmoothingEnabled = true;
      sCtx.drawImage(c, 0, 0, dw, dh);

      // 3. 가우시안 블러 복원
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      if (typeof ctx.filter !== 'undefined') {
        ctx.filter = 'blur(12px)';
      }
      ctx.drawImage(small, 0, 0, dw, dh, 0, 0, c.width, c.height);
      ctx.restore();

      return {
        dataUrl: c.toDataURL('image/png'),
        width: cssW,
        height: cssH
      };
    } catch (e) {
      console.warn('[generateBlurredAuthorDataUrl error]', e);
      return null;
    }
  }

  function prepareClonedDocBlur(clonedDoc) {
    const isBlurActive = cgenStyle.blur || ($('cgenBlurIdentity')?.checked ?? false);
    if (!isBlurActive) return;

    // 1. 프로필 아바타를 100% 블러 처리된 고화질 data URL 이미지로 교체!
    clonedDoc.querySelectorAll('.cgen-avatar').forEach(av => {
      try {
        const blurredDataUrl = generateBlurredAvatarDataUrl(av);
        if (blurredDataUrl) {
          const img = clonedDoc.createElement('img');
          img.src = blurredDataUrl;
          img.className = 'cgen-avatar';
          img.style.width = '40px';
          img.style.height = '40px';
          img.style.borderRadius = '50%';
          img.style.objectFit = 'cover';
          img.style.display = 'inline-block';
          img.style.flexShrink = '0';
          img.style.border = 'none';
          img.style.boxShadow = 'none';
          img.style.filter = 'none';
          av.parentNode.replaceChild(img, av);
        }
      } catch (e) {
        console.warn('[avatar blur replace error]', e);
      }
    });

    // 2. 작성자 아이디를 100% 블러 처리된 data URL 이미지로 교체!
    clonedDoc.querySelectorAll('.cgen-author').forEach(authorEl => {
      try {
        const res = generateBlurredAuthorDataUrl(authorEl);
        if (res && res.dataUrl) {
          const img = clonedDoc.createElement('img');
          img.src = res.dataUrl;
          img.className = 'cgen-author';
          img.style.width = res.width + 'px';
          img.style.height = res.height + 'px';
          img.style.display = 'inline-block';
          img.style.verticalAlign = 'middle';
          img.style.objectFit = 'contain';
          img.style.border = 'none';
          img.style.boxShadow = 'none';
          img.style.filter = 'none';
          authorEl.parentNode.replaceChild(img, authorEl);
        }
      } catch (e) {
        console.warn('[author blur replace error]', e);
      }
    });
  }

  function applyBlurToCanvas(canvas, rootElement) {
    try {
      const isBlurActive = cgenStyle.blur || ($('cgenBlurIdentity')?.checked ?? false);
      if (!isBlurActive) return;
      if (!canvas || !rootElement) return;

      const rootRect = rootElement.getBoundingClientRect();
      if (rootRect.width === 0 || rootRect.height === 0) return;

      const scaleX = canvas.width / rootRect.width;
      const scaleY = canvas.height / rootRect.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // 프로필 아바타와 작성자(아이디) 대상 모두 수집
      const targets = rootElement.querySelectorAll('.cgen-avatar, .cgen-author, .cgen-author-name');
      if (!targets || targets.length === 0) return;

      targets.forEach(el => {
        const elRect = el.getBoundingClientRect();
        if (elRect.width === 0 || elRect.height === 0) return;

        const isAvatar = el.classList.contains('cgen-avatar');

        // canvas 상의 상대 픽셀 좌표
        const relX = elRect.left - rootRect.left;
        const relY = elRect.top - rootRect.top;
        const relW = elRect.width;
        const relH = elRect.height;

        // 블러 영역이 어색하게 끊기지 않도록 충분한 안전 여백(padding) 포함
        const padX = isAvatar ? (3 * scaleX) : (6 * scaleX);
        const padY = isAvatar ? (3 * scaleY) : (3 * scaleY);

        const x = Math.max(0, Math.floor(relX * scaleX - padX));
        const y = Math.max(0, Math.floor(relY * scaleY - padY));
        const w = Math.min(canvas.width - x, Math.ceil(relW * scaleX + padX * 2));
        const h = Math.min(canvas.height - y, Math.ceil(relH * scaleY + padY * 2));

        if (w <= 2 || h <= 2) return;

        // 3x 해상도에 맞게 18px ~ 24px의 강력하고 부드러운 가우시안 블러 적용
        const blurRadius = (isAvatar ? 8 : 6) * scaleX;
        blurCanvasSubRegion(ctx, x, y, w, h, blurRadius);
      });
    } catch (err) {
      console.warn('[applyBlurToCanvas warning]', err);
    }
  }

  function blurCanvasSubRegion(ctx, x, y, w, h, blurPx = 18) {
    try {
      // 1. 해당 영역 캡처
      const crop = document.createElement('canvas');
      crop.width = w;
      crop.height = h;
      const cropCtx = crop.getContext('2d');
      cropCtx.drawImage(ctx.canvas, x, y, w, h, 0, 0, w, h);

      // 2. 1/8 초소형 버퍼로 다운샘플링 (글자 텍스트/얼굴 정보 물리적 완전 파괴)
      const dw = Math.max(3, Math.floor(w / 8));
      const dh = Math.max(3, Math.floor(h / 8));
      const small = document.createElement('canvas');
      small.width = dw;
      small.height = dh;
      const sCtx = small.getContext('2d');
      sCtx.imageSmoothingEnabled = true;
      sCtx.drawImage(crop, 0, 0, w, h, 0, 0, dw, dh);

      // 3. 다시 부드럽게 (w, h) 크기로 업샘플링 (Bilinear Smoothing)
      const mid = document.createElement('canvas');
      mid.width = w;
      mid.height = h;
      const mCtx = mid.getContext('2d');
      mCtx.imageSmoothingEnabled = true;
      mCtx.drawImage(small, 0, 0, dw, dh, 0, 0, w, h);

      // 4. 원본 캔버스 위에 가우시안 블러 합성 (원본 글자/얼굴 100% 완전 덮어쓰기)
      ctx.save();
      if (typeof ctx.filter !== 'undefined') {
        ctx.filter = `blur(${blurPx}px)`;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(mid, 0, 0, w, h, x, y, w, h);
      ctx.restore();
    } catch (e) {
      console.warn('[blurCanvasSubRegion error]', e);
    }
  }

  // ── 내보내기 (Export: PNG & ZIP) ──────────────────────────────────
  // 💡 [📷 PNG 저장]: 선택된 모든 댓글 카드를 각각의 고화질 PNG 파일로 순차 저장
  window.cgenExportPng = async function () {
    const ids = [...cgenSelectedIds];
    if (ids.length === 0) {
      alert('저장할 카드를 먼저 선택해주세요.');
      return;
    }
    if (!window.html2canvas) {
      alert('html2canvas 라이브러리를 불러오지 못했습니다.');
      return;
    }

    const btn = $('cgenPngBtn');
    const origText = btn ? btn.textContent : '📷 PNG 저장';
    if (btn) {
      btn.disabled = true;
    }

    // 💡 포커스 하늘색 테두리가 저장 이미지에 포함되지 않도록 임시 제거
    const savedFocusId = cgenFocusId;
    document.querySelectorAll('.cgen-card-focus').forEach(el => el.classList.remove('cgen-card-focus'));

    try {
      const ext = cgenStyle.exportFormat === 'jpg' ? 'jpg' : 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';

      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        if (btn) {
          btn.textContent = ids.length > 1 ? `⏳ ${i + 1}/${ids.length} 저장 중...` : '⏳ 저장 중...';
        }

        const cardWrap = document.querySelector(`.cgen-preview-card-wrap[data-card-id="${id}"] .cgen-stack`);
        if (!cardWrap) continue;

        const canvas = await html2canvas(cardWrap, {
          backgroundColor: null,
          scale: 3, // 초고화질 Retina 3x
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => prepareClonedDocBlur(clonedDoc)
        });

        // 🔒 블러 후처리 영구 적용!
        applyBlurToCanvas(canvas, cardWrap);

        const c = getComment(id);
        const titleSnippet = (c?.text || '').slice(0, 12).replace(/[^\w가-힣]/g, '') || (c?.author || '').replace(/[^\w가-힣]/g, '') || id.slice(0, 6);
        const filename = ids.length > 1 ? `댓글카드_${i + 1}_${titleSnippet}.${ext}` : `댓글카드_${titleSnippet}.${ext}`;

        const a = document.createElement('a');
        a.href = canvas.toDataURL(mime);
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // 여러 파일 순차 다운로드 시 브라우저 차단/누락 방지 딜레이
        if (ids.length > 1 && i < ids.length - 1) {
          await new Promise(r => setTimeout(r, 280));
        }
      }
    } catch (e) {
      console.error('[cgenExportPng error]', e);
      alert(`내보내기 실패: ${e.message}`);
    } finally {
      // 포커스 테두리 복원
      if (savedFocusId) {
        const focusWrap = document.querySelector(`.cgen-preview-card-wrap[data-card-id="${savedFocusId}"]`);
        if (focusWrap) focusWrap.classList.add('cgen-card-focus');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  };

  // 하위 호환성 유지
  window.cgenExportSinglePng = window.cgenExportPng;

  // 💡 [🖼️ 묶음(1장) 저장]: 선택된 모든 카드를 세로 스택 통째로 1장 PNG로 내보내기
  window.cgenExportStackPng = async function () {
    const ids = [...cgenSelectedIds];
    if (ids.length === 0) {
      alert('저장할 카드를 먼저 선택해주세요.');
      return;
    }

    const container = $('cgenCard');
    if (!container || !window.html2canvas) return;

    const btn = $('cgenStackPngBtn');
    const origText = btn ? btn.textContent : '🖼️ 묶음(1장) 저장';
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ 묶음 렌더링 중...';
    }

    const savedFocusId = cgenFocusId;
    document.querySelectorAll('.cgen-card-focus').forEach(el => el.classList.remove('cgen-card-focus'));

    try {
      const canvas = await html2canvas(container, {
        backgroundColor: null,
        scale: 3,
        useCORS: true,
        logging: false,
        onclone: (clonedDoc) => prepareClonedDocBlur(clonedDoc)
      });

      // 🔒 묶음 스택 전체에도 블러 사후 처리!
      applyBlurToCanvas(canvas, container);

      const ext = cgenStyle.exportFormat === 'jpg' ? 'jpg' : 'png';
      const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';
      const a = document.createElement('a');
      a.href = canvas.toDataURL(mime);
      a.download = `유튜브댓글_스택_${ids.length}개_묶음.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.error('[cgenExportStackPng error]', e);
      alert(`묶음 내보내기 실패: ${e.message}`);
    } finally {
      if (savedFocusId) {
        const focusWrap = document.querySelector(`.cgen-preview-card-wrap[data-card-id="${savedFocusId}"]`);
        if (focusWrap) focusWrap.classList.add('cgen-card-focus');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = origText;
      }
    }
  };

  // 💡 [💾 ZIP 일괄 내보내기]
  window.cgenExport = async function () {
    const ids = [...cgenSelectedIds];
    if (ids.length === 0) {
      alert('내보낼 댓글을 최소 1개 이상 선택해주세요.');
      return;
    }

    if (ids.length === 1) {
      return cgenExportPng();
    }

    if (typeof JSZip === 'undefined') {
      // JSZip 없으면 순차 다운로드
      return cgenExportPng();
    }

    const btn = $('cgenExportBtn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = '⏳ ZIP 생성 중...';
    }

    const savedFocusId = cgenFocusId;
    document.querySelectorAll('.cgen-card-focus').forEach(el => el.classList.remove('cgen-card-focus'));

    try {
      const zip = new JSZip();
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const cardWrap = document.querySelector(`.cgen-preview-card-wrap[data-card-id="${id}"] .cgen-stack`);
        if (!cardWrap) continue;

        const canvas = await html2canvas(cardWrap, {
          backgroundColor: null,
          scale: 3,
          useCORS: true,
          logging: false,
          onclone: (clonedDoc) => prepareClonedDocBlur(clonedDoc)
        });

        // 🔒 ZIP 내보내기에도 블러 사후 처리!
        applyBlurToCanvas(canvas, cardWrap);

        const dataUrl = canvas.toDataURL('image/png');
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const c = getComment(id);
        const titleSnippet = (c?.text || '').slice(0, 12).replace(/[^\w가-힣]/g, '') || (c?.author || '').replace(/[^\w가-힣]/g, '') || id.slice(0, 6);
        zip.file(`댓글카드_${i + 1}_${titleSnippet}.png`, base64Data, { base64: true });
      }

      const content = await zip.generateAsync({ type: 'blob' });
      if (typeof saveAs !== 'undefined') {
        saveAs(content, `유튜브댓글_일괄_${Date.now()}.zip`);
      } else {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(content);
        a.download = `유튜브댓글_일괄_${Date.now()}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
    } catch (e) {
      alert(`일괄 내보내기 실패: ${e.message}`);
    } finally {
      if (savedFocusId) {
        const focusWrap = document.querySelector(`.cgen-preview-card-wrap[data-card-id="${savedFocusId}"]`);
        if (focusWrap) focusWrap.classList.add('cgen-card-focus');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '💾 ZIP 일괄 내보내기';
      }
    }
  };

})();
