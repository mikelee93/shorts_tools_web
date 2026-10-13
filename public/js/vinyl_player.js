/**
 * 💿 회전 LP 턴테이블 뮤직 플레이어 위젯 렌더러 (Vinyl Music Player)
 * 
 * 1. 360도 연속 회전 LP 레코드판 + 원형 앨범 자켓 커버
 * 2. 실시간 오디오 파형(Visualizer) 동기화
 * 3. 곡명/아티스트 메타데이터 및 플레이어 컨트롤
 * 4. 투명 배경(Alpha WebM) & 그린스크린(ChromaKey) 고화질 비디오 내보내기
 */

(function () {
  // Safari / 구버전 브라우저 호환성을 위한 roundRect 폴리필
  if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
      if (typeof r === 'undefined') r = 0;
      const radius = typeof r === 'number' ? r : (r[0] || 0);
      this.beginPath();
      this.moveTo(x + radius, y);
      this.lineTo(x + w - radius, y);
      this.quadraticCurveTo(x + w, y, x + w, y + radius);
      this.lineTo(x + w, y + h - radius);
      this.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
      this.lineTo(x + radius, y + h);
      this.quadraticCurveTo(x, y + h, x, y + h - radius);
      this.lineTo(x, y + radius);
      this.quadraticCurveTo(x, y, x + radius, y);
      this.closePath();
      return this;
    };
  }

  let _canvas = null;
  let _ctx = null;
  let _animId = null;

  let _audioCtx = null;
  let _analyser = null;
  let _audioEl = null;
  let _sourceNode = null;
  let _mediaDest = null;

  let _isPlaying = false;
  let _isExporting = false;
  let _rotationAngle = 0;
  let _lastTime = performance.now();

  // 앨범 이미지 & 채널 로고 이미지 객체
  let _albumImg = new Image();
  _albumImg.crossOrigin = 'anonymous';
  let _logoImg = new Image();
  _logoImg.crossOrigin = 'anonymous';

  // 기본 설정값 (사용자 레퍼런스 이미지 '미나 - 전화받어' 기본 세팅 - Image 1 컴팩트 비율 580px)
  const _config = {
    title: '전화받어',
    artist: '미나',
    year: '2002',
    channelName: '연예뉴스\n소식',
    
    rotationSpeed: 0.8, // 초당 회전 라디안 (0이면 정지)
    lpRadius: 90,
    centerCoverRadius: 60,

    cardWidth: 580,     // 💡 첫 번째 이미지 레퍼런스 기준 컴팩트 가로 너비 (기존 880px의 긴 여백 제거)
    cardHeight: 240,
    cardRadius: 8,      // 💡 댓글 카드(.cgen-stack border-radius: 8px)와 동일한 살짝 둥근 모서리 기본 적용
    cardBgColor: 'rgba(12, 16, 26, 0.94)',
    cardBorderColor: 'transparent', // 💡 흰색 외곽 테두리 제거 (댓글 카드처럼 깔끔한 무테 다크 모드)
    showBorder: false,

    waveBarCount: 38,
    waveBarWidth: 3.5,
    waveBarGap: 3.5,
    waveMaxHeight: 36,
    waveColor: '#ffffff',

    bgExportMode: 'transparent', // 'transparent' or 'green'
    exportDuration: 15, // 녹화 길이 (초)
    exportFps: 60, // 💡 60 FPS 고화질 부드러운 모션 고정
    showLogo: true,
    showControls: true
  };

  // 초기 샘플 이미지 로드 (공식 '연예뉴스 소식' 로고 엠블럼 기본 적용)
  _albumImg.src = 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=300&h=300&fit=crop';
  _logoImg.src = '/assets/channel_logo.jpg';

  window.initVinylPlayer = function () {
    _canvas = document.getElementById('vinylCanvas');
    if (!_canvas) return;
    _ctx = _canvas.getContext('2d');

    _canvas.width = _config.cardWidth;
    _canvas.height = _config.cardHeight;

    setupAudio();
    bindEvents();
    startRenderLoop();
  };

  function setupAudio() {
    _audioEl = new Audio();
    _audioEl.crossOrigin = 'anonymous';
    _audioEl.loop = true;

    _audioEl.addEventListener('play', () => {
      _isPlaying = true;
      updatePlayBtnUI();
      initAudioContext();
    });

    _audioEl.addEventListener('pause', () => {
      _isPlaying = false;
      updatePlayBtnUI();
    });
  }

  function initAudioContext() {
    if (!_audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      _audioCtx = new AudioContextClass();
      _analyser = _audioCtx.createAnalyser();
      _analyser.fftSize = 256;
      _analyser.smoothingTimeConstant = 0.75;

      _mediaDest = _audioCtx.createMediaStreamDestination();

      if (_audioEl) {
        _sourceNode = _audioCtx.createMediaElementSource(_audioEl);
        _sourceNode.connect(_analyser);
        _analyser.connect(_audioCtx.destination);
        _analyser.connect(_mediaDest);
      }
    }
    if (_audioCtx.state === 'suspended') {
      _audioCtx.resume();
    }
  }

  // ── 렌더링 루프 (60FPS) ───────────────────────────────────────────
  function startRenderLoop() {
    if (_animId) cancelAnimationFrame(_animId);

    const freqData = new Uint8Array(_analyser ? _analyser.frequencyBinCount : 128);

    function loop(now) {
      _animId = requestAnimationFrame(loop);
      const dt = (now - _lastTime) / 1000;
      _lastTime = now;

      // LP판 회전 각도 갱신
      if (_isPlaying || _isExporting || _config.rotationSpeed > 0) {
        _rotationAngle += _config.rotationSpeed * dt * 2.5;
        if (_rotationAngle > Math.PI * 2) {
          _rotationAngle -= Math.PI * 2;
        }
      }

      // 오디오 주파수 데이터 수집 (음원 재생 중이면 실시간 분석, 아니면 자연스러운 리듬 시뮬레이션)
      if (_analyser && _isPlaying) {
        _analyser.getByteFrequencyData(freqData);
      } else {
        generateProceduralBeat(now / 1000, freqData);
      }

      renderFrame(_ctx, _canvas.width, _canvas.height, freqData);
    }

    _animId = requestAnimationFrame(loop);
  }

  // ── 단일 프레임 그리기 ───────────────────────────────────────────────
  function renderFrame(ctx, width, height, freqData) {
    ctx.clearRect(0, 0, width, height);

    // 그린스크린 모드일 경우 배경 채우기
    if (_config.bgExportMode === 'green') {
      ctx.fillStyle = '#00FF00';
      ctx.fillRect(0, 0, width, height);
    }

    // 1. 카드 본체 (반투명 라운드 사각형)
    const cardX = 0;
    const cardY = 0;
    const cardW = width;
    const cardH = height;
    const r = _config.cardRadius;

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(cardX, cardY, cardW, cardH, r);
    // 💡 그린스크린 모드에서는 초록색이 반투명으로 비치는 현상(Chroma Bleed)을 방지하기 위해 100% 불투명 다크 컬러 적용!
    ctx.fillStyle = (_config.bgExportMode === 'green') ? '#0c101a' : _config.cardBgColor;
    ctx.fill();

    // 💡 외곽 흰색 테두리 (사용자 요청: 기본 제거됨 / 깔끔한 무테 다크 스타일)
    if (_config.showBorder && _config.cardBorderColor && _config.cardBorderColor !== 'transparent') {
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = _config.cardBorderColor;
      ctx.stroke();
    }
    ctx.restore();

    // 2. 좌측: 회전하는 LP판 및 앨범 자켓
    const lpX = 115;
    const lpY = cardH / 2;
    drawVinylRecord(ctx, lpX, lpY, _config.lpRadius, _config.centerCoverRadius, _rotationAngle);

    // 4. 중앙: 곡 정보 (제목, 아티스트/연도)
    const textStartX = lpX + _config.lpRadius + 26;
    drawSongMetadata(ctx, textStartX, cardY + 50);

    // 파형 너비 및 끝점 계산 (Image 1 컴팩트 레이아웃)
    const barStep = _config.waveBarWidth + _config.waveBarGap;
    const maxWaveWidth = Math.max(180, cardW - textStartX - 36);
    const waveTotalWidth = Math.min(_config.waveBarCount * barStep, maxWaveWidth);
    const waveEndX = textStartX + waveTotalWidth;

    // 3. 우측 상단: 채널 로고 / 배지
    // 💡 첫 번째 이미지 레퍼런스 스타일: 오른쪽 끝에 멀리 떨어지는 게 아니라,
    // 곡 제목 오른쪽 / 파형 끝점 바로 위로 왼쪽으로 밀착!
    if (_config.showLogo && _config.channelName) {
      const badgeRightX = Math.min(cardW - 22, waveEndX + 6);
      drawChannelBadge(ctx, badgeRightX, cardY + 46, _config.channelName);
    }

    // 5. 중앙 하단: 오디오 파형 (Waveform Visualizer)
    const waveY = cardY + 130;
    drawWaveform(ctx, textStartX, waveY, freqData, waveTotalWidth);

    // 6. 플레이어 컨트롤 아이콘 (|<<  ||  >>|  🔊)
    if (_config.showControls) {
      drawPlayerControls(ctx, textStartX, cardY + 180, waveEndX);
    }
  }

  // ── [모듈 1] 회전 LP 레코드판 그리기 ────────────────────────────────
  function drawVinylRecord(ctx, x, y, outerR, innerR, angle) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    // LP 외곽 블랙 비닐 베이스
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fillStyle = '#0f1115';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#12151c';
    ctx.stroke();

    // LP 표면의 섬세한 동심원 음각 홈(Grooves)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
    ctx.lineWidth = 1;
    for (let ring = outerR - 6; ring > innerR + 4; ring -= 5.5) {
      ctx.beginPath();
      ctx.arc(0, 0, ring, 0, Math.PI * 2);
      ctx.stroke();
    }

    // LP 특유의 대각선 반사광 (Vinyl Sheen/Glare)
    const grad = ctx.createLinearGradient(-outerR, -outerR, outerR, outerR);
    grad.addColorStop(0, 'rgba(255, 255, 255, 0.12)');
    grad.addColorStop(0.48, 'rgba(255, 255, 255, 0.01)');
    grad.addColorStop(0.52, 'rgba(255, 255, 255, 0.01)');
    grad.addColorStop(1, 'rgba(255, 255, 255, 0.12)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, outerR, 0, Math.PI * 2);
    ctx.fill();

    // 중앙 앨범 커버 이미지 (원형 마스킹)
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, innerR, 0, Math.PI * 2);
    ctx.clip();

    if (_albumImg && _albumImg.complete && _albumImg.naturalWidth > 0) {
      ctx.drawImage(_albumImg, -innerR, -innerR, innerR * 2, innerR * 2);
    } else {
      // 이미지 미등록 시 감각적인 기본 그라디언트
      const bgGrad = ctx.createLinearGradient(-innerR, -innerR, innerR, innerR);
      bgGrad.addColorStop(0, '#ec4899');
      bgGrad.addColorStop(1, '#8b5cf6');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(-innerR, -innerR, innerR * 2, innerR * 2);
    }

    // 앨범 자켓 안쪽 원형 림 테두리
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.stroke();
    ctx.restore();

    // LP 중앙 턴테이블 스핀들 센터 홀 (Center Spindle Hole)
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#1e2430';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#475569';
    ctx.stroke();

    ctx.restore();
  }

  // ── [모듈 2] 곡 메타데이터 텍스트 ──────────────────────────────────
  function drawSongMetadata(ctx, x, y) {
    ctx.save();
    // 1. 곡 제목 (Title - 굵은 흰색)
    ctx.font = '800 24px Pretendard, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'middle';
    ctx.fillText(_config.title || '곡 제목', x, y);

    // 2. 아티스트 및 연도 (Subtext - 회색)
    ctx.font = '500 14px Pretendard, sans-serif';
    ctx.fillStyle = '#94a3b8';
    const sub = `${_config.artist || '가수'} · ${_config.year || '2000'}`;
    ctx.fillText(sub, x, y + 26);
    ctx.restore();
  }

  // ── [모듈 3] 오디오 파형 (Waveform) ─────────────────────────────────
  function drawWaveform(ctx, startX, centerY, freqData, totalWidth) {
    ctx.save();
    const barW = _config.waveBarWidth;
    const gap = _config.waveBarGap;
    const step = barW + gap;
    const count = totalWidth ? Math.floor(totalWidth / step) : _config.waveBarCount;
    const maxH = _config.waveMaxHeight;

    ctx.fillStyle = _config.waveColor;

    for (let i = 0; i < count; i++) {
      // 주파수 대역 매핑 (중저음 중심 반응성 강화)
      const normIdx = Math.floor(Math.pow(i / count, 1.2) * (freqData.length * 0.65));
      const val = (freqData[normIdx] || 0) / 255;

      // 중앙 대칭형 파형 높이 계산 (최소 4px)
      const h = Math.max(4, Math.pow(val, 1.3) * maxH);
      const bx = startX + i * step;
      const by = centerY - h / 2;

      // 라운드 바 그리기
      ctx.beginPath();
      ctx.roundRect(bx, by, barW, h, barW / 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // ── [모듈 4] 플레이어 컨트롤 및 볼륨 아이콘 ────────────────────────
  function drawPlayerControls(ctx, startX, y, waveEndX) {
    ctx.save();
    ctx.fillStyle = '#cbd5e1';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 2;

    // 이전곡 (|<<)
    drawPrevIcon(ctx, startX, y, 13);

    // 재생/일시정지 (||)
    drawPauseIcon(ctx, startX + 34, y, 13);

    // 다음곡 (>>|)
    drawNextIcon(ctx, startX + 68, y, 13);

    // 우측 볼륨 스피커 아이콘 (파형 끝부분 및 배지 아래에 세로 정렬)
    const volumeX = waveEndX ? (waveEndX - 16) : (startX + 280 - 16);
    drawSpeakerIcon(ctx, volumeX, y, 14);

    ctx.restore();
  }

  function drawPrevIcon(ctx, x, y, size) {
    ctx.beginPath();
    ctx.fillRect(x, y - size / 2, 2.5, size); // 왼쪽 바
    // 왼쪽 화살표 삼각형 2개
    ctx.beginPath();
    ctx.moveTo(x + size, y - size / 2);
    ctx.lineTo(x + 3, y);
    ctx.lineTo(x + size, y + size / 2);
    ctx.fill();
  }

  function drawPauseIcon(ctx, x, y, size) {
    ctx.fillRect(x, y - size / 2, 3, size);
    ctx.fillRect(x + 7, y - size / 2, 3, size);
  }

  function drawNextIcon(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size / 2);
    ctx.lineTo(x + size - 3, y);
    ctx.lineTo(x, y + size / 2);
    ctx.fill();
    ctx.fillRect(x + size, y - size / 2, 2.5, size); // 오른쪽 바
  }

  function drawSpeakerIcon(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y - size * 0.25);
    ctx.lineTo(x + size * 0.3, y - size * 0.25);
    ctx.lineTo(x + size * 0.65, y - size * 0.55);
    ctx.lineTo(x + size * 0.65, y + size * 0.55);
    ctx.lineTo(x + size * 0.3, y + size * 0.25);
    ctx.lineTo(x, y + size * 0.25);
    ctx.closePath();
    ctx.fill();

    // 음파 호선 2개
    ctx.beginPath();
    ctx.arc(x + size * 0.55, y, size * 0.5, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x + size * 0.55, y, size * 0.85, -Math.PI * 0.3, Math.PI * 0.3);
    ctx.stroke();
  }

  // ── [모듈 5] 채널 로고 엠블럼 배지 ─────────────────────────────────
  function drawChannelBadge(ctx, rightX, centerY, rawName) {
    ctx.save();
    const r = 26; // 원형 배지 반지름 (26px -> 직경 52px로 로고가 선명하고 깔끔하게 돋보임)
    const cx = rightX - r;
    const cy = centerY + 2;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = '#0a0d14';
    ctx.fill();

    // 로고 이미지 있으면 원형 클리핑 후 선명하게 렌더링
    if (_logoImg && _logoImg.complete && _logoImg.naturalWidth > 0) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(_logoImg, cx - r, cy - r, r * 2, r * 2);
      ctx.restore();

      // 마젠타 네온 원형 림 테두리 링
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.lineWidth = 1.8;
      ctx.strokeStyle = 'rgba(236, 72, 153, 0.75)';
      ctx.stroke();
    } else {
      const text = (rawName || '').trim();
      if (!text) {
        ctx.restore();
        return;
      }

      // 줄바꿈 파싱: 엔터(\n), 슬래시(/), 공백, 또는 글자 수 기반 스마트 2줄 분할
      let lines = [];
      if (text.includes('\n')) {
        lines = text.split('\n').map(s => s.trim()).filter(Boolean);
      } else if (text.includes('/')) {
        lines = text.split('/').map(s => s.trim()).filter(Boolean);
      } else if (text.includes(' ')) {
        lines = text.split(/\s+/).filter(Boolean);
      } else if (text.length >= 4) {
        // '연예뉴스소식' (6글자) -> ['연예뉴스', '소식']
        if (text.length === 6) {
          lines = [text.slice(0, 4), text.slice(4)];
        } else if (text.length === 5) {
          lines = [text.slice(0, 3), text.slice(3)];
        } else if (text.length === 4) {
          lines = [text.slice(0, 2), text.slice(2)];
        } else {
          const mid = Math.ceil(text.length / 2);
          lines = [text.slice(0, mid), text.slice(mid)];
        }
      } else {
        lines = [text];
      }

      ctx.fillStyle = '#facc15'; // 레퍼런스의 옛스타 옐로우
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (lines.length === 1) {
        const line = lines[0];
        let fontSize = 13;
        if (line.length <= 2) fontSize = 15;
        else if (line.length === 3) fontSize = 13;
        else fontSize = 11;

        ctx.font = `900 ${fontSize}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        // 배지 폭에 맞춰 축소
        while (fontSize > 8 && ctx.measureText(line).width > (r * 1.65)) {
          fontSize -= 0.5;
          ctx.font = `900 ${fontSize}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        }
        ctx.fillText(line, cx, cy);
      } else {
        // 2줄 배치 (예: 1줄 "연예뉴스", 2줄 "소식")
        const line1 = lines[0];
        const line2 = lines.slice(1).join(' ');

        // 1번째 줄 폰트 크기 자동 맞춤
        let fs1 = line1.length >= 4 ? 10.5 : 12;
        ctx.font = `900 ${fs1}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        while (fs1 > 7.5 && ctx.measureText(line1).width > (r * 1.7)) {
          fs1 -= 0.5;
          ctx.font = `900 ${fs1}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        }

        // 2번째 줄 폰트 크기 자동 맞춤
        let fs2 = line2.length >= 4 ? 10.5 : 12;
        ctx.font = `900 ${fs2}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        while (fs2 > 7.5 && ctx.measureText(line2).width > (r * 1.7)) {
          fs2 -= 0.5;
          ctx.font = `900 ${fs2}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        }

        const yGap = 7;
        ctx.font = `900 ${fs1}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        ctx.fillText(line1, cx, cy - yGap);

        ctx.font = `900 ${fs2}px Pretendard, "Noto Sans KR", -apple-system, sans-serif`;
        ctx.fillText(line2, cx, cy + yGap + 1);
      }
    }
    ctx.restore();
  }

  // ── 리듬 시뮬레이션 (음원 미재생 시 자연스러운 비트 파형) ───────────
  function generateProceduralBeat(t, outArray) {
    const len = outArray.length;
    for (let i = 0; i < len; i++) {
      const freq = i / len;
      const b1 = Math.sin(t * 7.5 + freq * 8) * 0.5 + 0.5;
      const b2 = Math.cos(t * 12.0 - freq * 14) * 0.5 + 0.5;
      const beat = (b1 * 0.6 + b2 * 0.4);
      outArray[i] = Math.floor(beat * 210);
    }
  }

  // ── UI 이벤트 바인딩 ────────────────────────────────────────────────
  function bindEvents() {
    // 텍스트 인풋
    const titleIn = document.getElementById('vinylTitle');
    const artistIn = document.getElementById('vinylArtist');
    const yearIn = document.getElementById('vinylYear');
    const channelIn = document.getElementById('vinylChannel');

    if (titleIn) titleIn.addEventListener('input', (e) => _config.title = e.target.value);
    if (artistIn) artistIn.addEventListener('input', (e) => _config.artist = e.target.value);
    if (yearIn) yearIn.addEventListener('input', (e) => _config.year = e.target.value);
    if (channelIn) channelIn.addEventListener('input', (e) => _config.channelName = e.target.value);

    // 앨범 자켓 이미지 파일 업로드
    const albumFileIn = document.getElementById('vinylAlbumFile');
    if (albumFileIn) {
      albumFileIn.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => _albumImg.src = evt.target.result;
          reader.readAsDataURL(file);
        }
      });
    }

    // 채널 로고 이미지 파일 업로드
    const logoFileIn = document.getElementById('vinylLogoFile');
    if (logoFileIn) {
      logoFileIn.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            _logoImg.src = evt.target.result;
            const status = document.getElementById('vinylLogoStatus');
            if (status) status.textContent = `커스텀 (${file.name})`;
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // 오디오 파일 업로드
    const audioFileIn = document.getElementById('vinylAudioFile');
    if (audioFileIn) {
      audioFileIn.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
          const url = URL.createObjectURL(file);
          _audioEl.src = url;
          _audioEl.play().catch(() => {});
          
          // 파일명에서 아티스트/제목 자동 추출 시도 (예: 미나 - 전화받어.mp3)
          const baseName = file.name.replace(/\.[^/.]+$/, "");
          if (baseName.includes('-')) {
            const parts = baseName.split('-');
            if (artistIn) artistIn.value = _config.artist = parts[0].trim();
            if (titleIn) titleIn.value = _config.title = parts[1].trim();
          }
        }
      });
    }

    // 재생 / 일시정지 버튼
    const playBtn = document.getElementById('vinylPlayBtn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (_isPlaying) {
          _audioEl.pause();
        } else {
          _audioEl.play().catch(() => {
            // 오디오 없어도 프리뷰 댄싱 가능
            _isPlaying = true;
            updatePlayBtnUI();
          });
        }
      });
    }

    // 배경 모드 라디오 (투명 vs 그린스크린)
    const bgModes = document.querySelectorAll('input[name="vinylBgMode"]');
    bgModes.forEach(r => {
      r.addEventListener('change', (e) => {
        _config.bgExportMode = e.target.value;
        const box = document.getElementById('canvasPreviewContainer');
        if (box) {
          box.className = e.target.value === 'green' ? 'green-bg rounded-xl p-6 flex justify-center items-center overflow-hidden' : 'checker-bg rounded-xl p-6 flex justify-center items-center overflow-hidden';
        }
        const btnText = document.getElementById('vinylExportBtnText');
        if (btnText) {
          btnText.textContent = e.target.value === 'green' ? '🎬 그린스크린 60FPS 비디오 (.mp4)' : '🎥 투명 60FPS 비디오 (.webm)';
        }
      });
    });

    // 회전 속도 슬라이더
    const speedRange = document.getElementById('vinylSpeed');
    if (speedRange) {
      speedRange.addEventListener('input', (e) => {
        _config.rotationSpeed = parseFloat(e.target.value);
      });
    }

    // 💡 카드 가로 너비 (길이) 실시간 슬라이더
    const widthSlider = document.getElementById('vinylWidthSlider');
    if (widthSlider) {
      widthSlider.addEventListener('input', (e) => {
        window.setVinylWidth(e.target.value);
      });
    }

    // 💡 외곽 테두리 토글 체크박스 (기본: 해제 / 무테)
    const borderToggle = document.getElementById('vinylBorderToggle');
    if (borderToggle) {
      borderToggle.checked = _config.showBorder;
      borderToggle.addEventListener('change', (e) => {
        window.setVinylBorder(e.target.checked);
      });
    }

    // 💡 카드 모서리 둥글기 (Radius) 슬라이더
    const radiusSlider = document.getElementById('vinylRadiusSlider');
    if (radiusSlider) {
      radiusSlider.value = _config.cardRadius;
      radiusSlider.addEventListener('input', (e) => {
        window.setVinylRadius(e.target.value);
      });
    }
  }

  // 💡 카드 모서리 둥글기 (Radius) 조절 함수 (댓글처럼 살짝 둥글게 - 기본 8px)
  window.setVinylRadius = function (radius) {
    _config.cardRadius = Math.max(0, parseInt(radius, 10) || 0);
    const slider = document.getElementById('vinylRadiusSlider');
    if (slider) slider.value = _config.cardRadius;
    const valText = document.getElementById('vinylRadiusVal');
    if (valText) {
      valText.textContent = `${_config.cardRadius}px ${_config.cardRadius === 8 ? '(댓글과 동일 · 추천)' : ''}`;
    }
  };

  // 💡 외곽 테두리 토글 함수
  window.setVinylBorder = function (show) {
    _config.showBorder = !!show;
    _config.cardBorderColor = show ? 'rgba(255, 255, 255, 0.12)' : 'transparent';
    const toggle = document.getElementById('vinylBorderToggle');
    if (toggle) toggle.checked = !!show;
    const status = document.getElementById('vinylBorderStatus');
    if (status) {
      status.textContent = show ? '흰색 테두리 켜짐' : '무테 (테두리 없음)';
      status.className = show ? 'text-purple-400 font-bold text-[11px]' : 'text-emerald-400 font-bold text-[11px]';
    }
  };

  // 💡 가로 너비 프리셋 및 실시간 조절 함수
  window.setVinylWidth = function (width) {
    _config.cardWidth = parseInt(width, 10) || 580;
    if (_canvas) {
      _canvas.width = _config.cardWidth;
    }
    const slider = document.getElementById('vinylWidthSlider');
    if (slider) slider.value = _config.cardWidth;
    const valText = document.getElementById('vinylWidthVal');
    if (valText) {
      valText.textContent = `${_config.cardWidth}px ${_config.cardWidth <= 600 ? '(Image 1 컴팩트 추천)' : ''}`;
    }
    const dimBadge = document.getElementById('vinylDimBadge');
    if (dimBadge) {
      dimBadge.textContent = `${_config.cardWidth} × ${_config.cardHeight} px (HD)`;
    }
  };

  // 💡 공식 연예뉴스 소식 채널 로고로 복원
  window.resetVinylLogo = function () {
    _logoImg.src = '/assets/channel_logo.jpg';
    const logoFileIn = document.getElementById('vinylLogoFile');
    if (logoFileIn) logoFileIn.value = '';
    const status = document.getElementById('vinylLogoStatus');
    if (status) status.textContent = "공식 '연예뉴스 소식' 로고 기본 적용됨";
  };

  function updatePlayBtnUI() {
    const playBtn = document.getElementById('vinylPlayBtn');
    if (!playBtn) return;
    playBtn.innerHTML = _isPlaying 
      ? '<i data-lucide="pause" class="w-4 h-4 inline-block mr-1"></i> 일시정지' 
      : '<i data-lucide="play" class="w-4 h-4 inline-block mr-1"></i> 음악 재생';
    if (window.lucide) lucide.createIcons();
  }

  // 💡 비디오 프레임 레이트 (60 FPS 초고화질 고정)
  window.setVinylFps = function (fps) {
    _config.exportFps = 60;
  };

  // ── 고화질 60FPS 비디오 내보내기 (MediaRecorder - 60 FPS 고정) ──
  window.exportVinylVideo = async function () {
    if (_isExporting) return;
    _isExporting = true;

    const btn = document.getElementById('vinylExportBtn');
    const statusText = document.getElementById('vinylExportStatus');
    if (btn) btn.disabled = true;

    const durationSec = parseInt(document.getElementById('vinylDuration')?.value || '15', 10);
    const fps = 60; // 💡 60 FPS 초고화질 고정

    // 그린스크린 모드인 경우 MP4/WebM 호환성 체크, 투명 모드인 경우 VP9 WebM
    let mimeType = 'video/webm';
    let ext = 'webm';

    if (_config.bgExportMode === 'green') {
      if (MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') || MediaRecorder.isTypeSupported('video/mp4')) {
        mimeType = MediaRecorder.isTypeSupported('video/mp4;codecs=avc1') ? 'video/mp4;codecs=avc1' : 'video/mp4';
        ext = 'mp4';
      } else if (MediaRecorder.isTypeSupported('video/webm')) {
        mimeType = 'video/webm';
        ext = 'mp4'; // 캡컷/윈도우 호환성을 위해 mp4 확장자 지정
      }
    } else {
      if (MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
        mimeType = 'video/webm;codecs=vp9';
      }
      ext = 'webm';
    }

    const stream = _canvas.captureStream(fps);

    // 오디오 트랙이 있으면 함께 포함
    if (_mediaDest && _audioEl && !_audioEl.paused) {
      const audioTrack = _mediaDest.stream.getAudioTracks()[0];
      if (audioTrack) stream.addTrack(audioTrack);
    }

    const recorder = new MediaRecorder(stream, {
      mimeType: mimeType,
      videoBitsPerSecond: 12000000 // 12 Mbps 60 FPS 초고화질 비트레이트
    });

    const chunks = [];
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const modeLabel = _config.bgExportMode === 'green' ? '그린스크린' : '투명';
      a.download = `LP플레이어_60fps_${modeLabel}_${_config.title || '쇼츠위젯'}.${ext}`;
      a.click();

      _isExporting = false;
      if (btn) btn.disabled = false;
      if (statusText) {
        statusText.innerHTML = _config.bgExportMode === 'green'
          ? `✅ <strong class="text-emerald-400">60FPS 그린스크린 비디오 다운로드 완료!</strong><br><span class="text-slate-300">캡컷에서 <strong>[동영상] &gt; [오리기] &gt; [크로마키]</strong>로 초록색을 클릭하시면 22px 둥근 모서리가 100% 투명하게 적용됩니다.</span>`
          : `✅ <strong class="text-purple-300">60FPS 투명 비디오 다운로드 완료!</strong> (프리미어 프로 / 애프터이펙트에 얹으면 바로 투명 적용됩니다)`;
      }
    };

    recorder.start(100);
    let remaining = durationSec;

    if (statusText) statusText.innerHTML = `⏳ 60FPS 초고화질 비디오 렌더링 중... (남은 시간: ${remaining}초)`;

    const countdown = setInterval(() => {
      remaining--;
      if (remaining <= 0) {
        clearInterval(countdown);
        recorder.stop();
      } else {
        if (statusText) statusText.innerHTML = `⏳ 60FPS 초고화질 비디오 렌더링 중... (남은 시간: ${remaining}초)`;
      }
    }, 1000);
  };

  // ── 투명 PNG 이미지 스냅샷 다운로드 ─────────────────────────────────
  window.exportVinylImage = function () {
    const a = document.createElement('a');
    a.href = _canvas.toDataURL('image/png');
    a.download = `LP플레이어_${_config.title || '스틸컷'}.png`;
    a.click();
  };

})();
