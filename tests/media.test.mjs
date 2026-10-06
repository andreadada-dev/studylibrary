import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareCatalogMedia,
  mediaAssetId,
  detectMediaType,
  detectVideoProvider,
  videoEmbedUrl
} from '../js/media.js';

test('inline image and video sections are normalized into catalog media', () => {
  const catalog = {
    libraries: [{
      lessons: [{
        topics: [{
          sections: [
            {
              type: 'image',
              url: 'https://example.com/diagram.png',
              alt: 'Diagram',
              caption: 'Example image',
              sourceUrl: 'https://example.com/source'
            },
            {
              type: 'video',
              url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
              title: 'Video'
            }
          ]
        }]
      }]
    }]
  };

  const normalized = prepareCatalogMedia(catalog);
  assert.equal(normalized.media.length, 2);
  assert.equal(normalized.media[0].type, 'image');
  assert.equal(normalized.media[1].type, 'video');
  assert.ok(normalized.libraries[0].lessons[0].topics[0].sections[0].mediaRef);
  assert.ok(normalized.libraries[0].lessons[0].topics[0].sections[1].mediaRef);
  assert.equal(normalized.libraries[0].lessons[0].topics[0].sections[0].url, undefined);
});

test('gallery URLs become reusable media references', () => {
  const catalog = {
    libraries: [{
      lessons: [{
        topics: [{
          sections: [{
            type: 'gallery',
            items: [
              'https://example.com/a.png',
              { type: 'image', url: 'https://example.com/b.jpg', alt: 'B' }
            ]
          }]
        }]
      }]
    }]
  };

  const normalized = prepareCatalogMedia(catalog);
  const items = normalized.libraries[0].lessons[0].topics[0].sections[0].items;
  assert.equal(normalized.media.length, 2);
  assert.equal(items.length, 2);
  assert.ok(items.every(item => typeof item === 'string' && !item.startsWith('https://')));
});

test('media helpers detect supported providers safely', () => {
  const youtube = 'https://youtu.be/dQw4w9WgXcQ';
  assert.equal(detectMediaType('https://example.com/x.webp'), 'image');
  assert.equal(detectMediaType(youtube), 'video');
  assert.equal(detectVideoProvider(youtube), 'youtube');
  assert.equal(videoEmbedUrl(youtube), 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
  assert.equal(mediaAssetId('image', 'https://example.com/x.png'), mediaAssetId('image', 'https://example.com/x.png'));
});
