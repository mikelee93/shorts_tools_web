require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
  }
}));

function formatLikes(count) {
  const n = parseInt(count, 10) || 0;
  if (n >= 10000) return `${(n / 10000).toFixed(1).replace(/\.0$/, '')}만`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}천`;
  return String(n);
}

function formatTimeAgo(isoString) {
  if (!isoString) return '방금 전';
  const diff = (Date.now() - new Date(isoString).getTime()) / 1000;
  if (diff < 60) return '방금 전';
  if (diff < 3600) return `${Math.floor(diff / 60)}분 전`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}시간 전`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}일 전`;
  if (diff < 86400 * 30) return `${Math.floor(diff / (86400 * 7))}주 전`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}개월 전`;
  return `${Math.floor(diff / (86400 * 365))}년 전`;
}

// 유튜브 Data API로 실제 댓글 추출 (최대 100개)
async function fetchRealComments(videoId, limit = 100) {
  const apiKey = process.env.YOUTUBE_API_KEY || 'AIzaSyBJTbXqN5tUtTaZEF2m4e-KPwdieSKvAA0';
  const maxResults = Math.min(Math.max(parseInt(limit, 10) || 100, 10), 100);
  const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${encodeURIComponent(videoId)}&order=relevance&maxResults=${maxResults}&key=${apiKey}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    const errText = await response.text();
    console.warn(`[YouTube API Error] status: ${response.status}`, errText);
    return null;
  }

  const data = await response.json();
  if (!data.items || data.items.length === 0) {
    return null;
  }

  return data.items.map((item, idx) => {
    const s = item.snippet?.topLevelComment?.snippet || {};
    let text = s.textOriginal || s.textDisplay || '';
    text = text.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').trim();

    return {
      id: item.id || `c_${idx}`,
      commentId: item.id || `c_${idx}`,
      author: s.authorDisplayName || '@user',
      authorName: s.authorDisplayName || '@user',
      authorAvatar: s.authorProfileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
      authorProfileImageUrl: s.authorProfileImageUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop',
      text: text,
      textOriginal: text,
      likeCount: s.likeCount || 0,
      likeCountFormatted: formatLikes(s.likeCount),
      publishedAt: s.publishedAt,
      publishedTime: formatTimeAgo(s.publishedAt),
      isVerified: false
    };
  });
}

// 유튜브 댓글 가져오기 API
app.get('/api/comments', async (req, res) => {
  const { url, limit } = req.query;
  if (!url) {
    return res.status(400).json({ success: false, error: '유튜브 URL이 필요합니다.' });
  }

  try {
    const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=|shorts\/))([\w-]{11})/);
    const videoId = match ? match[1] : null;

    if (!videoId) {
      return res.status(400).json({ success: false, error: '올바른 유튜브 링크가 아닙니다.' });
    }

    console.log(`[Comments API] Fetching real comments for videoId: ${videoId}...`);
    let comments = await fetchRealComments(videoId, limit);

    if (comments && comments.length > 0) {
      console.log(`[Comments API] Successfully fetched ${comments.length} real comments!`);
      return res.json({
        success: true,
        videoId,
        total: comments.length,
        isReal: true,
        comments
      });
    }

    // fallback sample comments
    console.log(`[Comments API] Using fallback sample comments for videoId: ${videoId}`);
    const sampleComments = [
      {
        id: "c1",
        author: "@user_kpoplove",
        authorAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100&h=100&fit=crop",
        text: "와 이 노래 진짜 오랜만이다 ㅠㅠ 2000년대 감성 미쳤음 당시 싸이월드 BGM 국룰이었는데",
        likeCount: "1.4천",
        publishedTime: "3일 전",
        isVerified: true
      },
      {
        id: "c2",
        author: "@nostalgia_vibes",
        authorAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100&h=100&fit=crop",
        text: "이 시절 노래들은 전주만 들어도 심장이 반응함 ㅋㅋㅋ 명곡은 시간이 지나도 명곡이네",
        likeCount: "820",
        publishedTime: "1주일 전",
        isVerified: false
      },
      {
        id: "c3",
        author: "@minafan_official",
        authorAvatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&h=100&fit=crop",
        text: "진짜 이때 미나 포스는 범접 불가였지.. 2002 월드컵 때 다들 난리났었는데 추억 돋는다",
        likeCount: "2.1천",
        publishedTime: "2주 전",
        isVerified: true
      },
      {
        id: "c4",
        author: "@music_collector",
        authorAvatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&h=100&fit=crop",
        text: "비트 진짜 세련됐다.. 요즘 나오는 팝송이랑 비교해도 사운드 전혀 안 꿀림",
        likeCount: "450",
        publishedTime: "1개월 전",
        isVerified: false
      }
    ];

    res.json({
      success: true,
      videoId,
      total: sampleComments.length,
      isReal: false,
      comments: sampleComments
    });
  } catch (err) {
    console.error('Comments fetch error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` 🚀 쇼츠 스튜디오 도구 웹앱 실행 중!`);
  console.log(` 📍 접속 주소: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
