// @baka-provider 2
'use strict';

const PROVIDER_ID = 'org.hebijunge.qishui';
const SOURCE_ID = 'qishui.v1';
const SOURCE_SNAPSHOT = '2026-11-28-public-catalog';
const API_BASE = 'https://api.qishui.com';
const SEO_BASE = 'https://beta-luna.douyin.com';
const SHARE_BASE = 'https://music.douyin.com';
const KUWO_SEARCH_BASE = 'https://search.kuwo.cn';
const KUWO_MEDIA_BASE = 'https://nmobi.kuwo.cn';
const NETEASE_BASE = 'https://music.163.com';
const NETEASE_IKUN_BASE = 'https://c.wwwweb.top';
const NETEASE_ZDDYR_BASE = 'https://yy.zddyr.top';
const NETEASE_HAITANG_BASE = 'https://musicapi.haitangw.net';
const NETEASE_NIANXIN_BASE = 'https://mcp.nianxinxz.com';
const NETEASE_RELAY_TIMEOUT_MS = 12000;
const NETEASE_PROBE_TIMEOUT_MS = 10000;
const CURSOR_PREFIX = 'qsv1.';
const MAX_CURSOR_BYTES = 2048;

const PUBLIC_QUERY = {
  aid: '386088',
  app_name: 'luna_pc',
  device_platform: 'web',
  channel: 'pc_web',
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

const CHART_DEFS = [
  { id: '7036274230471712007', title: '热歌榜', group: '汽水音乐' },
  { id: '7060812597884869927', title: '新歌榜', group: '汽水音乐' },
  { id: '7061475546400005410', title: '欧美榜', group: '汽水音乐' },
  { id: '7415959718721494311', title: '音乐人歌曲榜', group: '汽水音乐' },
  { id: 'dy-hot', title: '抖音热歌榜', group: '抖音音乐', special: 'hot-content' },
];

const PLAYLIST_TAGS = [
  { id: '0', name: '推荐' },
  { id: '14', name: '流行' },
  { id: '8', name: '华语' },
  { id: '9', name: '欧美' },
  { id: '20', name: '国风' },
  { id: '16', name: '电子' },
];

const manifest = {
  apiVersion: 2,
  kind: 'provider',
  id: PROVIDER_ID,
  sourceId: SOURCE_ID,
  name: '汽水音乐',
  author: 'hebijunge',
  version: '1.0.0',
  description: '汽水音乐公开目录与播放提供方；搜索仅覆盖有界榜单、热歌和推荐歌单，不是全库搜索。',
  capabilities: [
    'search',
    'entities.get',
    'collections.get',
    'collections.members',
    'discovery.charts',
    'discovery.playlistTags',
    'discovery.playlists',
    'media.resolve',
    'lyrics.get',
    'comments.list',
    'links.resolve',
    'links.share',
  ],
  supportedSearchType: ['music', 'sheet', 'album', 'artist'],
  supportedQualities: ['128k', '320k'],
  hints: {
    search: [
      '公开搜索接口当前返回空内容；此处只过滤有界公开目录，不能视为全库搜索。',
      '可搜索 music/sheet/album/artist；album/artist 来自目录曲目的内嵌元数据。',
    ],
    'media.resolve': [
      '仅支持 128k 与 320k；medium/higher 映射为 128k，highest 映射为 320k。',
      '公开接口没有 lossless/hires；192k、flac 等质量会直接返回 quality_unavailable。',
      '汽水 H5→SEO→分享页均失败或仅返回 VIP 试听后，才启动酷我（立即）与网易云（250ms）同曲兜底竞速。',
      'VIP 公开流若只有 29–60 秒试听，将通过时长或 size/bitrate 校验拒收；任何试听、片段或降档均不交付。',
      '酷我、网易云兜底要求标题归一后相等、歌手集合相交且时长误差不超过 10%；仅 Live/现场等版本标签在另一侧专辑明确为现场语境时允许匹配。',
      '网易云仅使用官方搜索；播放取链由 ikun→星海→海棠→念心第三方接口串行接力，逐接口独立超时、失败即续接。',
      '第三方 320k 若实返 128k/192k 或整曲体积不符合档位，将返回 quality_unavailable；flac 分支虽保留，但当前能力不开放。',
    ],
    'lyrics.get': [
      'SEO 通道返回 LRC 或明文 KRC/QRC 文本；分享页 SSR sentences 会转换为 LRC。',
      '未实现加密 KRC 包解密。',
    ],
    'comments.list': ['仅读取公开评论第一页及后续游标；不声明回复树能力。'],
    'links.resolve': ['支持汽水歌曲分享链接和 qishui.douyin.com/s/<id> 歌单链接。'],
  },
};

function str(value) {
  return value === undefined || value === null ? '' : String(value);
}

function num(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function asObject(value) {
  return isObject(value) ? value : {};
}

function firstValue(...values) {
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== undefined && values[i] !== null && values[i] !== '') return values[i];
  }
  return undefined;
}

function getAny(object, keys) {
  if (!isObject(object)) return undefined;
  for (let i = 0; i < keys.length; i++) {
    if (object[keys[i]] !== undefined && object[keys[i]] !== null) return object[keys[i]];
  }
  const lower = {};
  Object.keys(object).forEach((key) => { lower[key.toLowerCase()] = object[key]; });
  for (let j = 0; j < keys.length; j++) {
    const value = lower[keys[j].toLowerCase()];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function parseMaybeJson(value) {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch (_error) { return null; }
}

function makeError(code, message) {
  return Object.assign(new Error(message), { code });
}

function errorPriority(error) {
  const order = ['rate_limited', 'quality_unavailable', 'temporary_unavailable', 'authentication_required', 'permission_denied', 'track_unavailable'];
  const index = order.indexOf(error && error.code);
  return index === -1 ? order.length : index;
}

function preferredError(errors) {
  let selected = null;
  for (let i = 0; i < errors.length; i++) {
    const error = errors[i];
    if (!error) continue;
    if (!selected || errorPriority(error) < errorPriority(selected)) selected = error;
  }
  return selected;
}

function statusError(status) {
  if (status === 401) return makeError('authentication_required', '接口要求有效认证');
  if (status === 403) return makeError('permission_denied', '接口拒绝当前请求');
  if (status === 429) return makeError('rate_limited', '接口请求过于频繁（HTTP 429）');
  if (status >= 500) return makeError('temporary_unavailable', '服务暂时不可用（HTTP ' + status + '）');
  return new Error('接口请求失败：HTTP ' + status);
}

function checkedBody(response) {
  if (!response || response.status < 200 || response.status >= 300) {
    throw statusError(response ? response.status : 0);
  }
  return response.body;
}

async function getJson(sdk, url, headers, timeoutMs) {
  const response = await sdk.http.request({
    url,
    method: 'GET',
    headers: Object.assign({}, HEADERS, headers || {}),
    responseType: 'json',
    timeoutMs: timeoutMs || 12000,
  });
  return checkedBody(response);
}

async function getText(sdk, url, headers, timeoutMs) {
  const response = await sdk.http.request({
    url,
    method: 'GET',
    headers: Object.assign({}, HEADERS, headers || {}),
    responseType: 'text',
    timeoutMs: timeoutMs || 12000,
  });
  return checkedBody(response);
}

async function postJson(sdk, url, payload, headers, timeoutMs) {
  const response = await sdk.http.request({
    url,
    method: 'POST',
    headers: Object.assign({}, HEADERS, { 'Content-Type': 'application/json' }, headers || {}),
    body: JSON.stringify(payload),
    responseType: 'json',
    timeoutMs: timeoutMs || 12000,
  });
  return checkedBody(response);
}

async function getBinary(sdk, url, headers, timeoutMs) {
  const response = await sdk.http.request({
    url,
    method: 'GET',
    headers: Object.assign({}, HEADERS, headers || {}),
    responseType: 'arraybuffer',
    timeoutMs: timeoutMs || 12000,
  });
  return { status: response.status, headers: response.headers || {}, body: checkedBody(response) };
}

function headerValue(headers, name) {
  const wanted = String(name).toLowerCase();
  const keys = Object.keys(asObject(headers));
  for (let i = 0; i < keys.length; i++) {
    if (keys[i].toLowerCase() === wanted) return headers[keys[i]];
  }
  return undefined;
}

function binaryBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') return new Uint8Array(value);
  if (value && typeof value.buffer !== 'undefined' && typeof value.byteLength === 'number') {
    return new Uint8Array(value.buffer, value.byteOffset || 0, value.byteLength);
  }
  if (Array.isArray(value)) return Uint8Array.from(value);
  return null;
}

function buildUrl(base, pathname, query) {
  const url = new URL(pathname, base);
  Object.keys(query || {}).forEach((key) => {
    if (query[key] !== undefined && query[key] !== null && query[key] !== '') {
      url.searchParams.set(key, String(query[key]));
    }
  });
  return url.href;
}

function httpUrl(value) {
  let text = str(value).trim();
  if (!text) return '';
  if (text.indexOf('//') === 0) text = 'https:' + text;
  try {
    const url = new URL(text);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return text;
  } catch (_error) {
    return '';
  }
}

function byteSizeValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)?\s*$/i.exec(str(value));
  if (!match) return 0;
  const unit = str(match[2] || 'B').toUpperCase();
  const scale = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 }[unit];
  return Math.round(Number(match[1]) * scale);
}

function coverUrl(value) {
  if (!value) return '';
  if (typeof value === 'string') return httpUrl(value);
  const object = asObject(value);
  const urls = Array.isArray(object.urls) ? object.urls : [];
  const base = httpUrl(firstValue(object.url, object.base, urls[0]));
  const uri = str(firstValue(object.uri, object.path));
  if (base && uri) return base.replace(/\/$/, '') + '/' + uri.replace(/^\//, '');
  return base;
}

function artistNames(value) {
  if (!value) return [];
  if (typeof value === 'string') return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  const names = [];
  value.forEach((item) => {
    const name = str(firstValue(item && item.name, item && item.nickname, item && item.simple_display_name, item));
    if (name) names.push(name);
  });
  return names;
}

function artistDetails(value) {
  if (!Array.isArray(value)) return [];
  const details = [];
  value.forEach((item) => {
    const id = str(firstValue(item && item.id, item && item.artist_id, item && item.track_id));
    const name = str(firstValue(item && item.name, item && item.nickname, item && item.simple_display_name, item));
    if (id || name) details.push({ id, name });
  });
  return details;
}

function durationSeconds(value) {
  const parsed = num(value);
  if (parsed <= 0) return 0;
  return parsed > 10000 ? Math.round((parsed / 1000) * 1000) / 1000 : parsed;
}

function bitrateValue(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'number') return value;
  const match = /([0-9]+(?:\.[0-9]+)?)\s*([km]?)/i.exec(str(value));
  if (!match) return 0;
  const scale = match[2].toLowerCase() === 'k' ? 1000 : (match[2].toLowerCase() === 'm' ? 1000000 : 1);
  return Number(match[1]) * scale;
}

function sourceQuality(value) {
  const quality = str(value).toLowerCase();
  if (quality === 'medium' || quality === 'higher' || quality === '128k' || quality === 'standard') return '128k';
  if (quality === 'highest' || quality === '320k' || quality === 'high') return '320k';
  return '';
}

function qualitiesFromRates(rates) {
  const qualities = {};
  if (!Array.isArray(rates)) return qualities;
  rates.forEach((rate) => {
    const quality = sourceQuality(getAny(rate, ['quality', 'Quality', 'level', 'name']));
    if (quality) qualities[quality] = {};
  });
  return qualities;
}

function mapTrack(raw) {
  const object = asObject(raw);
  const wrapped = asObject(firstValue(object.track_wrapper && object.track_wrapper.track, object.track, object));
  const id = str(firstValue(wrapped.id, wrapped.track_id, wrapped.trackId, wrapped.songId, wrapped.song_id));
  if (!id) return null;
  const title = str(firstValue(wrapped.name, wrapped.title)) || '未知曲目';
  const artists = artistNames(firstValue(wrapped.artists, wrapped.artist, wrapped.artist_list));
  const album = asObject(wrapped.album);
  const albumId = str(firstValue(wrapped.album_id, wrapped.albumId, album.id, album.album_id));
  const albumTitle = str(firstValue(wrapped.album_name, album.name, album.title, typeof wrapped.album === 'string' ? wrapped.album : ''));
  const duration = durationSeconds(firstValue(wrapped.duration, wrapped.duration_ms, wrapped.durationMs));
  const artwork = coverUrl(firstValue(wrapped.cover, wrapped.artwork, album.url_cover, album.cover, album.pic_url));
  const details = artistDetails(firstValue(wrapped.artists, wrapped.artist_list));
  const entity = {
    id,
    type: 'music',
    title,
    artist: artists.join(' / '),
    album: albumTitle,
    artwork,
    duration,
    qualities: qualitiesFromRates(firstValue(wrapped.bit_rates, wrapped.bitrates, wrapped.rates)),
    providerData: { trackId: id, albumId, artistIds: details.map((item) => item.id).filter(Boolean), artistDetails: details, duration },
  };
  if (albumId) entity.albumId = albumId;
  return entity;
}

function mapPlaylist(raw) {
  const object = asObject(raw);
  const id = str(firstValue(object.id, object.playlist_id, object.playlistId));
  if (!id) return null;
  const owner = asObject(object.owner || object.creator);
  const count = num(firstValue(object.count_tracks, object.track_count, object.worksNum, object.resource_cnt && object.resource_cnt.track_cnt));
  return {
    id,
    type: 'sheet',
    title: str(firstValue(object.title, object.public_title, object.name)) || '未命名歌单',
    artist: str(firstValue(owner.nickname, owner.name, object.owner_name)),
    artwork: coverUrl(firstValue(object.url_cover, object.cover, object.artwork)),
    worksNum: count,
    providerData: { playlistId: id },
  };
}

function mapChart(definition, body) {
  const chart = asObject(firstValue(body && body.chart, body && body.data && body.data.chart, body));
  return {
    id: str(firstValue(definition && definition.id, chart.id, chart.chart_id)),
    type: 'chart',
    title: str(firstValue(definition && definition.title, chart.title, chart.name)) || '汽水榜单',
    artist: str(firstValue(definition && definition.group, chart.group)) || '汽水音乐',
    artwork: coverUrl(firstValue(definition && definition.cover, chart.url_cover, chart.cover)),
    providerData: {
      chartId: str(firstValue(definition && definition.id, chart.id, chart.chart_id)),
      special: str(firstValue(definition && definition.special, chart.special)),
    },
  };
}

function mapAlbum(trackEntity) {
  if (!trackEntity || !trackEntity.albumId) return null;
  return {
    id: trackEntity.albumId,
    type: 'album',
    title: trackEntity.album || '未命名专辑',
    artist: trackEntity.artist || '',
    artwork: trackEntity.artwork || '',
    providerData: { albumId: trackEntity.albumId },
  };
}

function limitOf(request) {
  const limit = request && request.limit !== undefined ? request.limit : 30;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error('limit 必须是 1–100 的整数');
  return limit;
}

function entityKey(entity) {
  if (!entity) return null;
  return { id: str(entity.id), type: str(entity.type || entity.kind) };
}

function cursorBinding(capability, request) {
  return JSON.stringify({
    capability,
    query: str(request && request.query).trim(),
    kind: str(request && request.kind),
    entity: entityKey(request && request.entity),
    tag: str(request && request.tag),
    sort: str(request && request.sort),
    context: request && request.context !== undefined ? request.context : null,
    account: 'public',
    source: SOURCE_SNAPSHOT,
  });
}

function encodeCursor(binding, state) {
  const cursor = CURSOR_PREFIX + encodeURIComponent(JSON.stringify({ v: 1, b: binding, s: state || {} }));
  if (cursor.length > MAX_CURSOR_BYTES) throw new Error('分页游标超过长度限制');
  return cursor;
}

function decodeCursor(cursor, capability, request) {
  if (cursor === undefined || cursor === null || cursor === '') return null;
  if (typeof cursor !== 'string' || cursor.indexOf(CURSOR_PREFIX) !== 0) throw new Error('无效的分页游标');
  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(cursor.slice(CURSOR_PREFIX.length)));
  } catch (_error) {
    throw new Error('无效的分页游标');
  }
  if (!payload || payload.v !== 1 || payload.b !== cursorBinding(capability, request) || !isObject(payload.s)) {
    throw new Error('分页游标与当前查询不匹配');
  }
  return payload.s;
}

function assertCursorProgress(nextCursor, currentCursor) {
  if (nextCursor === currentCursor) throw new Error('上游分页游标未前进');
}

function dedupeEntities(items) {
  const seen = Object.create(null);
  const result = [];
  (items || []).forEach((item) => {
    if (!item || item.id === undefined || item.id === null || item.id === '') return;
    const key = str(item.type) + ':' + str(item.id);
    if (seen[key]) return;
    seen[key] = true;
    result.push(item);
  });
  return result;
}

function pageFromLocal(items, state, capability, request, limit, total) {
  const offset = state ? num(state.offset) : 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > items.length) throw new Error('分页游标已失效');
  const selected = items.slice(offset, offset + limit);
  const end = offset + selected.length;
  const nextCursor = end < items.length ? encodeCursor(cursorBinding(capability, request), { offset: end }) : null;
  return { items: selected, nextCursor, total: total === undefined ? items.length : total };
}

function upstreamHasMore(body, nextCursor, currentCursor) {
  const explicit = getAny(body, ['has_more', 'hasMore']);
  if (explicit !== undefined) return explicit === true || num(explicit) === 1;
  return nextCursor !== undefined && nextCursor !== null && str(nextCursor) !== '' && str(nextCursor) !== str(currentCursor);
}

function pageFromUpstream(items, state, body, capability, request, limit, total) {
  const offset = state ? num(state.offset) : 0;
  if (!Number.isInteger(offset) || offset < 0) throw new Error('无效的分页游标');
  if (offset > items.length || (offset > 0 && offset === items.length)) throw new Error('分页游标已失效，请从第一页重试');
  const selected = items.slice(offset, offset + limit);
  const end = offset + selected.length;
  const currentCursor = state ? state.cursor : '0';
  const nextCursorValue = firstValue(body && body.next_cursor, body && body.nextCursor, body && body.cursor);
  const hasMore = upstreamHasMore(body, nextCursorValue, currentCursor);
  let nextCursor = null;
  if (end < items.length) {
    nextCursor = encodeCursor(cursorBinding(capability, request), { cursor: currentCursor, offset: end });
  } else if (hasMore) {
    if (nextCursorValue === undefined || nextCursorValue === null || str(nextCursorValue) === '') {
      throw new Error('上游声明有下一页但未提供游标');
    }
    if (str(nextCursorValue) === str(currentCursor)) throw new Error('上游分页游标未前进');
    nextCursor = encodeCursor(cursorBinding(capability, request), { cursor: str(nextCursorValue), offset: 0 });
  }
  if (nextCursor && nextCursor === request.cursor) throw new Error('分页游标未前进');
  const result = { items: selected, nextCursor };
  if (total !== undefined && Number.isInteger(total) && total >= 0) result.total = total;
  return result;
}

function extractChartTracks(body) {
  const chart = asObject(firstValue(body && body.chart, body && body.data && body.data.chart, body));
  const ranks = Array.isArray(chart.track_ranks) ? chart.track_ranks : [];
  return dedupeEntities(ranks.map((rank) => mapTrack(firstValue(rank && rank.track, rank && rank.track_wrapper, rank))).filter(Boolean));
}

function extractHotTracks(body) {
  const data = asObject(body && body.data);
  const list = firstValue(data.hotSongs, data.hot_songs, body && body.hotSongs, body && body.list);
  if (!Array.isArray(list)) return [];
  return dedupeEntities(list.map((item) => {
    const object = asObject(item);
    return mapTrack({
      id: firstValue(object.songId, object.song_id, object.trackId, object.id),
      name: firstValue(object.title, object.name),
      artists: firstValue(object.artists, object.artist),
      album: object.album,
      duration: object.duration,
      cover: firstValue(object.coverUrl, object.cover, object.artwork),
    });
  }).filter(Boolean));
}

function extractPlaylists(body) {
  const blocks = Array.isArray(body && body.inner_block) ? body.inner_block : [];
  const resources = [];
  blocks.forEach((block) => {
    const list = Array.isArray(block && block.resources) ? block.resources : [];
    list.forEach((resource) => resources.push(resource));
  });
  if (Array.isArray(body && body.playlists)) resources.push.apply(resources, body.playlists);
  return dedupeEntities(resources.map((resource) => {
    const entity = asObject(resource && resource.entity);
    return mapPlaylist(firstValue(entity.playlist, resource && resource.playlist, resource));
  }).filter(Boolean));
}

async function fetchChart(sdk, definition) {
  if (definition.special === 'hot-content') {
    return getJson(sdk, 'https://music.douyin.com/api/home/hot-content', { Referer: 'https://music.douyin.com/' });
  }
  const url = buildUrl(API_BASE, '/luna/pc/charts/' + encodeURIComponent(definition.id), PUBLIC_QUERY);
  return getJson(sdk, url, { Referer: 'https://api.qishui.com/' });
}

async function fetchMix(sdk, tagId, cursor) {
  const url = buildUrl(API_BASE, '/luna/pc/discover/mix', PUBLIC_QUERY);
  return postJson(sdk, url, {
    block_type: 'discover_playlist_mix',
    feed_discover_extra: {},
    latest_douyin_liked_playlist_show_ts: 0,
    sub_channel_id: Number(tagId) || 0,
    cursor,
  }, { Referer: 'https://api.qishui.com/' });
}

async function fetchPlaylist(sdk, playlistId, cursor, count) {
  const url = buildUrl(API_BASE, '/luna/playlist/detail', Object.assign({}, PUBLIC_QUERY, {
    playlist_id: playlistId,
    count: count || 100,
    cursor,
  }));
  return getJson(sdk, url, { Referer: 'https://api.qishui.com/' });
}

function normalizeSearch(value) {
  return str(value).toLowerCase().replace(/\s+/g, '');
}

function entityMatches(entity, query) {
  const needle = normalizeSearch(query);
  if (!needle) return false;
  const haystack = normalizeSearch([
    entity.title,
    entity.name,
    entity.artist,
    entity.album,
    entity.description,
  ].join(' '));
  return haystack.indexOf(needle) !== -1;
}

async function loadSearchCatalog(sdk, kind, query) {
  const tracks = [];
  const sheets = [];
  const jobs = [];
  let failures = 0;

  if (kind !== 'sheet') {
    CHART_DEFS.forEach((definition) => {
      jobs.push(fetchChart(sdk, definition).then((body) => ({
        kind: 'tracks',
        items: definition.special === 'hot-content' ? extractHotTracks(body) : extractChartTracks(body),
      })));
    });
  }
  if (kind === 'music' || kind === 'sheet') {
    jobs.push(fetchMix(sdk, '0', '0').then((body) => ({ kind: 'sheets', items: extractPlaylists(body) })));
  }

  const settled = await Promise.all(jobs.map((job) => job.then(
    (value) => ({ ok: true, value }),
    (error) => {
      failures++;
      if (sdk.log && typeof sdk.log.warn === 'function') sdk.log.warn('公开目录来源失败', String(error && error.code || 'request_failed'));
      return { ok: false };
    },
  )));
  const successes = settled.filter((item) => item.ok).length;
  if (successes === 0) {
    throw makeError('temporary_unavailable', '公开目录暂不可用' + (failures ? '（' + failures + ' 个来源失败）' : ''));
  }
  settled.forEach((item) => {
    if (!item.ok) return;
    if (item.value.kind === 'tracks') tracks.push.apply(tracks, item.value.items);
    else sheets.push.apply(sheets, item.value.items);
  });

  const entities = [];
  if (kind === 'music') entities.push.apply(entities, tracks);
  if (kind === 'sheet') entities.push.apply(entities, sheets);
  if (kind === 'album') {
    tracks.forEach((trackEntity) => {
      const album = mapAlbum(trackEntity);
      if (album) entities.push(album);
    });
  }
  if (kind === 'artist') {
    tracks.forEach((trackEntity) => {
      const details = trackEntity.providerData && trackEntity.providerData.artistDetails || [];
      details.forEach((artist) => {
        if (!artist.id) return;
        entities.push({
          id: artist.id,
          type: 'artist',
          title: artist.name || '未知音乐人',
          name: artist.name || '未知音乐人',
          providerData: { artistId: artist.id },
        });
      });
    });
  }
  return dedupeEntities(entities.filter((entity) => entity.type === kind && entityMatches(entity, query)));
}

async function search(request, sdk) {
  const query = str(request && request.query).trim();
  const kind = str(request && request.kind || 'music');
  if (['music', 'sheet', 'album', 'artist'].indexOf(kind) === -1) throw new Error('不支持的搜索类型');
  const limit = limitOf(request);
  const state = decodeCursor(request && request.cursor, 'search', request);
  if (!query) return { items: [], nextCursor: null, total: 0 };
  if (query.length > 200) throw new Error('搜索词过长');
  const items = await loadSearchCatalog(sdk, kind, query);
  return pageFromLocal(items, state, 'search', request, limit);
}

async function entitiesGet(request, sdk) {
  const entity = request && request.entity;
  if (!entity || entity.id === undefined || entity.id === null || str(entity.id) === '') throw new Error('缺少实体');
  const type = str(entity.type || entity.kind);
  if (type === 'sheet' || type === 'chart') return collectionsGet(request, sdk);
  if (type !== 'music') return null;
  const trackId = str(firstValue(entity.providerData && entity.providerData.trackId, entity.id));
  let firstError = null;
  try {
    const body = await fetchH5(sdk, trackId);
    const mapped = mapTrack(firstValue(body && body.track, body && body.data && body.data.track));
    if (mapped) return mapped;
  } catch (error) {
    firstError = error;
  }
  try {
    const body = await fetchSeo(sdk, trackId);
    const track = findFirstKey(body, 'track', 5);
    const mapped = mapTrack(track);
    if (mapped) return mapped;
  } catch (error) {
    if (!firstError) firstError = error;
  }
  if (firstError && (firstError.code === 'authentication_required' || firstError.code === 'permission_denied' || firstError.code === 'rate_limited' || firstError.code === 'temporary_unavailable')) {
    throw firstError;
  }
  return Object.assign({}, entity, { id: trackId, type: 'music', providerData: Object.assign({}, entity.providerData || {}, { trackId }) });
}

async function collectionsGet(request, sdk) {
  const entity = request && request.entity;
  if (!entity) throw new Error('缺少集合实体');
  const type = str(entity.type || entity.kind);
  if (type === 'sheet') {
    const playlistId = str(firstValue(entity.providerData && entity.providerData.playlistId, entity.id));
    const body = await fetchPlaylist(sdk, playlistId, '0', 1);
    const mapped = mapPlaylist(firstValue(body && body.playlist, body && body.data && body.data.playlist));
    return mapped || Object.assign({}, entity, { id: playlistId, type: 'sheet' });
  }
  if (type === 'chart') {
    const chartId = str(firstValue(entity.providerData && entity.providerData.chartId, entity.id));
    const definition = CHART_DEFS.find((item) => item.id === chartId) || { id: chartId, title: entity.title || '汽水榜单' };
    const body = await fetchChart(sdk, definition);
    return mapChart(definition, body);
  }
  return null;
}

async function collectionsMembers(request, sdk) {
  const entity = request && request.entity;
  if (!entity) throw new Error('缺少集合实体');
  const type = str(entity.type || entity.kind);
  const limit = limitOf(request);
  const memberKind = str(request && request.kind || 'music');
  if (memberKind !== 'music') throw new Error('该集合仅支持读取曲目成员');
  const state = decodeCursor(request && request.cursor, 'collections.members', request);
  if (type === 'sheet') {
    const playlistId = str(firstValue(entity.providerData && entity.providerData.playlistId, entity.id));
    const upstreamCursor = state ? str(state.cursor) : '0';
    const body = await fetchPlaylist(sdk, playlistId, upstreamCursor, 100);
    const resources = Array.isArray(body && body.media_resources) ? body.media_resources : [];
    const items = dedupeEntities(resources.map((resource) => {
      const wrapper = asObject(resource && resource.entity);
      return mapTrack(firstValue(wrapper.track_wrapper && wrapper.track_wrapper.track, wrapper.track, resource && resource.track));
    }).filter(Boolean));
    const total = num(firstValue(body && body.total, body && body.playlist && body.playlist.count_tracks));
    const page = pageFromUpstream(items, state, body, 'collections.members', request, limit, total > 0 ? total : undefined);
    const metadata = mapPlaylist(firstValue(body && body.playlist, entity));
    if (metadata) page.entity = metadata;
    return page;
  }
  if (type === 'chart') {
    const chartId = str(firstValue(entity.providerData && entity.providerData.chartId, entity.id));
    const definition = CHART_DEFS.find((item) => item.id === chartId) || { id: chartId, title: entity.title || '汽水榜单' };
    const body = await fetchChart(sdk, definition);
    const items = definition.special === 'hot-content' ? extractHotTracks(body) : extractChartTracks(body);
    return pageFromLocal(items, state, 'collections.members', request, limit);
  }
  throw new Error('该实体类型不支持成员读取');
}

function tagIdOf(tag) {
  const text = str(tag).trim();
  if (!text) return '0';
  const found = PLAYLIST_TAGS.find((item) => item.id === text || item.name === text);
  return found ? found.id : text;
}

async function discoveryCharts(request, sdk) {
  const limit = limitOf(request);
  const state = decodeCursor(request && request.cursor, 'discovery.charts', request);
  const tag = str(request && request.tag).trim();
  const items = CHART_DEFS.filter((definition) => !tag || definition.group === tag || definition.title === tag).map((definition) => mapChart(definition, {}));
  return pageFromLocal(items, state, 'discovery.charts', request, limit);
}

async function discoveryPlaylistTags(request, sdk) {
  const limit = limitOf(request);
  const state = decodeCursor(request && request.cursor, 'discovery.playlistTags', request);
  const items = PLAYLIST_TAGS.map((tag) => ({ id: tag.id, type: 'playlistTag', name: tag.name, title: tag.name }));
  return pageFromLocal(items, state, 'discovery.playlistTags', request, limit);
}

async function discoveryPlaylists(request, sdk) {
  const limit = limitOf(request);
  const state = decodeCursor(request && request.cursor, 'discovery.playlists', request);
  const upstreamCursor = state ? str(state.cursor) : '0';
  const body = await fetchMix(sdk, tagIdOf(request && request.tag), upstreamCursor);
  const items = extractPlaylists(body);
  return pageFromUpstream(items, state, body, 'discovery.playlists', request, limit);
}

function requestedQuality(value) {
  if (value === undefined || value === null || value === '') return '320k';
  const quality = str(value).toLowerCase();
  if (quality === '128k' || quality === 'medium' || quality === 'higher' || quality === 'standard') return '128k';
  if (quality === '320k' || quality === 'highest' || quality === 'high') return '320k';
  throw makeError('quality_unavailable', '汽水公开接口不支持该音质');
}

function mediaHeaders(referer) {
  return { Referer: referer || 'https://music.douyin.com/', 'User-Agent': HEADERS['User-Agent'] };
}

function isPreviewFlagged(raw) {
  const preview = getAny(raw, ['preview', 'is_preview', 'isPreview', 'trial', 'is_trial']);
  return preview === true || preview === 1 || str(preview).toLowerCase() === 'true';
}

function candidateFromRaw(raw, wantedQuality, expectedDuration, source) {
  const object = asObject(raw);
  const meta = asObject(firstValue(object.video_meta, object.videoMeta, object.media_meta, object.meta));
  const bitrate = bitrateValue(firstValue(meta.bitrate, meta.real_bitrate, object.bitrate, object.Bitrate, object.real_bitrate, object.realBitrate));
  let quality = sourceQuality(firstValue(meta.quality, object.quality, object.Quality, object.quality_type, object.qualityType));
  if (!quality && bitrate >= 200000) quality = '320k';
  else if (!quality && bitrate >= 100000) quality = '128k';
  if (!quality || quality !== wantedQuality) return null;
  if (getAny(object, ['encrypt_info', 'encryptInfo', 'spade_a', 'encrypted']) || getAny(meta, ['encrypt_info', 'encryptInfo', 'spade_a', 'encrypted'])) return null;
  if (isPreviewFlagged(object) || isPreviewFlagged(meta)) return null;
  const url = httpUrl(firstValue(object.main_url, object.mainUrl, object.backup_url, object.backupUrl, object.url, object.Url, object.play_url, object.playUrl));
  if (!url) return null;
  const size = num(firstValue(meta.size, object.size, object.Size, object.content_length, object.contentLength));
  const duration = durationSeconds(firstValue(meta.duration, object.duration, object.Duration, object.duration_ms, object.durationMs));
  const estimated = bitrate > 0 && size > 0 ? (size * 8) / bitrate : 0;
  const fullDuration = durationSeconds(expectedDuration);
  if (fullDuration > 0) {
    if (duration > 0 && duration < fullDuration * 0.9) return null;
    if (estimated > 0 && estimated < fullDuration * 0.9) return null;
    if (duration > 0 && estimated > 0 && (estimated / duration < 0.5 || estimated / duration > 2)) return null;
  } else if ((duration > 0 && duration <= 60) || (estimated > 0 && estimated <= 60)) {
    return null;
  }
  if (wantedQuality === '320k' && bitrate > 0 && bitrate < 200000) return null;
  return {
    url,
    quality,
    headers: mediaHeaders(source === 'h5' ? 'https://api.qishui.com/' : 'https://music.douyin.com/'),
    bitrate,
    size,
    duration,
    source,
  };
}

function selectCandidate(list, wantedQuality, expectedDuration, source) {
  let sawCandidate = false;
  let sawPreview = false;
  for (let i = 0; i < list.length; i++) {
    const raw = asObject(list[i]);
    const meta = asObject(firstValue(raw.video_meta, raw.videoMeta, raw.meta));
    const bitrate = bitrateValue(firstValue(meta.bitrate, meta.real_bitrate, raw.bitrate, raw.Bitrate, raw.real_bitrate));
    let quality = sourceQuality(firstValue(meta.quality, raw.quality, raw.Quality, raw.quality_type));
    if (!quality && bitrate >= 200000) quality = '320k';
    else if (!quality && bitrate >= 100000) quality = '128k';
    if (!quality) continue;
    sawCandidate = true;
    const duration = durationSeconds(firstValue(meta.duration, raw.duration, raw.Duration, raw.duration_ms));
    const size = num(firstValue(meta.size, raw.size, raw.Size));
    const estimated = bitrate > 0 && size > 0 ? (size * 8) / bitrate : 0;
    const fullDuration = durationSeconds(expectedDuration);
    if (isPreviewFlagged(raw) || isPreviewFlagged(meta) || (fullDuration > 0 && duration > 0 && duration < fullDuration * 0.9) || (fullDuration > 0 && estimated > 0 && estimated < fullDuration * 0.9) || (fullDuration === 0 && ((duration > 0 && duration <= 60) || (estimated > 0 && estimated <= 60)))) sawPreview = true;
    const candidate = candidateFromRaw(raw, wantedQuality, expectedDuration, source);
    if (candidate) return candidate;
  }
  if (sawCandidate && !sawPreview) throw makeError('quality_unavailable', '当前曲目没有可用的 ' + wantedQuality + ' 公开音质');
  throw makeError('track_unavailable', sawPreview ? '当前曲目仅提供试听或片段' : '当前曲目没有可用播放地址');
}

async function fetchH5(sdk, trackId) {
  const url = buildUrl(API_BASE, '/luna/h5/track', Object.assign({}, PUBLIC_QUERY, { track_id: trackId }));
  return getJson(sdk, url, { Referer: 'https://api.qishui.com/' });
}

async function fetchSeo(sdk, trackId) {
  const url = buildUrl(SEO_BASE, '/luna/h5/seo_track', { track_id: trackId, device_platform: 'web' });
  return getJson(sdk, url, { Referer: 'https://www.douyin.com/' });
}

function findFirstKey(value, key, maxDepth) {
  const limit = maxDepth || 6;
  function visit(node, depth) {
    if (!node || depth > limit) return undefined;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = visit(node[i], depth + 1);
        if (found !== undefined) return found;
      }
      return undefined;
    }
    if (!isObject(node)) return undefined;
    if (node[key] !== undefined) return node[key];
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const found = visit(node[keys[i]], depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  return visit(value, 0);
}

function seoPlaylist(body) {
  const direct = findFirstKey(body, 'PlayInfoList', 7);
  if (Array.isArray(direct)) return direct;
  const player = asObject(firstValue(body && body.track_player, body && body.data && body.data.track_player));
  const info = asObject(player.url_player_info);
  const result = asObject(info.Result);
  const data = asObject(result.Data);
  return Array.isArray(data.PlayInfoList) ? data.PlayInfoList : [];
}

function findDirectMediaUrl(value, depth, budget) {
  const state = { depth: depth || 0, budget: budget || { value: 500 } };
  function visit(node) {
    if (state.budget.value-- <= 0 || state.depth > 8 || !node) return '';
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        const found = visit(node[i]);
        if (found) return found;
      }
      return '';
    }
    if (!isObject(node)) return '';
    const keys = Object.keys(node);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i].toLowerCase();
      const child = node[keys[i]];
      if ((key === 'url' || key === 'main_url' || key === 'play_url' || key === 'backup_url') && typeof child === 'string') {
        const url = httpUrl(child);
        if (url && !/volcengineapi|getplayinfo/i.test(url)) return url;
      }
      const found = visit(child);
      if (found) return found;
    }
    return '';
  }
  return visit(value);
}

async function materializeSeoCandidate(sdk, raw) {
  const object = asObject(raw);
  const url = httpUrl(firstValue(object.Url, object.url, object.MainUrl, object.main_url, object.PlayUrl, object.play_url));
  if (!url || !/volcengineapi|getplayinfo/i.test(url)) return object;
  const body = await getJson(sdk, url, { Referer: 'https://www.douyin.com/' });
  const direct = findDirectMediaUrl(body);
  if (!direct) return object;
  return Object.assign({}, object, { Url: direct, url: direct });
}

async function resolveSeo(sdk, trackId, quality, expectedDuration, context) {
  const body = await fetchSeo(sdk, trackId);
  if (context.cancelled()) return null;
  const list = seoPlaylist(body);
  const expected = firstValue(expectedDuration, body && body.track && body.track.duration, body && body.data && body.data.track && body.data.track.duration);
  for (let i = 0; i < list.length; i++) {
    if (context.cancelled()) return null;
    const raw = await materializeSeoCandidate(sdk, list[i]);
    const candidate = candidateFromRaw(raw, quality, expected, 'seo');
    if (candidate) return candidate;
  }
  return selectCandidate([], quality, expected, 'seo');
}

function extractBalancedJson(text, marker) {
  const source = str(text);
  const markerIndex = marker ? source.indexOf(marker) : source.search(/[_$]ROUTER_DATA|__NEXT_DATA__/);
  if (markerIndex < 0) return null;
  const start = source.indexOf('{', markerIndex);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < source.length; i++) {
    const char = source[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return parseMaybeJson(source.slice(start, i + 1));
    }
  }
  return null;
}

function shareData(html) {
  const text = str(html);
  const router = extractBalancedJson(text, '_ROUTER_DATA');
  if (router) return router;
  const next = extractBalancedJson(text, '__NEXT_DATA__');
  if (next) return next;
  return extractBalancedJson(text, '');
}

function collectShareCandidates(value, depth, output, budget) {
  if (!value || depth > 9 || budget.value <= 0) return;
  if (Array.isArray(value)) {
    value.forEach((item) => collectShareCandidates(item, depth + 1, output, budget));
    return;
  }
  if (!isObject(value)) return;
  budget.value--;
  const url = httpUrl(firstValue(value.main_url, value.mainUrl, value.backup_url, value.url, value.play_url, value.playUrl, value.audio_url));
  if (url) output.push(value);
  Object.keys(value).forEach((key) => collectShareCandidates(value[key], depth + 1, output, budget));
}

async function resolveShare(sdk, trackId, quality, expectedDuration, context) {
  const url = buildUrl(SHARE_BASE, '/qishui/share/track', { track_id: trackId });
  const html = await getText(sdk, url, { Referer: 'https://music.douyin.com/', Accept: 'text/html,application/xhtml+xml' });
  if (context.cancelled()) return null;
  const data = shareData(html);
  const option = firstValue(findFirstKey(data, 'audioWithLyricsOption', 7), findFirstKey(data, 'audio_option', 7));
  const candidates = [];
  collectShareCandidates(option || data, 0, candidates, { value: 300 });
  const expected = firstValue(expectedDuration, option && option.duration, option && option.duration_ms);
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidateFromRaw(candidates[i], quality, expected, 'share');
    if (candidate) return candidate;
  }
  return selectCandidate([], quality, expected, 'share');
}

function normalizedTitle(value) {
  let text = str(value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
}

function hasLiveTitleLabel(value) {
  return /(?:^|[^a-z0-9])(?:live|concert)(?=$|[^a-z0-9])|现场|演唱会/i.test(str(value));
}

function titleWithoutLiveLabel(value) {
  let text = str(value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  text = text.replace(/[（(【\[][^）)】\]]*(?:live|concert|现场|演唱会)[^）)】\]]*[）)】\]]/gi, ' ');
  text = text.replace(/(?:^|[^a-z0-9])(?:live|concert)(?=$|[^a-z0-9])/gi, ' ');
  text = text.replace(/现场|演唱会/g, ' ');
  return normalizedTitle(text);
}

function hasLiveAlbumContext(value) {
  return /中国新歌声|歌手|演唱会|音乐节|晚会|典礼|演出|巡回|歌友会|音乐会|综艺|(?:^|[^a-z0-9])(?:live|concert)(?=$|[^a-z0-9])/i.test(str(value));
}

function titlesMatch(rawTitle, entity, rawAlbum) {
  const entityTitle = firstValue(entity && entity.title, entity && entity.name);
  if (normalizedTitle(rawTitle) === normalizedTitle(entityTitle)) return true;
  const rawLive = hasLiveTitleLabel(rawTitle);
  const entityLive = hasLiveTitleLabel(entityTitle);
  if (rawLive === entityLive) return false;
  const liveTitle = rawLive ? rawTitle : entityTitle;
  const plainTitle = rawLive ? entityTitle : rawTitle;
  const plainAlbum = rawLive ? entity && entity.album : rawAlbum;
  return hasLiveAlbumContext(plainAlbum) && titleWithoutLiveLabel(liveTitle) === normalizedTitle(plainTitle);
}

function splitArtists(value) {
  if (Array.isArray(value)) {
    const names = [];
    value.forEach((item) => names.push.apply(names, splitArtists(item && typeof item === 'object' ? firstValue(item.name, item.nickname) : item)));
    return names;
  }
  return str(value).split(/\s*(?:\/|\||、|&|;|,|，|；)\s*/).map((item) => item.trim()).filter(Boolean);
}

function expectedArtists(entity) {
  const providerData = asObject(entity && entity.providerData);
  const details = Array.isArray(providerData.artistDetails) ? providerData.artistDetails : [];
  const names = splitArtists(entity && entity.artist);
  details.forEach((item) => names.push.apply(names, splitArtists(item && item.name)));
  names.push.apply(names, splitArtists(providerData.artists));
  return names;
}

function normalizedArtists(value) {
  const result = [];
  splitArtists(value).forEach((name) => {
    const normalized = normalizedTitle(name);
    if (normalized) result.push(normalized);
  });
  return result;
}

function durationMatches(actual, expected) {
  const left = durationSeconds(actual);
  const right = durationSeconds(expected);
  return left > 0 && right > 0 && Math.abs(left - right) <= right * 0.1;
}

function strictTrackMatch(rawTitle, rawArtists, rawDuration, entity, rawAlbum) {
  if (!normalizedTitle(rawTitle) || !titlesMatch(rawTitle, entity, rawAlbum)) return false;
  const expected = normalizedArtists(expectedArtists(entity));
  const actual = normalizedArtists(rawArtists);
  if (!expected.length || !actual.length || !expected.some((name) => actual.indexOf(name) !== -1)) return false;
  return durationMatches(rawDuration, firstValue(entity && entity.duration, entity && entity.providerData && entity.providerData.duration));
}

function fallbackPreview(raw) {
  if (isPreviewFlagged(raw)) return true;
  const object = asObject(raw);
  const freeTrial = getAny(object, ['freeTrialInfo', 'free_trial_info', 'trialInfo', 'trial_info']);
  return isObject(freeTrial) || (!Array.isArray(freeTrial) && freeTrial !== undefined && freeTrial !== null && freeTrial !== '' && freeTrial !== false && freeTrial !== 0 && str(freeTrial).toLowerCase() !== 'false');
}

function bitrateQuality(bitrate) {
  if (bitrate >= 200000) return '320k';
  if (bitrate >= 190000) return '192k';
  if (bitrate >= 100000) return '128k';
  return '';
}

function kuwoBitrateBps(value) {
  const raw = num(value);
  if (raw <= 0) return 0;
  return raw <= 1000 ? raw * 1000 : raw;
}

function completeFallbackDuration(duration, bitrate, size, expectedDuration) {
  const actual = durationSeconds(duration);
  if (actual < 60 || !durationMatches(actual, expectedDuration)) return false;
  const estimated = bitrate > 0 && size > 0 ? (size * 8) / bitrate : 0;
  return !estimated || durationMatches(estimated, expectedDuration);
}

function kuwoSearchUrl(entity) {
  const artist = splitArtists(expectedArtists(entity)).join(' ');
  return buildUrl(KUWO_SEARCH_BASE, '/r.s', {
    all: str(firstValue(entity.title, entity.name)).trim() + (artist ? ' ' + artist : ''),
    ft: 'music', itemset: 'web', pn: 0, rn: 30, rformat: 'json', encoding: 'utf8', pcjson: 1,
    searchapi: 2, newver: 2, strategy: 2012, mobi: 1, vipver: 1, cluster: 0,
    issubtitle: 1, correct: 1, spPrivilege: 0, p2p: 1, notrace: 0, vermerge: 1,
  });
}

function kuwoSearchItems(body) {
  const object = asObject(parseMaybeJson(body));
  const list = firstValue(object.abslist, object.ABSLIST, object.list);
  return Array.isArray(list) ? list : [];
}

async function resolveKuwoFallback(sdk, entity, quality, context) {
  const body = await getJson(sdk, kuwoSearchUrl(entity), { Referer: 'https://www.kuwo.cn/' });
  if (context.cancelled()) return null;
  const items = kuwoSearchItems(body);
  let matched = false;
  let qualityFailure = false;
  for (let i = 0; i < items.length; i++) {
    if (context.cancelled()) return null;
    const item = asObject(items[i]);
    const title = firstValue(item.NAME, item.SONGNAME, item.name, item.title);
    const artists = firstValue(item.ARTIST, item.artist, item.artists);
    const album = firstValue(item.ALBUM, item.album, item.albumName);
    const searchDuration = durationSeconds(firstValue(item.DURATION, item.duration, item.duration_ms));
    if (!strictTrackMatch(title, artists, searchDuration, entity, album)) continue;
    const rid = str(firstValue(item.MUSICRID, item.RID, item.rid, item.id)).replace(/^MUSIC_/, '');
    if (!rid) continue;
    matched = true;
    const url = buildUrl(KUWO_MEDIA_BASE, '/mobi.s', {
      f: 'web', type: 'convert_url_with_sign', br: quality === '320k' ? '320kmp3' : '128kmp3', rid,
      user: 0, android_id: 0, prod: 'kwplayerhd_ar_4.3.0.8', corp: 'kuwo',
      vipver: '4.3.0.8', source: 'kwplayerhd_ar_4.3.0.8_tianbao_T1A_qirui.apk',
      notrace: 0, sig: 0, priority: 'bitrate', loginUid: 0, network: 'WIFI', loginSid: 0, mode: 'down',
    });
    const media = await getJson(sdk, url, { Referer: 'https://www.kuwo.cn/' });
    if (context.cancelled()) return null;
    const data = asObject(media && media.data);
    if (num(media && media.code) !== 200 || !httpUrl(data.url)) continue;
    const format = str(data.format).toLowerCase();
    const bitrate = kuwoBitrateBps(data.bitrate);
    const actualQuality = bitrateQuality(bitrate);
    if (format !== 'mp3' || !actualQuality || (quality === '320k' && actualQuality !== '320k') || actualQuality === '192k') {
      qualityFailure = true;
      continue;
    }
    const size = byteSizeValue(firstValue(data.size, data.Size));
    if (fallbackPreview(data) || fallbackPreview(media) || !completeFallbackDuration(data.duration, bitrate, size, firstValue(entity.duration, entity.providerData && entity.providerData.duration))) continue;
    return {
      url: httpUrl(data.url), quality: actualQuality, headers: mediaHeaders('https://www.kuwo.cn/'),
      bitrate, size, duration: durationSeconds(data.duration), source: 'kuwo',
    };
  }
  if (matched && qualityFailure) throw makeError('quality_unavailable', '酷我同曲结果没有可用的 ' + quality + ' 整曲音质');
  throw makeError('track_unavailable', matched ? '酷我同曲结果仅提供试听或片段' : '酷我没有严格匹配的同曲整曲');
}

function neteaseSearchUrl(entity) {
  const artist = splitArtists(expectedArtists(entity)).join(' ');
  return buildUrl(NETEASE_BASE, '/api/search/get', {
    s: str(firstValue(entity.title, entity.name)).trim() + (artist ? ' ' + artist : ''),
    type: 1, limit: 30, offset: 0,
  });
}

function neteaseRelayQuality(value) {
  const quality = str(value).toLowerCase();
  return quality === '128k' || quality === '320k' || quality === 'flac' ? quality : '';
}

function neteaseBitrateBps(value) {
  const bitrate = bitrateValue(value);
  return bitrate > 0 && bitrate <= 1000 ? bitrate * 1000 : bitrate;
}

function neteaseNominalBitrate(quality) {
  if (quality === '320k') return 320000;
  if (quality === 'flac') return 700000;
  return 128000;
}

function neteaseRelayResponseError(source, body) {
  const code = num(body && body.code);
  if (code === 429) return makeError('rate_limited', source + ' 返回限流响应（code=429）');
  return makeError('track_unavailable', source + ' 未返回可用播放地址（code=' + (code || 'unknown') + '）');
}

async function probeNeteaseMedia(sdk, url) {
  const result = await getBinary(sdk, url, {
    Range: 'bytes=0-63',
    Accept: '*/*',
    Referer: 'https://music.163.com/',
  }, NETEASE_PROBE_TIMEOUT_MS);
  const bytes = binaryBytes(result.body);
  const contentType = str(headerValue(result.headers, 'content-type'));
  if (/text\/html|application\/json/i.test(contentType)) {
    throw makeError('track_unavailable', '网易云第三方媒体探测返回文本页面');
  }
  const contentRange = str(headerValue(result.headers, 'content-range'));
  const rangeMatch = /\/\s*(\d+)\s*$/.exec(contentRange);
  const contentLength = num(headerValue(result.headers, 'content-length'));
  const total = rangeMatch ? num(rangeMatch[1]) : (result.status === 200 ? contentLength : 0);
  return {
    status: result.status,
    total,
    isFlac: !!(bytes && bytes.length >= 4 && bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43),
  };
}

async function validateNeteaseRelayCandidate(sdk, raw, responseBody, wantedQuality, actualQuality, expectedDuration, context, source) {
  if (context.cancelled()) return null;
  const url = httpUrl(raw && raw.url);
  if (!url) throw neteaseRelayResponseError(source, responseBody);
  if (fallbackPreview(raw) || fallbackPreview(responseBody)) {
    throw makeError('track_unavailable', source + ' 仅返回试听或片段');
  }
  if (!actualQuality || actualQuality === '192k') {
    throw makeError('quality_unavailable', source + ' 返回未确认的 192k 音质');
  }
  if (wantedQuality === '320k' && actualQuality !== '320k') {
    throw makeError('quality_unavailable', source + ' 将 320k 请求降档为 ' + actualQuality);
  }
  if (wantedQuality === 'flac' && actualQuality !== 'flac') {
    throw makeError('quality_unavailable', source + ' 未返回 flac 音质');
  }
  if (wantedQuality !== 'flac' && actualQuality === 'flac') {
    throw makeError('quality_unavailable', source + ' 返回当前 Baka 能力不开放的 flac 音质');
  }

  const probe = await probeNeteaseMedia(sdk, url);
  if (context.cancelled()) return null;
  if ((wantedQuality === 'flac' || actualQuality === 'flac') && !probe.isFlac) {
    throw makeError('quality_unavailable', source + ' 的 flac 媒体未通过 fLaC 魔数校验');
  }
  if (actualQuality !== 'flac' && probe.isFlac) {
    throw makeError('quality_unavailable', source + ' 的有损档实际返回 fLaC 媒体');
  }

  let bitrate = neteaseBitrateBps(firstValue(raw.br, raw.bitrate));
  if (!bitrate) bitrate = neteaseNominalBitrate(actualQuality);
  let size = byteSizeValue(raw && raw.size);
  if (!size) size = num(probe.total);
  let duration = durationSeconds(firstValue(raw.duration, raw.time));
  if (!duration && size > 0 && bitrate > 0) duration = (size * 8) / bitrate;
  if (!size && duration > 0 && bitrate > 0) size = Math.round((duration * bitrate) / 8);
  if (!duration || !size) {
    throw makeError('track_unavailable', source + ' 缺少可验证的整曲时长或体积');
  }

  const measuredBitrate = (size * 8) / duration;
  const expectedAverageBitrate = expectedDuration > 0 ? (size * 8) / expectedDuration : 0;
  if (wantedQuality === '320k' && ((measuredBitrate > 0 && measuredBitrate < 200000) || (expectedAverageBitrate > 0 && expectedAverageBitrate < 200000))) {
    throw makeError('quality_unavailable', source + ' 的 320k 媒体体积符合低档或试听');
  }
  if (actualQuality === '320k' && measuredBitrate > 0 && measuredBitrate < 200000) {
    throw makeError('quality_unavailable', source + ' 的 320k 声明与实际码率不符');
  }
  if (wantedQuality === '128k' && expectedAverageBitrate >= 700000) {
    throw makeError('quality_unavailable', source + ' 的 128k 请求实际返回无损体积');
  }
  if (!completeFallbackDuration(duration, bitrate, size, expectedDuration)) {
    throw makeError('track_unavailable', source + ' 仅返回试听、片段或时长不完整');
  }

  return {
    url,
    quality: actualQuality,
    headers: mediaHeaders('https://music.163.com/'),
    bitrate: measuredBitrate || bitrate,
    size,
    duration,
    source: 'netease',
    relay: source,
  };
}

async function resolveNeteaseIkunRelay(sdk, id, quality, expectedDuration, context) {
  const body = await postJson(sdk, NETEASE_IKUN_BASE + '/music/url', {
    source: 'wy', musicId: id, quality,
  }, { Referer: 'https://c.wwwweb.top/' }, NETEASE_RELAY_TIMEOUT_MS);
  if (context.cancelled()) return null;
  if (num(body && body.code) !== 200) throw neteaseRelayResponseError('ikun', body);
  const actualQuality = neteaseRelayQuality(body && body.quality);
  if (!actualQuality) throw makeError('quality_unavailable', 'ikun 未返回可确认的音质');
  return validateNeteaseRelayCandidate(sdk, body, body, quality, actualQuality, expectedDuration, context, 'ikun');
}

async function resolveNeteaseZddyrRelay(sdk, id, quality, expectedDuration, context) {
  const url = buildUrl(NETEASE_ZDDYR_BASE, '/lx/api/', { source: 'netease', songmid: id, quality });
  const body = await getJson(sdk, url, { Referer: 'https://yy.zddyr.top/' }, NETEASE_RELAY_TIMEOUT_MS);
  if (context.cancelled()) return null;
  if (num(body && body.code) !== 200) throw neteaseRelayResponseError('星海', body);
  const bitrate = neteaseBitrateBps(body && body.br);
  if (!bitrate) throw makeError('quality_unavailable', '星海未返回可确认的实际码率');
  if (quality === 'flac' && bitrate < 700000) {
    throw makeError('quality_unavailable', '星海 flac 响应码率低于 700000');
  }
  const actualQuality = bitrate >= 700000 ? 'flac' : bitrateQuality(bitrate);
  return validateNeteaseRelayCandidate(sdk, body, body, quality, actualQuality, expectedDuration, context, '星海');
}

async function resolveNeteaseHaitangRelay(sdk, id, quality, expectedDuration, context) {
  const level = quality === '320k' ? 'exhigh' : (quality === 'flac' ? 'lossless' : 'standard');
  const url = buildUrl(NETEASE_HAITANG_BASE, '/music/wy_song_kw.php', { type: 'json', level, id });
  const body = await getJson(sdk, url, { Referer: 'https://musicapi.haitangw.net/' }, NETEASE_RELAY_TIMEOUT_MS);
  if (context.cancelled()) return null;
  if (num(body && body.code) !== 200) throw neteaseRelayResponseError('海棠', body);
  const data = asObject(body && body.data);
  return validateNeteaseRelayCandidate(sdk, data, body, quality, quality, expectedDuration, context, '海棠');
}

async function resolveNeteaseNianxinRelay(sdk, id, quality, expectedDuration, context) {
  const level = quality === '320k' ? 'exhigh' : (quality === 'flac' ? 'lossless' : 'standard');
  const url = buildUrl(NETEASE_NIANXIN_BASE, '/share/ceshi/wy.php', { level, id });
  const body = await getJson(sdk, url, { Referer: 'https://mcp.nianxinxz.com/' }, NETEASE_RELAY_TIMEOUT_MS);
  if (context.cancelled()) return null;
  if (num(body && body.code) !== 200) throw neteaseRelayResponseError('念心', body);
  return validateNeteaseRelayCandidate(sdk, body, body, quality, quality, expectedDuration, context, '念心');
}

async function resolveNeteaseRelayChain(sdk, id, quality, expectedDuration, context) {
  const relays = [
    { name: 'ikun', run: resolveNeteaseIkunRelay },
    { name: '星海', run: resolveNeteaseZddyrRelay },
    { name: '海棠', run: resolveNeteaseHaitangRelay },
    { name: '念心', run: resolveNeteaseNianxinRelay },
  ];
  const errors = [];
  for (let i = 0; i < relays.length; i++) {
    if (context.cancelled()) return null;
    const relay = relays[i];
    try {
      const candidate = await relay.run(sdk, id, quality, expectedDuration, context);
      if (candidate) return candidate;
    } catch (error) {
      const failure = error && error.code ? error : makeError('request_failed', String(error && error.message || error));
      failure.message = relay.name + '：' + failure.message;
      errors.push(failure);
    }
  }
  const selected = preferredError(errors);
  const hasTrackFailure = errors.some((error) => error && error.code === 'track_unavailable');
  const code = selected && selected.code === 'quality_unavailable' ? 'quality_unavailable'
    : selected && selected.code === 'rate_limited' ? 'rate_limited'
      : hasTrackFailure ? 'track_unavailable' : 'temporary_unavailable';
  const message = code === 'quality_unavailable' ? '网易云第三方同曲结果没有可用的 ' + quality + ' 整曲音质'
    : code === 'rate_limited' ? '网易云第三方取链被限流'
      : code === 'track_unavailable' ? '网易云第三方同曲结果仅提供试听、片段或无效媒体'
        : '网易云第三方取链暂时不可用';
  const detail = errors.map((error) => error.message).join('；');
  throw makeError(code, message + (detail ? '（' + detail + '）' : ''));
}

async function resolveNeteaseFallback(sdk, entity, quality, context) {
  const body = await getJson(sdk, neteaseSearchUrl(entity), { Referer: 'https://music.163.com/' });
  if (context.cancelled()) return null;
  const result = asObject(body && body.result);
  const songs = Array.isArray(result.songs) ? result.songs : [];
  const errors = [];
  for (let i = 0; i < songs.length; i++) {
    if (context.cancelled()) return null;
    const song = asObject(songs[i]);
    const artists = Array.isArray(song.artists) ? song.artists : song.artist;
    const album = asObject(song.album);
    if (!strictTrackMatch(song.name, artists, song.duration, entity, firstValue(album.name, album.title))) continue;
    const id = str(firstValue(song.id, song.songId));
    if (!id) continue;
    try {
      const candidate = await resolveNeteaseRelayChain(sdk, id, quality, firstValue(entity.duration, entity.providerData && entity.providerData.duration), context);
      if (candidate) return candidate;
    } catch (error) {
      errors.push(error);
    }
  }
  if (context.cancelled()) return null;
  if (errors.length) {
    const selected = preferredError(errors);
    selected.message = '网易云同曲兜底失败：' + selected.message;
    throw selected;
  }
  throw makeError('track_unavailable', '网易云没有严格匹配的同曲整曲');
}

function racePriority(tasks) {
  return new Promise((resolve, reject) => {
    const state = { generation: 0, settled: false };
    const errors = [];
    let active = 0;
    let nextIndex = 0;
    let nextTimer = null;
    let winner = null;

    const clearNextTimer = () => {
      if (nextTimer !== null) {
        clearTimeout(nextTimer);
        nextTimer = null;
      }
    };
    const finishIfReady = () => {
      if (active !== 0) return;
      clearNextTimer();
      if (state.settled) resolve(winner);
      else if (nextIndex >= tasks.length) {
        reject(preferredError(errors) || new Error('所有播放通道均失败'));
      }
    };
    const launch = (index) => {
      if (state.settled || index !== nextIndex || index >= tasks.length) return;
      const task = tasks[index];
      const generation = state.generation;
      nextIndex++;
      active++;
      const context = { cancelled: () => state.settled || state.generation !== generation };
      armNext(true);
      Promise.resolve().then(() => task.run(context)).then((value) => {
        active--;
        if (!state.settled) {
          if (value !== null && value !== undefined) {
            state.settled = true;
            state.generation++;
            winner = value;
            clearNextTimer();
          } else {
            errors.push(makeError('track_unavailable', '播放通道未返回结果'));
          }
        }
        if (!state.settled && active === 0 && nextIndex < tasks.length) {
          clearNextTimer();
          launch(nextIndex);
        }
        finishIfReady();
      }, (error) => {
        active--;
        if (!state.settled) errors.push(error || new Error('播放通道失败'));
        if (!state.settled && active === 0 && nextIndex < tasks.length) {
          clearNextTimer();
          launch(nextIndex);
        }
        finishIfReady();
      });
    };
    const armNext = (honorDelay) => {
      if (state.settled || nextIndex >= tasks.length) {
        finishIfReady();
        return;
      }
      const delay = honorDelay ? Math.max(0, num(tasks[nextIndex].delay)) : 0;
      if (delay === 0) launch(nextIndex);
      else nextTimer = setTimeout(() => { nextTimer = null; launch(nextIndex); }, delay);
    };

    armNext(true);
  });
}

async function mediaResolve(request, sdk) {
  const entity = request && request.entity;
  if (!entity) throw new Error('缺少曲目实体');
  const trackId = str(firstValue(entity.providerData && entity.providerData.trackId, entity.id));
  if (!trackId) throw makeError('track_unavailable', '缺少曲目标识');
  const quality = requestedQuality(request && request.quality);
  const expectedDuration = durationSeconds(firstValue(entity.duration, entity.providerData && entity.providerData.duration));
  try {
    return await racePriority([
      {
        delay: 0,
        run: async (context) => {
          const body = await fetchH5(sdk, trackId);
          if (context.cancelled()) return null;
          const model = parseMaybeJson(firstValue(body && body.track_player && body.track_player.video_model, body && body.data && body.data.track_player && body.data.track_player.video_model));
          const list = model && Array.isArray(model.video_list) ? model.video_list : [];
          const expected = firstValue(expectedDuration, body && body.track && body.track.duration, body && body.data && body.data.track && body.data.track.duration);
          return selectCandidate(list, quality, expected, 'h5');
        },
      },
      {
        delay: 250,
        run: (context) => resolveSeo(sdk, trackId, quality, expectedDuration, context),
      },
      {
        delay: 600,
        run: (context) => resolveShare(sdk, trackId, quality, expectedDuration, context),
      },
    ]);
  } catch (_primaryError) {
    return racePriority([
      { delay: 0, run: (context) => resolveKuwoFallback(sdk, entity, quality, context) },
      { delay: 250, run: (context) => resolveNeteaseFallback(sdk, entity, quality, context) },
    ]);
  }
}

function formatLrcTime(milliseconds) {
  const ms = Math.max(0, Math.round(num(milliseconds)));
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const centiseconds = Math.floor((ms % 1000) / 10);
  return ('0' + minutes).slice(-2) + ':' + ('0' + seconds).slice(-2) + '.' + ('0' + centiseconds).slice(-2);
}

function isLrcText(text) {
  return /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(str(text));
}

function isKrcText(text) {
  return /^\[\d+,\d+\]/m.test(str(text)) && /<\d+,\d+,\d+>/.test(str(text));
}

function seoLyricDocument(body) {
  const lyric = firstValue(findFirstKey(body, 'lyric', 6), body && body.lyric);
  const object = asObject(lyric);
  const content = str(firstValue(object.content, object.lyric, object.text, typeof lyric === 'string' ? lyric : '')).trim();
  if (!content) return null;
  if (isLrcText(content)) return { format: 'lrc', rawLrc: content };
  if (isKrcText(content)) return { format: 'qrc', rawLrc: content };
  return null;
}

function sentenceText(sentence) {
  const object = asObject(sentence);
  if (Array.isArray(object.words) && object.words.length) {
    return object.words.map((word) => str(firstValue(word && word.text, word && word.word, word && word.content))).join('');
  }
  return str(firstValue(object.text, object.content, object.lyric));
}

function sentencesToLrc(sentences) {
  if (!Array.isArray(sentences)) return '';
  const lines = [];
  sentences.forEach((sentence) => {
    const object = asObject(sentence);
    const start = num(firstValue(object.startMs, object.start_ms, object.startTime, object.start_time));
    const text = sentenceText(object);
    if (text) lines.push('[' + formatLrcTime(start) + ']' + text);
  });
  return lines.join('\n');
}

async function lyricsGet(request, sdk) {
  const entity = request && request.entity;
  if (!entity) throw new Error('缺少曲目实体');
  const trackId = str(firstValue(entity.providerData && entity.providerData.trackId, entity.id));
  if (!trackId) return null;
  let seoError = null;
  try {
    const seo = await fetchSeo(sdk, trackId);
    const document = seoLyricDocument(seo);
    if (document) return document;
  } catch (error) {
    seoError = error;
  }
  let shareError = null;
  try {
    const url = buildUrl(SHARE_BASE, '/qishui/share/track', { track_id: trackId });
    const html = await getText(sdk, url, { Referer: 'https://music.douyin.com/', Accept: 'text/html,application/xhtml+xml' });
    const data = shareData(html);
    const option = firstValue(findFirstKey(data, 'audioWithLyricsOption', 7), findFirstKey(data, 'audio_option', 7));
    const lyrics = firstValue(option && option.lyrics, findFirstKey(data, 'lyrics', 7));
    const rawLrc = sentencesToLrc(lyrics && lyrics.sentences);
    if (rawLrc) return { format: 'lrc', rawLrc };
  } catch (error) {
    shareError = error;
  }
  const error = shareError || seoError;
  if (error && (error.code === 'authentication_required' || error.code === 'permission_denied' || error.code === 'rate_limited' || error.code === 'temporary_unavailable')) throw error;
  if (seoError && shareError) throw makeError('temporary_unavailable', '歌词服务暂时不可用');
  return null;
}

function mapComment(raw) {
  const object = asObject(raw);
  const user = asObject(firstValue(object.user, object.user_info, object.author));
  const createdAt = num(firstValue(object.created_at, object.create_time, object.time, object.timestamp));
  return {
    id: str(firstValue(object.id, object.comment_id, object.cid)),
    content: str(firstValue(object.content, object.text, object.message)),
    user: {
      id: str(firstValue(user.id, user.uid, object.uid)),
      name: str(firstValue(user.nickname, user.name, user.screen_name)),
      artwork: coverUrl(firstValue(user.avatar, user.avatar_url, user.url_cover)),
    },
    createdAt,
    timeUnit: createdAt > 100000000000 ? 'milliseconds' : 'seconds',
    likes: num(firstValue(object.digg_count, object.like_count, object.likes)),
  };
}

async function commentsList(request, sdk) {
  const entity = request && request.entity;
  if (!entity) throw new Error('缺少曲目实体');
  const limit = limitOf(request);
  const state = decodeCursor(request && request.cursor, 'comments.list', request);
  const groupId = str(firstValue(entity.providerData && entity.providerData.trackId, entity.id));
  const upstreamCursor = state ? str(state.cursor) : '0';
  const url = buildUrl(API_BASE, '/luna/pc/comments', Object.assign({}, PUBLIC_QUERY, {
    group_id: groupId,
    cursor: upstreamCursor,
    count: limit,
    group_type: '1',
    image_strategy: '2',
  }));
  const body = await getJson(sdk, url, { Referer: 'https://api.qishui.com/' });
  const list = firstValue(body && body.comment_list, body && body.comments, body && body.data && body.data.comments, body && body.data && body.data.list);
  const items = dedupeEntities((Array.isArray(list) ? list : []).map(mapComment).filter((item) => item.id));
  return pageFromUpstream(items, state, body, 'comments.list', request, limit);
}

function extractLinkText(value) {
  const text = str(value).trim();
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  return match ? match[0] : text;
}

function linksResolve(request, sdk) {
  const input = extractLinkText(request && request.url);
  let url;
  try { url = new URL(input); } catch (_error) { throw new Error('不是有效的汽水分享链接'); }
  const hostname = url.hostname.toLowerCase();
  if (hostname !== 'qishui.douyin.com' && hostname !== 'music.douyin.com' && hostname !== 'api.qishui.com') {
    throw new Error('不是可识别的汽水分享链接');
  }
  const trackId = str(firstValue(url.searchParams.get('track_id'), url.searchParams.get('trackId')));
  if (trackId) return { providerId: PROVIDER_ID, kind: 'music', id: trackId };
  const playlistId = str(firstValue(url.searchParams.get('playlist_id'), url.searchParams.get('list_id')));
  if (playlistId) return { providerId: PROVIDER_ID, kind: 'sheet', id: playlistId };
  const pathMatch = /^\/(?:s|playlist)\/([^/?#]+)/i.exec(url.pathname);
  if (pathMatch) {
    try { return { providerId: PROVIDER_ID, kind: 'sheet', id: decodeURIComponent(pathMatch[1]) }; }
    catch (_error) { throw new Error('歌单链接编码无效'); }
  }
  throw new Error('不是可识别的汽水分享链接');
}

async function linksShare(request, sdk) {
  const entity = request && request.entity;
  if (!entity) return null;
  const type = str(entity.type || entity.kind);
  const id = str(entity.id);
  if (!id) return null;
  if (type === 'music') return buildUrl(SHARE_BASE, '/qishui/share/track', { track_id: id });
  if (type === 'sheet') return 'https://qishui.douyin.com/s/' + encodeURIComponent(id);
  return null;
}

const handlers = {
  search,
  entities: { get: entitiesGet },
  collections: { get: collectionsGet, members: collectionsMembers },
  discovery: {
    charts: discoveryCharts,
    playlistTags: discoveryPlaylistTags,
    playlists: discoveryPlaylists,
  },
  media: { resolve: mediaResolve },
  lyrics: { get: lyricsGet },
  comments: { list: commentsList },
  links: { resolve: linksResolve, share: linksShare },
};

module.exports = { manifest, handlers };
