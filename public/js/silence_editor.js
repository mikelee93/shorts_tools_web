/**
 * ✂️ 무음 제거 & 배속 조절 에디터 (Silence Remover & Speed Changer) Controller
 * 100% Client-Side Web Audio API Engine (Mac, Windows, Vercel Zero-Install Guaranteed)
 */
(function() {
    // ── 전역 상태 ─────────────────────────────────────────────────────────
    window.silenceState = {
        file: null,
        fileName: '',
        preset: 'talk',
        activeTab: 'original',   // 'original' | 'result'
        audioBuffer: null,       // Web Audio DecodeBuffer (원본)
        resultAudioBuffer: null, // Web Audio DecodeBuffer (결과)
        resultDuration: 0,       // 결과 오디오의 초 단위 길이
        silences: [],            // [{ id, start, end, duration, remove }]
        speedRate: 1.0,          // 0.5 ~ 2.0배속
        exportFormat: 'wav',     // 'wav' | 'mp3'
        zoom: 1,

        // 🎵 Audio Player Engine
        audioElem: null,
        originalBlobUrl: null,   // 원본 Blob URL
        resultBlobUrl: null,     // 결과 Blob URL
        isPlaying: false,
        pauseOffset: 0,          // 초 단위 재생 위치
        audioCtx: null
    };

    let playheadAnimFrame = null;

    // Toast 안내
    function showToast(message) {
        let toast = document.getElementById('silenceGlobalToast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'silenceGlobalToast';
            toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:#0f172a;color:#f8fafc;padding:12px 20px;border-radius:10px;border:1px solid rgba(56,189,248,0.4);box-shadow:0 10px 25px rgba(0,0,0,0.5);font-size:13px;font-weight:700;z-index:9999;transition:all 0.3s ease;transform:translateY(100px);opacity:0;';
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => {
            toast.style.transform = 'translateY(100px)';
            toast.style.opacity = '0';
        }, 3200);
    }

    function setDownloadButtonsState(disabled, text = '저장') {
        const b1 = document.getElementById('btnSilenceDownload');
        const b2 = document.getElementById('btnSilenceDownloadBottom');
        if (b1) {
            b1.disabled = disabled;
            b1.textContent = text;
        }
        if (b2) {
            b2.disabled = disabled;
            b2.innerHTML = `<span>💾 ${text === '저장' ? '최종 오디오 저장' : text}</span>`;
        }
    }

    // Pitch Preservation 지원 Audio 태그
    function getAudioElem() {
        if (!window.silenceState.audioElem) {
            const audio = new Audio();
            audio.preservesPitch = true;
            if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
            if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
            window.silenceState.audioElem = audio;
        }
        const audio = window.silenceState.audioElem;
        audio.preservesPitch = true;
        if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
        return audio;
    }

    // AudioContext 싱글톤
    function getAudioCtx() {
        if (!window.silenceState.audioCtx) {
            window.silenceState.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (window.silenceState.audioCtx.state === 'suspended') {
            window.silenceState.audioCtx.resume();
        }
        return window.silenceState.audioCtx;
    }

    function getCurrentAudioUrl() {
        if (window.silenceState.activeTab === 'original') {
            return window.silenceState.originalBlobUrl;
        }
        return window.silenceState.resultBlobUrl || null;
    }

    function getCurrentBuffer() {
        if (window.silenceState.activeTab === 'original') {
            return window.silenceState.audioBuffer;
        }
        return window.silenceState.resultAudioBuffer || null;
    }

    function getCurrentDuration() {
        const audio = getAudioElem();
        if (audio && audio.duration && !isNaN(audio.duration) && isFinite(audio.duration)) {
            return audio.duration;
        }
        const buf = getCurrentBuffer();
        if (buf) return buf.duration;
        if (window.silenceState.activeTab === 'result' && window.silenceState.resultDuration) {
            return window.silenceState.resultDuration;
        }
        return 0;
    }

    function getCurrentPlaybackTime() {
        const audio = getAudioElem();
        if (audio && audio.src && !isNaN(audio.currentTime)) {
            return audio.currentTime;
        }
        return window.silenceState.pauseOffset || 0;
    }

    // ── 🎵 재생 / 일시정지 제어 ──────────────────────────────────────────
    window.toggleSilenceAudioPlay = function() {
        if (window.silenceState.isPlaying) {
            pauseSilenceAudio();
        } else {
            playSilenceAudio(getCurrentPlaybackTime());
        }
    };

    window.playSilenceAudio = function(offset = 0) {
        const url = getCurrentAudioUrl();
        if (!url) {
            if (window.silenceState.activeTab === 'result') {
                alert('결과 오디오가 아직 생성되지 않았습니다. [적용하기]를 먼저 눌러주세요.');
            } else {
                alert('오디오/영상 파일을 먼저 열어주세요.');
            }
            return;
        }

        const audio = getAudioElem();
        if (audio.src !== url && audio.src !== window.location.origin + url) {
            audio.src = url;
        }

        audio.preservesPitch = true;
        if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
        if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;

        const speed = window.silenceState.speedRate || 1.0;
        audio.playbackRate = speed;

        if (!isNaN(offset) && Math.abs(audio.currentTime - offset) > 0.3) {
            try { audio.currentTime = offset; } catch (e) {}
        }

        audio.onended = () => {
            stopSilenceAudio();
        };

        audio.play().then(() => {
            window.silenceState.isPlaying = true;
            const btn = document.getElementById('btnSilencePlayPause');
            if (btn) btn.textContent = '❚❚';
            startPlayheadLoop();
        }).catch(err => {
            console.error('[Audio Play Error]', err);
        });
    };

    window.pauseSilenceAudio = function() {
        const audio = getAudioElem();
        if (audio) {
            audio.pause();
            window.silenceState.pauseOffset = audio.currentTime;
        }
        window.silenceState.isPlaying = false;
        const btn = document.getElementById('btnSilencePlayPause');
        if (btn) btn.textContent = '▶';
        stopPlayheadLoop();
    };

    window.stopSilenceAudio = function() {
        const audio = getAudioElem();
        if (audio) {
            audio.pause();
            try { audio.currentTime = 0; } catch (e) {}
            window.silenceState.pauseOffset = 0;
        }
        window.silenceState.isPlaying = false;
        const btn = document.getElementById('btnSilencePlayPause');
        if (btn) btn.textContent = '▶';
        stopPlayheadLoop();
    };

    // ── 60fps 애니메이션 프레임 루프 (Playhead & 타임코드) ─────────────
    function startPlayheadLoop() {
        cancelAnimationFrame(playheadAnimFrame);
        function loop() {
            drawSilenceWaveform();
            if (window.silenceState.isPlaying) {
                playheadAnimFrame = requestAnimationFrame(loop);
            }
        }
        playheadAnimFrame = requestAnimationFrame(loop);
    }

    function stopPlayheadLoop() {
        cancelAnimationFrame(playheadAnimFrame);
        drawSilenceWaveform();
    }

    function formatTimeWithTenths(sec) {
        if (!sec || isNaN(sec) || sec < 0) return '00:00.0';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        const tenths = Math.floor((sec % 1) * 10);
        return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${tenths}`;
    }

    // ── ⚡ 초고속 클라이언트단 무음 탐지기 (Web Audio API PCM Scan) ───
    function detectSilencesClientSide(buffer, noiseDb = -30, minDuration = 0.25) {
        if (!buffer) return [];

        const pcm = buffer.getChannelData(0);
        const sampleRate = buffer.sampleRate;
        const threshold = Math.pow(10, noiseDb / 20);
        const minSamples = Math.floor(minDuration * sampleRate);

        const silences = [];
        let silenceStart = null;

        for (let i = 0; i < pcm.length; i++) {
            const amp = Math.abs(pcm[i]);
            if (amp < threshold) {
                if (silenceStart === null) silenceStart = i;
            } else {
                if (silenceStart !== null) {
                    const silenceLength = i - silenceStart;
                    if (silenceLength >= minSamples) {
                        const startSec = silenceStart / sampleRate;
                        const endSec = i / sampleRate;
                        silences.push({
                            id: 'silence_' + Math.random().toString(36).substr(2, 7),
                            start: parseFloat(startSec.toFixed(3)),
                            end: parseFloat(endSec.toFixed(3)),
                            duration: parseFloat((endSec - startSec).toFixed(3)),
                            remove: true
                        });
                    }
                    silenceStart = null;
                }
            }
        }

        if (silenceStart !== null) {
            const silenceLength = pcm.length - silenceStart;
            if (silenceLength >= minSamples) {
                const startSec = silenceStart / sampleRate;
                const endSec = pcm.length / sampleRate;
                silences.push({
                    id: 'silence_' + Math.random().toString(36).substr(2, 7),
                    start: parseFloat(startSec.toFixed(3)),
                    end: parseFloat(endSec.toFixed(3)),
                    duration: parseFloat((endSec - startSec).toFixed(3)),
                    remove: true
                });
            }
        }

        return silences;
    }

    // ── 프리셋 설정 ──────────────────────────────────────────────────
    window.selectSilencePreset = function(preset) {
        window.silenceState.preset = preset;
        const presets = ['tight', 'talk', 'podcast', 'speed_only', 'custom'];
        presets.forEach(p => {
            const btn = document.getElementById(`silencePreset_${p}`);
            if (btn) btn.classList.toggle('active', p === preset);
        });

        const noiseDbInput = document.getElementById('silenceNoiseDb');
        const minDurInput = document.getElementById('silenceMinDuration');
        const dbLabel = document.getElementById('silenceValDbLabel');
        const durLabel = document.getElementById('silenceValDurationLabel');
        const desc = document.getElementById('silencePresetDesc');

        let db = -30, dur = 0.25, textDesc = '';

        if (preset === 'speed_only') {
            textDesc = '⚡ 무음 유지 · 순수 배속 조절 전용 모드';
            if (desc) desc.textContent = textDesc;

            if (window.silenceState.silences) {
                window.silenceState.silences.forEach(s => s.remove = false);
            }
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
            showToast('⚡ 순수 배속 조절 모드 (무음 유지) 가 설정되었습니다.');
            return;
        }

        if (preset === 'tight') {
            db = -26; dur = 0.15;
            textDesc = '숨소리 제거 · -26 dB · 최소 0.15s';
        } else if (preset === 'talk') {
            db = -30; dur = 0.25;
            textDesc = '대화 빠르게 · -30 dB · 최소 0.25s';
        } else if (preset === 'podcast') {
            db = -38; dur = 0.35;
            textDesc = '팟캐스트 · -38 dB · 최소 0.35s';
        } else {
            db = parseInt(noiseDbInput ? noiseDbInput.value : -30, 10);
            dur = parseFloat(minDurInput ? minDurInput.value : 0.25);
            textDesc = `사용자 정의 · ${db} dB · 최소 ${dur}s`;
        }

        if (preset !== 'custom') {
            if (noiseDbInput) noiseDbInput.value = db;
            if (minDurInput) minDurInput.value = dur;
            if (dbLabel) dbLabel.textContent = `${db} dB`;
            if (durLabel) durLabel.textContent = `${dur}s`;
        }

        if (desc) desc.textContent = textDesc;

        if (window.silenceState.audioBuffer) {
            window.silenceState.silences = detectSilencesClientSide(window.silenceState.audioBuffer, db, dur);
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
        }
    };

    // ── ⚡ 포맷 드롭다운 동기화 ──────────────────────────────────────
    window.syncSilenceExportFormat = function(fmt) {
        window.silenceState.exportFormat = fmt || 'wav';
        const selects = document.querySelectorAll('.silence-format-select');
        selects.forEach(sel => {
            if (sel.value !== fmt) sel.value = fmt;
        });
    };

    // ── ⚡ 배속 조절 제어 ─────────────────────────────────────────────
    window.updateSilenceSpeedRate = function(val) {
        const speed = parseFloat(val || 1.0);
        window.silenceState.speedRate = speed;

        const sliders = document.querySelectorAll('.silence-speed-slider');
        sliders.forEach(s => {
            if (parseFloat(s.value) !== speed) s.value = speed;
        });

        const valElem = document.getElementById('silencePlayerSpeedVal');
        if (valElem) valElem.textContent = `${speed.toFixed(2)}x`;

        const badge = document.getElementById('silenceSpeedBadge');
        if (badge) {
            badge.textContent = `${speed.toFixed(2)}x ${speed === 1.0 ? '(원래 속도)' : ''}`;
        }

        if (window.silenceState.isPlaying && window.silenceState.audioElem) {
            const audio = window.silenceState.audioElem;
            audio.preservesPitch = true;
            if ('mozPreservesPitch' in audio) audio.mozPreservesPitch = true;
            if ('webkitPreservesPitch' in audio) audio.webkitPreservesPitch = true;
            audio.playbackRate = speed;
        }

        updateSilenceMetricsUI();
    };

    window.setSilenceSpeedPreset = function(speed) {
        updateSilenceSpeedRate(speed);
    };

    // ── 파일 선택 (업로드 즉시 실시간 무음 자동 감지!) ─────────────
    window.onSilenceFileSelected = function(e) {
        const file = e.target.files[0];
        if (!file) return;

        stopSilenceAudio();

        if (window.silenceState.originalBlobUrl) {
            try { URL.revokeObjectURL(window.silenceState.originalBlobUrl); } catch (e) {}
        }
        if (window.silenceState.resultBlobUrl) {
            try { URL.revokeObjectURL(window.silenceState.resultBlobUrl); } catch (e) {}
        }

        window.silenceState.originalBlobUrl = URL.createObjectURL(file);
        window.silenceState.file = file;
        window.silenceState.fileName = file.name;
        window.silenceState.resultBlobUrl = null;
        window.silenceState.audioBuffer = null;
        window.silenceState.resultAudioBuffer = null;
        window.silenceState.resultDuration = 0;
        window.silenceState.silences = [];
        window.silenceState.activeTab = 'original';

        const btnDetect = document.getElementById('btnSilenceDetect');
        const btnApply = document.getElementById('btnSilenceApply');
        if (btnDetect) btnDetect.disabled = false;
        if (btnApply) {
            btnApply.disabled = false;
            btnApply.innerHTML = `<span>⚡ 무음제거 / 배속 적용하기</span>`;
        }
        setDownloadButtonsState(true, '저장');

        const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
        document.getElementById('silenceChipName').textContent = file.name;
        document.getElementById('silenceChipSize').textContent = `${sizeMb} MB`;
        document.getElementById('silenceMetaChips').style.display = 'flex';

        window.switchSilenceWaveTab('original');

        decodeAndAutoDetectSilence(file);
    };

    async function decodeAndAutoDetectSilence(file) {
        try {
            const arrayBuffer = await file.arrayBuffer();
            const ctx = getAudioCtx();
            const decodedData = await ctx.decodeAudioData(arrayBuffer);
            window.silenceState.audioBuffer = decodedData;

            const dur = decodedData.duration.toFixed(3);
            const sr = decodedData.sampleRate.toLocaleString();
            const ch = decodedData.numberOfChannels;

            document.getElementById('silenceChipDuration').textContent = `${dur}초`;
            document.getElementById('silenceChipSampleRate').textContent = `${sr}Hz`;
            document.getElementById('silenceChipChannels').textContent = `${ch}ch`;

            const noiseDb = parseInt(document.getElementById('silenceNoiseDb')?.value || -30, 10);
            const minDur = parseFloat(document.getElementById('silenceMinDuration')?.value || 0.25);

            window.silenceState.silences = detectSilencesClientSide(decodedData, noiseDb, minDur);

            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();

            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `🎉 파일 로드 완료! 무음 ${window.silenceState.silences.length}개가 실시간 탐지되었습니다. [적용하기]를 누르거나 속도를 조절하세요.`;
        } catch (err) {
            console.warn('[decodeAndAutoDetectSilence error]', err);
            alert('오디오 파일 디코딩 오류: ' + err.message);
        }
    }

    // 수동 [무음 구간 감지하기] 버튼 클릭
    window.runSilenceDetection = async function() {
        const file = window.silenceState.file;
        if (!file) {
            alert('먼저 오디오/영상 파일을 업로드해주세요.');
            return;
        }

        const noiseDb = parseInt(document.getElementById('silenceNoiseDb').value, 10);
        const minDuration = parseFloat(document.getElementById('silenceMinDuration').value);

        const btnDetect = document.getElementById('btnSilenceDetect');
        if (btnDetect) {
            btnDetect.disabled = true;
            btnDetect.innerHTML = `<span>⏳ 무음 구간 감지 중...</span>`;
        }

        try {
            if (window.silenceState.audioBuffer) {
                window.silenceState.silences = detectSilencesClientSide(window.silenceState.audioBuffer, noiseDb, minDuration);
                updateSilenceMetricsUI();
                renderSilenceDetailList();
                drawSilenceWaveform();
            }

            document.getElementById('btnSilenceApply').disabled = false;
            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `무음 ${window.silenceState.silences.length}개가 감지되었습니다. [적용하기]를 눌러 결과를 생성하세요.`;

            showToast(`🎉 무음 ${window.silenceState.silences.length}개 감지 완료!`);
        } catch (err) {
            console.error(err);
            alert('무음 감지 오류: ' + err.message);
        } finally {
            if (btnDetect) {
                btnDetect.disabled = false;
                btnDetect.innerHTML = `<span>🔍 무음 구간 감지하기</span>`;
            }
        }
    };

    // ── ✂️ 클라이언트 오디오 버퍼 무음 구간 자르기 (Instant PCM Concat) ──
    function sliceAudioBuffer(buffer, silences) {
        const activeSilences = (silences || []).filter(s => s.remove).sort((a, b) => a.start - b.start);
        const keptSegments = [];
        let lastPos = 0;
        const totalDuration = buffer.duration;

        for (const s of activeSilences) {
            if (s.start > lastPos + 0.02) {
                keptSegments.push({ start: lastPos, end: s.start });
            }
            lastPos = Math.max(lastPos, s.end);
        }
        if (totalDuration > lastPos + 0.02) {
            keptSegments.push({ start: lastPos, end: totalDuration });
        }
        if (keptSegments.length === 0) {
            keptSegments.push({ start: 0, end: totalDuration });
        }

        const sampleRate = buffer.sampleRate;
        const numChannels = buffer.numberOfChannels;

        let totalKeptSamples = 0;
        const segSamples = keptSegments.map(seg => {
            const start = Math.max(0, Math.floor(seg.start * sampleRate));
            const end = Math.min(buffer.length, Math.ceil(seg.end * sampleRate));
            const len = Math.max(0, end - start);
            totalKeptSamples += len;
            return { start, end, len };
        });

        const ctx = getAudioCtx();
        const newBuffer = ctx.createBuffer(numChannels, Math.max(1, totalKeptSamples), sampleRate);

        for (let ch = 0; ch < numChannels; ch++) {
            const src = buffer.getChannelData(ch);
            const dest = newBuffer.getChannelData(ch);
            let offset = 0;
            for (const seg of segSamples) {
                if (seg.len > 0) {
                    dest.set(src.subarray(seg.start, seg.end), offset);
                    offset += seg.len;
                }
            }
        }

        return { buffer: newBuffer, keptSegments };
    }

    // ── ⚡ 배속 렌더링 (OfflineAudioContext) ───────────────────────────
    async function renderSpeedAdjustedBuffer(buffer, speedRate) {
        if (Math.abs(speedRate - 1.0) < 0.005) return buffer;
        const targetDuration = buffer.duration / speedRate;
        const sampleRate = buffer.sampleRate;
        const targetSamples = Math.max(1, Math.round(targetDuration * sampleRate));
        const offlineCtx = new OfflineAudioContext(buffer.numberOfChannels, targetSamples, sampleRate);
        const src = offlineCtx.createBufferSource();
        src.buffer = buffer;
        src.playbackRate.value = speedRate;
        src.connect(offlineCtx.destination);
        src.start(0);
        return await offlineCtx.startRendering();
    }

    // ── 📦 WAV 인코더 (16-bit PCM Lossless) ───────────────────────────
    function audioBufferToWav(buffer) {
        const numChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const format = 1; // PCM
        const bitDepth = 16;

        let interleaved;
        if (numChannels === 2) {
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            interleaved = new Float32Array(left.length + right.length);
            let idx = 0;
            for (let i = 0; i < left.length; i++) {
                interleaved[idx++] = left[i];
                interleaved[idx++] = right[i];
            }
        } else {
            interleaved = buffer.getChannelData(0);
        }

        const bytesPerSample = bitDepth / 8;
        const blockAlign = numChannels * bytesPerSample;
        const byteRate = sampleRate * blockAlign;
        const dataSize = interleaved.length * bytesPerSample;
        const bufferSize = 44 + dataSize;
        const arrayBuffer = new ArrayBuffer(bufferSize);
        const view = new DataView(arrayBuffer);

        function writeString(view, offset, string) {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        }

        writeString(view, 0, 'RIFF');
        view.setUint32(4, 36 + dataSize, true);
        writeString(view, 8, 'WAVE');
        writeString(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, format, true);
        view.setUint16(22, numChannels, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, byteRate, true);
        view.setUint16(32, blockAlign, true);
        view.setUint16(34, bitDepth, true);
        writeString(view, 36, 'data');
        view.setUint32(40, dataSize, true);

        let offset = 44;
        for (let i = 0; i < interleaved.length; i++, offset += 2) {
            let s = Math.max(-1, Math.min(1, interleaved[i]));
            view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
        }

        return new Blob([view], { type: 'audio/wav' });
    }

    // ── 📦 MP3 인코더 (lamejs 브라우저 인코딩) ───────────────────────
    function audioBufferToMp3(buffer) {
        if (typeof lamejs === 'undefined') {
            console.warn('[MP3 Fallback] lamejs 미로드 상태이므로 WAV로 대체 저장합니다.');
            return audioBufferToWav(buffer);
        }

        const channels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const mp3enc = new lamejs.Mp3Encoder(channels, sampleRate, 192);
        const mp3Data = [];

        const leftFloat = buffer.getChannelData(0);
        const left = new Int16Array(leftFloat.length);
        for (let i = 0; i < leftFloat.length; i++) {
            let s = Math.max(-1, Math.min(1, leftFloat[i]));
            left[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }

        let right = null;
        if (channels === 2) {
            const rightFloat = buffer.getChannelData(1);
            right = new Int16Array(rightFloat.length);
            for (let i = 0; i < rightFloat.length; i++) {
                let s = Math.max(-1, Math.min(1, rightFloat[i]));
                right[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
            }
        }

        const sampleBlockSize = 1152;
        for (let i = 0; i < left.length; i += sampleBlockSize) {
            const leftChunk = left.subarray(i, i + sampleBlockSize);
            let mp3buf;
            if (channels === 2 && right) {
                const rightChunk = right.subarray(i, i + sampleBlockSize);
                mp3buf = mp3enc.encodeBuffer(leftChunk, rightChunk);
            } else {
                mp3buf = mp3enc.encodeBuffer(leftChunk);
            }
            if (mp3buf.length > 0) mp3Data.push(mp3buf);
        }

        const endBuf = mp3enc.flush();
        if (endBuf.length > 0) mp3Data.push(endBuf);

        return new Blob(mp3Data, { type: 'audio/mp3' });
    }

    // ── 무음 제거 또는 배속 조절 적용하기 (100% Client-Side Web Audio) ─
    window.runSilenceApply = async function() {
        const origBuffer = window.silenceState.audioBuffer;
        if (!origBuffer) {
            alert('오디오/영상 파일을 먼저 열어주세요.');
            return;
        }

        stopSilenceAudio();

        const btnApply = document.getElementById('btnSilenceApply');
        if (btnApply) {
            btnApply.disabled = true;
            btnApply.innerHTML = `<span>⏳ 브라우저 인코딩 처리 중...</span>`;
        }

        try {
            const speedRate = window.silenceState.speedRate || 1.0;

            // 1. 무음 구간 컷팅 (0.01초 만에 실행!)
            const { buffer: slicedBuffer } = sliceAudioBuffer(origBuffer, window.silenceState.silences);
            window.silenceState.resultAudioBuffer = slicedBuffer;
            window.silenceState.resultDuration = slicedBuffer.duration / speedRate;

            // 2. 브라우저 재생용 WAV Blob 생성
            const wavBlob = audioBufferToWav(slicedBuffer);
            if (window.silenceState.resultBlobUrl) {
                try { URL.revokeObjectURL(window.silenceState.resultBlobUrl); } catch (e) {}
            }
            window.silenceState.resultBlobUrl = URL.createObjectURL(wavBlob);

            // 3. 결과 파형 탭으로 자동 전환 및 즉시 자동 재생
            window.switchSilenceWaveTab('result');
            playSilenceAudio(0);

            // 4. 저장 버튼 활성화
            setDownloadButtonsState(false, '저장');

            document.getElementById('silenceNoticeBanner').style.display = 'flex';
            document.getElementById('silenceNoticeText').textContent = `🎉 결과 생성이 완료되었습니다! 재생 바에서 들어보거나 [저장] 버튼을 누르세요.`;

            const speedMsg = speedRate !== 1.0 ? ` ${speedRate}x 배속` : '';
            const silenceMsg = (window.silenceState.silences || []).filter(s => s.remove).length > 0 ? ' 무음제거 &' : '';
            showToast(`🎉${silenceMsg}${speedMsg} 처리가 완료되었습니다!`);

        } catch (err) {
            console.error('[runSilenceApply error]', err);
            alert('적용 중 오류 발생: ' + err.message);
        } finally {
            if (btnApply) {
                btnApply.disabled = false;
                btnApply.innerHTML = `<span>⚡ 무음제거 / 배속 적용하기</span>`;
            }
        }
    };

    // ── 5개 KPI 메트릭 계산 및 갱신 ─────────────────────────────────────
    function updateSilenceMetricsUI() {
        const silences = window.silenceState.silences || [];
        const speed = window.silenceState.speedRate || 1.0;
        const totalDuration = window.silenceState.audioBuffer ? window.silenceState.audioBuffer.duration : 0;
        const removedDuration = silences.filter(s => s.remove).reduce((acc, cur) => acc + cur.duration, 0);

        const netDuration = Math.max(0, totalDuration - removedDuration);
        const predictedFinalDuration = netDuration / speed;

        const savedPercent = totalDuration > 0 ? (((totalDuration - predictedFinalDuration) / totalDuration) * 100).toFixed(2) : '0.00';

        const elemRemoved = document.getElementById('silenceValRemovedDuration');
        const elemFinal = document.getElementById('silenceValFinalDuration');
        const elemSaved = document.getElementById('silenceValSavedPercent');

        if (elemRemoved) elemRemoved.textContent = `${removedDuration.toFixed(3)}초`;
        if (elemFinal) elemFinal.textContent = `${predictedFinalDuration.toFixed(3)}초`;
        if (elemSaved) elemSaved.textContent = `${savedPercent}%`;

        const totalBadge = document.getElementById('silenceTotalListCount');
        if (totalBadge) totalBadge.textContent = `감지 ${silences.length}개`;

        if (window.silenceState.activeTab === 'original') {
            const headerBadge = document.getElementById('silenceHeaderBadge');
            if (headerBadge) headerBadge.textContent = `감지 ${silences.length}개`;
        }
    }

    // ── 감지 세부 구간 목록 렌더링 ────────────────────────────────────
    function renderSilenceDetailList() {
        const container = document.getElementById('silenceDetailList');
        const silences = window.silenceState.silences || [];

        if (!container) return;

        if (silences.length === 0) {
            container.innerHTML = `<div style="font-size:11px; color:#64748b; text-align:center; padding:16px 0;">감지된 무음 구간이 없습니다.</div>`;
            return;
        }

        container.innerHTML = silences.map((s, idx) => `
            <div style="display:flex; justify-content:space-between; align-items:center; background:rgba(255,255,255,0.03); border:1px solid rgba(255,255,255,0.06); padding:6px 12px; border-radius:6px; font-size:11px;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <span style="font-weight:700; color:#64748b; width:24px;">#${idx + 1}</span>
                    <span style="color:#ffffff; font-family:monospace;">${s.start.toFixed(3)}s ~ ${s.end.toFixed(3)}s</span>
                    <span style="color:#facc15; font-weight:600;">(${s.duration.toFixed(3)}초)</span>
                </div>
                <label style="display:flex; align-items:center; gap:6px; font-size:11px; color:${s.remove ? '#ef4444' : '#22c55e'}; cursor:pointer; font-weight:700;">
                    <input type="checkbox" ${s.remove ? 'checked' : ''} onchange="toggleSilenceItem('${s.id}')">
                    <span>${s.remove ? '제거됨' : '유지됨'}</span>
                </label>
            </div>
        `).join('');
    }

    window.toggleSilenceItem = function(id) {
        const item = window.silenceState.silences.find(s => s.id === id);
        if (item) {
            item.remove = !item.remove;
            updateSilenceMetricsUI();
            renderSilenceDetailList();
            drawSilenceWaveform();
        }
    };

    // ── 탭 전환 (원본 파형 / 결과 파형) ──────────────────────────────
    window.switchSilenceWaveTab = function(tab) {
        stopSilenceAudio();

        window.silenceState.activeTab = tab;
        const btnOrig = document.getElementById('btnSilenceTabOrig');
        const btnRes = document.getElementById('btnSilenceTabResult');
        const headerTitle = document.getElementById('silenceHeaderTitle');
        const headerBadge = document.getElementById('silenceHeaderBadge');

        if (btnOrig) {
            btnOrig.style.background = tab === 'original' ? '#2563eb' : 'transparent';
            btnOrig.style.color = tab === 'original' ? '#fff' : '#94a3b8';
        }
        if (btnRes) {
            btnRes.style.background = tab === 'result' ? '#2563eb' : 'transparent';
            btnRes.style.color = tab === 'result' ? '#fff' : '#94a3b8';
        }

        if (tab === 'original') {
            if (headerTitle) headerTitle.textContent = 'Original Audio';
            if (headerBadge) headerBadge.textContent = `감지 ${(window.silenceState.silences || []).length}개`;
        } else {
            if (headerTitle) headerTitle.textContent = 'Result Audio (무음 제거 & 배속 적용 완료)';
            const dur = getCurrentDuration();
            if (headerBadge) headerBadge.textContent = `결과 ${parseFloat(dur).toFixed(3)}초`;
        }

        drawSilenceWaveform();
    };

    // ── 2D Canvas Waveform Visualizer & Moving Playhead Cursor ───────
    window.drawSilenceWaveform = function() {
        const canvas = document.getElementById('silenceWaveformCanvas');
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const width = canvas.width = canvas.parentElement.clientWidth || 1200;
        const height = canvas.height = 150;

        ctx.clearRect(0, 0, width, height);

        const tab = window.silenceState.activeTab;
        const buffer = getCurrentBuffer();

        const currTime = getCurrentPlaybackTime();
        const totalDuration = getCurrentDuration();

        const playTimeElem = document.getElementById('silencePlayTime');
        if (playTimeElem) {
            playTimeElem.textContent = `${formatTimeWithTenths(currTime)} / ${formatTimeWithTenths(totalDuration)}`;
        }

        const grad = ctx.createLinearGradient(0, 0, 0, height);
        grad.addColorStop(0, '#082f49');
        grad.addColorStop(1, '#0c4a6e');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        const amp = height / 2;
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, amp);
        ctx.lineTo(width, amp);
        ctx.stroke();

        if (!window.silenceState.audioBuffer && !buffer) {
            ctx.fillStyle = '#94a3b8';
            ctx.font = '13px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(tab === 'original' ? '오디오 파일 열기 시 파형 및 무음 구간이 즉시 시각화됩니다.' : '적용하기 완료 후 결과 파형이 시각화됩니다.', width / 2, height / 2);
            return;
        }

        // 🌟 Highlight Silences (Original Tab)
        if (tab === 'original' && window.silenceState.audioBuffer && window.silenceState.silences) {
            const silences = window.silenceState.silences;
            const totalOrigDur = window.silenceState.audioBuffer.duration;
            silences.forEach(s => {
                const startX = (s.start / totalOrigDur) * width;
                const endX = (s.end / totalOrigDur) * width;
                const w = Math.max(3, endX - startX);

                ctx.fillStyle = s.remove ? 'rgba(56, 189, 248, 0.28)' : 'rgba(250, 204, 21, 0.28)';
                ctx.fillRect(startX, 0, w, height);

                ctx.strokeStyle = s.remove ? 'rgba(56, 189, 248, 0.8)' : 'rgba(250, 204, 21, 0.8)';
                ctx.lineWidth = 1.2;
                ctx.strokeRect(startX, 0, w, height);
            });
        }

        // 파형 Bar 그리기
        if (buffer) {
            const rawData = buffer.getChannelData(0);
            const step = Math.ceil(rawData.length / width);

            ctx.fillStyle = tab === 'original' ? '#38bdf8' : '#34d399';
            for (let i = 0; i < width; i += 2) {
                let min = 1.0;
                let max = -1.0;
                for (let j = 0; j < step; j++) {
                    const datum = rawData[(i * step) + j];
                    if (datum < min) min = datum;
                    if (datum > max) max = datum;
                }

                const barHeight = Math.max(3, (max - min) * amp * 0.85);
                ctx.fillRect(i, amp - barHeight / 2, 1.5, barHeight);
            }
        }

        // 🎯 Moving Playhead Cursor Line
        if (totalDuration > 0) {
            const currX = (currTime / totalDuration) * width;

            ctx.save();
            ctx.shadowColor = '#ffffff';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 2.5;

            ctx.beginPath();
            ctx.moveTo(currX, 0);
            ctx.lineTo(currX, height);
            ctx.stroke();

            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.moveTo(currX - 6, 0);
            ctx.lineTo(currX + 6, 0);
            ctx.lineTo(currX, 10);
            ctx.closePath();
            ctx.fill();

            ctx.beginPath();
            ctx.moveTo(currX - 6, height);
            ctx.lineTo(currX + 6, height);
            ctx.lineTo(currX, height - 10);
            ctx.closePath();
            ctx.fill();

            ctx.restore();
        }
    };

    window.onSilenceCanvasClick = function(e) {
        const canvas = document.getElementById('silenceWaveformCanvas');
        const total = getCurrentDuration();
        if (!canvas || total <= 0) return;

        const rect = canvas.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const ratio = clickX / rect.width;
        const targetTime = ratio * total;

        const wasPlaying = window.silenceState.isPlaying;

        const audio = getAudioElem();
        if (audio) {
            try { audio.currentTime = targetTime; } catch (err) {}
        }

        window.silenceState.pauseOffset = targetTime;
        drawSilenceWaveform();

        if (wasPlaying) {
            playSilenceAudio(targetTime);
        }
    };

    // ── 다운로드 및 초기화 ──────────────────────────────────────────────
    window.downloadSilenceResult = async function() {
        let resultBuffer = window.silenceState.resultAudioBuffer;
        const currentSpeed = window.silenceState.speedRate || 1.0;
        const currentFormat = window.silenceState.exportFormat || 'wav';

        if (!resultBuffer && window.silenceState.audioBuffer) {
            // 아직 적용 버튼을 안 눌렀다면 즉시 적용
            await runSilenceApply();
            resultBuffer = window.silenceState.resultAudioBuffer;
        }

        if (!resultBuffer) {
            alert('저장할 오디오 데이터가 없습니다. 먼저 오디오 파일을 업로드하세요.');
            return;
        }

        setDownloadButtonsState(true, '인코딩 중...');

        try {
            // 배속 반영하여 버퍼 렌더링
            const finalBuffer = await renderSpeedAdjustedBuffer(resultBuffer, currentSpeed);

            // 포맷별 Blob 생성
            let blob;
            if (currentFormat === 'mp3') {
                blob = audioBufferToMp3(finalBuffer);
            } else {
                blob = audioBufferToWav(finalBuffer);
            }

            const originalName = window.silenceState.fileName ? window.silenceState.fileName.replace(/\.[^/.]+$/, "") : "무음제거_결과";
            const ext = currentFormat === 'mp3' && blob.type.includes('mp3') ? 'mp3' : 'wav';
            const filename = `${originalName}_무음제거_${currentSpeed}x.${ext}`;

            // 브라우저 직접 다운로드 트리거
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            showToast(`💾 [${filename}] 다운로드가 시작되었습니다!`);
        } catch (err) {
            console.error('[downloadSilenceResult Error]', err);
            alert('오디오 파일 저장 실패: ' + err.message);
        } finally {
            setDownloadButtonsState(false, '저장');
        }
    };

    window.resetSilenceEditor = function() {
        stopSilenceAudio();

        if (window.silenceState.originalBlobUrl) {
            try { URL.revokeObjectURL(window.silenceState.originalBlobUrl); } catch (e) {}
        }
        if (window.silenceState.resultBlobUrl) {
            try { URL.revokeObjectURL(window.silenceState.resultBlobUrl); } catch (e) {}
        }
        if (window.silenceState.audioElem) {
            try {
                window.silenceState.audioElem.pause();
                window.silenceState.audioElem.src = '';
            } catch (e) {}
        }

        window.silenceState = {
            file: null,
            fileName: '',
            preset: 'talk',
            activeTab: 'original',
            audioBuffer: null,
            resultAudioBuffer: null,
            resultDuration: 0,
            silences: [],
            speedRate: 1.0,
            exportFormat: 'wav',
            zoom: 1,
            audioElem: null,
            originalBlobUrl: null,
            resultBlobUrl: null,
            isPlaying: false,
            pauseOffset: 0,
            audioCtx: null
        };

        const fileInput = document.getElementById('silenceFileInput');
        if (fileInput) fileInput.value = '';

        document.getElementById('btnSilenceDetect').disabled = true;
        document.getElementById('btnSilenceApply').disabled = true;
        setDownloadButtonsState(true, '저장');
        document.getElementById('silenceMetaChips').style.display = 'none';
        document.getElementById('silenceNoticeBanner').style.display = 'none';

        updateSilenceSpeedRate(1.0);
        selectSilencePreset('talk');

        document.getElementById('silenceValRemovedDuration').textContent = '--';
        document.getElementById('silenceValFinalDuration').textContent = '--';
        document.getElementById('silenceValSavedPercent').textContent = '--';

        document.getElementById('silenceDetailList').innerHTML = `<div style="font-size:11px; color:#64748b; text-align:center; padding:16px 0;">오디오 파일 업로드 후 [무음 구간 감지하기]를 진행하거나 원하는 배속으로 적용하세요.</div>`;

        drawSilenceWaveform();
        showToast('🔄 무음 제거 & 배속 조절 에디터가 초기화되었습니다.');
    };

    const SAMPLE_SILENCE_SCRIPT = `80대 택시 기사가 신라호텔 회전문을 산산조각 냈습니다. 수리비만 무려 5억 원. 
기사님이 가입한 보험 한도는 고작 5천만 원뿐, 평생 번 돈을 전부 몰수당하고 길거리에 나앉을 절체절명의 위기였죠. 
담당자들은 당장 전액을 배상하라며 압박해 왔고, 기사님은 억울함과 공포에 떨어야 했습니다. 
그때 보고를 받은 이부진 사장의 행동은 충격적이었습니다.
당장 배상 요구를 전부 중단시키더니, 수행원을 보내 기사님의 처지를 몰래 조사하게 한 겁니다. 
알고 보니 낡은 단칸방에서 몸이 아픈 아내를 돌보며 간신히 살아가는 비참한 형편이었죠.
사연을 들은 이부진은 그 자리에서 일침을 가했습니다.
"우리가 겪은 손해보다 이분이 받으셨을 충격이 더 큽니다.
배상금 4억 원은 전액 면제해 드리고, 치료비까지 전부 회사가 부담하세요."
한순간의 실수로 인생이 끝날 뻔한 힘없는 노인을 거대 기업의 회장이 직접 감싸 안아준 사건.
여러분은 이부진 사장의 이 결단을 어떻게 생각하시나요?`;

    window.loadSampleSilenceScript = function() {
        const input = document.getElementById('silenceScriptInput');
        if (input) input.value = SAMPLE_SILENCE_SCRIPT;
    };

    function formatSrtTimestamp(sec) {
        if (isNaN(sec) || sec < 0) sec = 0;
        const hrs = Math.floor(sec / 3600);
        const mins = Math.floor((sec % 3600) / 60);
        const secs = Math.floor(sec % 60);
        const millis = Math.floor((sec % 1) * 1000);
        return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(millis).padStart(3, '0')}`;
    }

    function splitTextIntoSemanticChunks(text, maxChars = 15) {
        if (!text) return [];
        const rawParagraphs = text.split('\n').map(p => p.trim()).filter(Boolean);
        const initialSentences = [];

        rawParagraphs.forEach(p => {
            const parts = p.split(/(?<=[.?!,])\s+/).map(x => x.trim()).filter(Boolean);
            if (parts.length > 0) initialSentences.push(...parts);
            else if (p) initialSentences.push(p);
        });

        if (!maxChars || maxChars <= 0) return initialSentences;

        const finalChunks = [];
        initialSentences.forEach(sentence => {
            if (sentence.length <= maxChars) {
                finalChunks.push(sentence);
                return;
            }
            const words = sentence.split(/\s+/).filter(Boolean);
            let currentChunk = '';
            words.forEach(word => {
                if (!currentChunk) {
                    currentChunk = word;
                } else if ((currentChunk + ' ' + word).length <= maxChars + 2) {
                    currentChunk += ' ' + word;
                } else {
                    finalChunks.push(currentChunk);
                    currentChunk = word;
                }
            });
            if (currentChunk) finalChunks.push(currentChunk);
        });

        return finalChunks;
    }

    window.generateAndDownloadSilenceSRT = function() {
        const input = document.getElementById('silenceScriptInput');
        const scriptText = input ? input.value.trim() : '';

        if (!scriptText) {
            alert('대본 텍스트를 입력해 주세요. 입력하신 대본 문장들이 무음 제거 및 배속이 반영된 오디오 시간에 맞춰 .srt 자막 파일로 생성됩니다.');
            return;
        }

        const maxCharsSelect = document.getElementById('silenceMaxCharsSelect');
        const maxChars = maxCharsSelect ? parseInt(maxCharsSelect.value) : 15;

        const sentences = splitTextIntoSemanticChunks(scriptText, maxChars);
        if (sentences.length === 0) {
            alert('유효한 문장이 없습니다.');
            return;
        }

        let totalDuration = window.silenceState.resultDuration;
        if (!totalDuration || totalDuration <= 0) {
            const silences = window.silenceState.silences || [];
            const speed = window.silenceState.speedRate || 1.0;
            const origDur = window.silenceState.audioBuffer ? window.silenceState.audioBuffer.duration : 0;
            const removedDur = silences.filter(s => s.remove).reduce((a, b) => a + b.duration, 0);
            const netDur = Math.max(0.1, origDur - removedDur);
            totalDuration = netDur / speed;
        }

        if (!totalDuration || totalDuration <= 0) {
            totalDuration = 52.271;
        }

        const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
        let cumulativeChars = 0;

        const srtEntries = sentences.map((sentence, idx) => {
            const startRatio = cumulativeChars / totalChars;
            cumulativeChars += sentence.length;
            const endRatio = cumulativeChars / totalChars;

            const startSec = startRatio * totalDuration;
            const endSec = (idx === sentences.length - 1)
                ? totalDuration
                : Math.max(startSec + 0.1, (endRatio * totalDuration) - 0.04);

            return `${idx + 1}\n${formatSrtTimestamp(startSec)} --> ${formatSrtTimestamp(endSec)}\n${sentence}\n`;
        });

        const srtContent = srtEntries.join('\n');
        const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const originalName = window.silenceState.fileName ? window.silenceState.fileName.replace(/\.[^/.]+$/, "") : "무음제거_결과";
        const speed = window.silenceState.speedRate || 1.0;
        a.download = `자막_${originalName}_${speed}x.srt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`🎉 Vrew 스타일 ${maxChars > 0 ? maxChars + '자' : '문장'} 단위 분할 (총 ${sentences.length}개 클립) 자막 다운로드 완료!`);
    };

    window.initSilenceEditor = function() {
        drawSilenceWaveform();
        window.addEventListener('resize', () => {
            drawSilenceWaveform();
        });
    };

})();
