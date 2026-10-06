const MEDIA_TYPES = new Set(['image', 'video']);

export function mediaAssetId(type, url) {
  const normalizedType = MEDIA_TYPES.has(type) ? type : 'media';
  let hash = 2166136261;
  for (const char of String(url || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return normalizedType + '-' + (hash >>> 0).toString(36);
}

export function detectMediaType(url, fallback = '') {
  const text = String(url || '').trim();
  if (/\.(?:png|jpe?g|webp|gif|avif|svg)(?:[?#].*)?$/i.test(text)) return 'image';
  if (isYouTubeUrl(text) || isVimeoUrl(text) || /\.(?:mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(text)) return 'video';
  return MEDIA_TYPES.has(fallback) ? fallback : '';
}

export function detectVideoProvider(url) {
  const text = String(url || '').trim();
  if (isYouTubeUrl(text)) return 'youtube';
  if (isVimeoUrl(text)) return 'vimeo';
  if (/\.(?:mp4|webm|ogg|mov)(?:[?#].*)?$/i.test(text)) return 'direct';
  return 'link';
}

export function videoEmbedUrl(url) {
  const text = String(url || '').trim();

  const youtubeId = getYouTubeId(text);
  if (youtubeId) return 'https://www.youtube-nocookie.com/embed/' + encodeURIComponent(youtubeId);

  const vimeoId = getVimeoId(text);
  if (vimeoId) return 'https://player.vimeo.com/video/' + encodeURIComponent(vimeoId);

  return '';
}

export function videoThumbnailUrl(url) {
  const youtubeId = getYouTubeId(String(url || '').trim());
  return youtubeId ? 'https://i.ytimg.com/vi/' + encodeURIComponent(youtubeId) + '/hqdefault.jpg' : '';
}

export function prepareCatalogMedia(inputCatalog) {
  const catalog = structuredClone(inputCatalog || {});
  const media = new Map();

  for (const asset of catalog.media || []) {
    if (!asset || !asset.id) continue;
    media.set(asset.id, normalizeAsset(asset));
  }

  for (const library of catalog.libraries || []) {
    for (const lesson of library.lessons || []) {
      for (const topic of lesson.topics || []) {
        for (const section of topic.sections || []) {
          normalizeSectionMedia(section, media);
        }
      }
    }
  }

  catalog.media = [...media.values()];
  return catalog;
}

export function resolveMediaAsset(catalog, sectionOrRef) {
  const ref = typeof sectionOrRef === 'string'
    ? sectionOrRef
    : sectionOrRef?.mediaRef;

  if (ref) {
    const asset = (catalog?.media || []).find(item => item?.id === ref);
    if (asset) return normalizeAsset(asset);
    if (/^(?:https:\/\/|\/(?!\/)|\.\.?\/)/i.test(ref)) {
      const type = detectMediaType(ref, 'image') || 'image';
      return normalizeAsset({ id: mediaAssetId(type, ref), type, url: ref });
    }
  }

  if (sectionOrRef && typeof sectionOrRef === 'object') {
    const url = sectionOrRef.url || sectionOrRef.src || '';
    if (url) {
      const type = detectMediaType(url, sectionOrRef.type);
      if (type) return normalizeAsset({
        id: mediaAssetId(type, url),
        type,
        url,
        title: sectionOrRef.title || '',
        caption: sectionOrRef.caption || '',
        alt: sectionOrRef.alt || '',
        sourceUrl: sectionOrRef.sourceUrl || '',
        credit: sectionOrRef.credit || '',
        author: sectionOrRef.author || '',
        license: sectionOrRef.license || '',
        provider: sectionOrRef.provider || '',
        thumbnailUrl: sectionOrRef.thumbnailUrl || ''
      });
    }
  }

  return null;
}

export function normalizeAsset(asset) {
  const url = String(asset?.url || asset?.src || '').trim();
  const type = detectMediaType(url, asset?.type) || asset?.type || 'image';
  const provider = type === 'video'
    ? (asset?.provider || detectVideoProvider(url))
    : (asset?.provider || '');
  const thumbnailUrl = asset?.thumbnailUrl || (type === 'video' ? videoThumbnailUrl(url) : '');

  return {
    id: String(asset?.id || mediaAssetId(type, url)),
    type,
    url,
    title: String(asset?.title || ''),
    caption: String(asset?.caption || ''),
    alt: String(asset?.alt || ''),
    sourceUrl: String(asset?.sourceUrl || ''),
    credit: String(asset?.credit || ''),
    author: String(asset?.author || ''),
    license: String(asset?.license || ''),
    provider,
    thumbnailUrl: String(thumbnailUrl || '')
  };
}

function normalizeSectionMedia(section, media) {
  if (!section || typeof section !== 'object') return;

  if (section.type === 'image' || section.type === 'video') {
    if (section.mediaRef && media.has(section.mediaRef)) return;

    const url = String(section.url || section.src || '').trim();
    if (!url) return;

    const type = section.type;
    const id = section.mediaRef || mediaAssetId(type, url);
    const current = media.get(id) || {};
    const asset = normalizeAsset({
      ...current,
      id,
      type,
      url,
      title: section.title || current.title || '',
      caption: section.caption || current.caption || '',
      alt: section.alt || current.alt || '',
      sourceUrl: section.sourceUrl || current.sourceUrl || '',
      credit: section.credit || current.credit || '',
      author: section.author || current.author || '',
      license: section.license || current.license || '',
      provider: section.provider || current.provider || '',
      thumbnailUrl: section.thumbnailUrl || current.thumbnailUrl || ''
    });

    media.set(id, asset);
    section.mediaRef = id;
    delete section.src;
    delete section.url;
    delete section.sourceUrl;
    delete section.credit;
    delete section.author;
    delete section.license;
    delete section.provider;
    delete section.thumbnailUrl;
    return;
  }

  if (section.type === 'gallery') {
    const refs = [];
    for (const item of section.items || []) {
      if (typeof item === 'string') {
        const raw = item.trim();
        if (/^(?:https:\/\/|\/(?!\/)|\.\.?\/)/i.test(raw)) {
          const type = detectMediaType(raw, 'image') || 'image';
          const id = mediaAssetId(type, raw);
          media.set(id, normalizeAsset({ id, type, url: raw }));
          refs.push(id);
        } else if (raw) {
          refs.push(raw);
        }
        continue;
      }
      const url = String(item?.url || item?.src || '').trim();
      if (!url) continue;
      const type = detectMediaType(url, item.type || 'image') || 'image';
      const id = item.mediaRef || mediaAssetId(type, url);
      media.set(id, normalizeAsset({ ...item, id, type, url }));
      refs.push(id);
    }
    section.items = refs;
  }
}

function isYouTubeUrl(value) {
  return /^(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(value);
}

function isVimeoUrl(value) {
  return /^(?:https?:\/\/)?(?:www\.)?vimeo\.com\//i.test(value);
}

function getYouTubeId(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') return cleanVideoId(url.pathname.split('/').filter(Boolean)[0]);
    if (host.endsWith('youtube.com')) {
      if (url.pathname === '/watch') return cleanVideoId(url.searchParams.get('v'));
      const match = url.pathname.match(/^\/(?:embed|shorts|live)\/([^/?#]+)/);
      return cleanVideoId(match?.[1]);
    }
  } catch {}
  return '';
}

function getVimeoId(value) {
  try {
    const url = new URL(value);
    if (!url.hostname.replace(/^www\./, '').endsWith('vimeo.com')) return '';
    const match = url.pathname.match(/\/(\d+)(?:$|[/?#])/);
    return match?.[1] || '';
  } catch {}
  return '';
}

function cleanVideoId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9_-]{6,20}$/.test(text) ? text : '';
}
