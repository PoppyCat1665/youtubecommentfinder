import {
  parseVideoId,
  extractChannelRef,
  matchesComment,
  highlightParts,
  formatCount,
  formatNumber,
  formatRelativeTime,
  formatDuration,
  commentLink,
  toCsv,
} from './lib.js';

const API_ROOT = 'https://www.googleapis.com/youtube/v3';
const KEY_STORAGE = 'ytcf.apiKey';
const SETTINGS_STORAGE = 'ytcf.settings';
const PAGE_SIZE = 100;
const MAX_THREAD_PAGES = 10;
const MAX_REPLY_PAGES = 10;
const MAX_REPLY_THREAD_FETCHES = 30;
const MAX_VIDEOS = 50;
const RESULTS_BATCH = 50;

const FATAL_REASONS = new Set([
  'quotaExceeded',
  'dailyLimitExceeded',
  'userRateLimitExceeded',
  'rateLimitExceeded',
  'keyInvalid',
  'accessNotConfigured',
  'SERVICE_DISABLED',
  'ipRefererBlocked',
  'refererBlocked',
  'networkError',
]);

const $ = (id) => document.getElementById(id);
const dom = {
  keyDetails: $('keyDetails'),
  keyStatus: $('keyStatus'),
  apiKeyInput: $('apiKeyInput'),
  toggleKeyBtn: $('toggleKeyBtn'),
  searchForm: $('searchForm'),
  videoUrl: $('videoUrl'),
  phraseInput: $('phraseInput'),
  authorInput: $('authorInput'),
  channelInput: $('channelInput'),
  commentOrder: $('commentOrder'),
  maxVideos: $('maxVideos'),
  maxComments: $('maxComments'),
  includeReplies: $('includeReplies'),
  matchCase: $('matchCase'),
  formError: $('formError'),
  searchBtn: $('searchBtn'),
  searchBtnLabel: $('searchBtnLabel'),
  cancelBtn: $('cancelBtn'),
  demoBtn: $('demoBtn'),
  runPanel: $('runPanel'),
  statusText: $('statusText'),
  statusDetail: $('statusDetail'),
  runBadge: $('runBadge'),
  progressBar: $('progressBar'),
  statComments: $('statComments'),
  statMatches: $('statMatches'),
  statVideos: $('statVideos'),
  statUnits: $('statUnits'),
  warnings: $('warnings'),
  videoPanel: $('videoPanel'),
  resultsSection: $('resultsSection'),
  matchCount: $('matchCount'),
  matchLabel: $('matchLabel'),
  resultsSub: $('resultsSub'),
  sortSelect: $('sortSelect'),
  exportBtn: $('exportBtn'),
  clearBtn: $('clearBtn'),
  resultsList: $('resultsList'),
  loadMoreBtn: $('loadMoreBtn'),
  emptyState: $('emptyState'),
  toast: $('toast'),
  year: $('year'),
};

const state = {
  apiKey: '',
  running: false,
  controller: null,
  results: [],
  seen: new Set(),
  warnings: [],
  stats: { comments: 0, videos: 0, units: 0, skipped: 0 },
  visible: RESULTS_BATCH,
  mode: null,
  filters: { phrase: '', author: '', matchCase: false },
  demo: false,
  display: null,
};

class AppError extends Error {
  constructor(message, reason = 'appError') {
    super(message);
    this.name = 'AppError';
    this.reason = reason;
  }
}

/* ------------------------------------------------------------------ */
/* Boot, storage and UI plumbing                                       */
/* ------------------------------------------------------------------ */

function init() {
  dom.year.textContent = String(new Date().getFullYear());

  state.apiKey = readStorage(KEY_STORAGE) ?? '';
  dom.apiKeyInput.value = state.apiKey;
  updateKeyStatus();
  dom.keyDetails.open = !state.apiKey;

  applySettings();
  prefillFromUrl();

  dom.apiKeyInput.addEventListener('input', syncKey);
  dom.toggleKeyBtn.addEventListener('click', toggleKeyVisibility);
  dom.searchForm.addEventListener('submit', (event) => {
    event.preventDefault();
    runSearch();
  });
  dom.cancelBtn.addEventListener('click', () => state.controller?.abort());
  dom.demoBtn.addEventListener('click', loadDemo);
  dom.clearBtn.addEventListener('click', resetResults);
  dom.exportBtn.addEventListener('click', exportResults);
  dom.sortSelect.addEventListener('change', () => {
    state.visible = RESULTS_BATCH;
    renderResults();
  });
  dom.loadMoreBtn.addEventListener('click', () => {
    state.visible += RESULTS_BATCH;
    renderResults();
  });

  for (const id of ['commentOrder', 'maxVideos', 'maxComments', 'includeReplies', 'matchCase']) {
    dom[id].addEventListener('change', saveSettings);
  }

  renderStats();

  if (new URLSearchParams(window.location.search).get('demo') === '1') {
    loadDemo();
  }
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* Private mode / storage disabled: the app still works for this session. */
  }
}

function removeStorage(key) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

function syncKey() {
  state.apiKey = dom.apiKeyInput.value.trim();
  if (state.apiKey) writeStorage(KEY_STORAGE, state.apiKey);
  else removeStorage(KEY_STORAGE);
  updateKeyStatus();
}

function updateKeyStatus() {
  const hasKey = Boolean(dom.apiKeyInput.value.trim());
  dom.keyStatus.textContent = hasKey ? 'Saved' : 'Not set';
  dom.keyStatus.classList.toggle('ok', hasKey);
}

function toggleKeyVisibility() {
  const showing = dom.apiKeyInput.type === 'text';
  dom.apiKeyInput.type = showing ? 'password' : 'text';
  dom.toggleKeyBtn.textContent = showing ? 'Show' : 'Hide';
  dom.toggleKeyBtn.setAttribute('aria-pressed', String(!showing));
}

function applySettings() {
  const raw = readStorage(SETTINGS_STORAGE);
  if (!raw) return;

  let saved;
  try {
    saved = JSON.parse(raw);
  } catch {
    return;
  }
  if (!saved || typeof saved !== 'object') return;

  if (['relevance', 'time'].includes(saved.commentOrder)) {
    dom.commentOrder.value = saved.commentOrder;
  }
  if ([...dom.maxVideos.options].some((option) => option.value === String(saved.maxVideos))) {
    dom.maxVideos.value = String(saved.maxVideos);
  }
  if ([...dom.maxComments.options].some((option) => option.value === String(saved.maxComments))) {
    dom.maxComments.value = String(saved.maxComments);
  }
  dom.includeReplies.checked = Boolean(saved.includeReplies);
  dom.matchCase.checked = Boolean(saved.matchCase);
}

function saveSettings() {
  writeStorage(SETTINGS_STORAGE, JSON.stringify({
    commentOrder: dom.commentOrder.value,
    maxVideos: dom.maxVideos.value,
    maxComments: dom.maxComments.value,
    includeReplies: dom.includeReplies.checked,
    matchCase: dom.matchCase.checked,
  }));
}

function prefillFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const fields = [
    ['url', dom.videoUrl],
    ['q', dom.phraseInput],
    ['author', dom.authorInput],
    ['channel', dom.channelInput],
  ];
  for (const [param, input] of fields) {
    const value = params.get(param);
    if (value) input.value = value;
  }
}

function updateStatus(text, detail = '', isError = false) {
  dom.statusText.textContent = text;
  dom.statusText.classList.toggle('error', Boolean(isError));
  dom.statusDetail.textContent = detail;
  dom.statusDetail.title = detail;
}

function setRunningUI(running) {
  dom.searchBtn.disabled = running;
  dom.demoBtn.disabled = running;
  dom.cancelBtn.hidden = !running;
  dom.runBadge.hidden = !running;
  dom.searchBtnLabel.textContent = running ? 'Searching…' : 'Search comments';
  for (const node of dom.searchForm.querySelectorAll('input, select')) {
    node.disabled = running;
  }
}

function showError(message) {
  dom.formError.textContent = message;
  dom.formError.hidden = false;
  dom.formError.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideError() {
  dom.formError.hidden = true;
  dom.formError.textContent = '';
}

function addWarning(message) {
  if (!message || state.warnings.includes(message)) return;
  state.warnings.push(message);
  renderWarnings();
}

function renderWarnings() {
  dom.warnings.replaceChildren();
  for (const message of state.warnings.slice(0, 10)) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    dom.warnings.append(paragraph);
  }
  if (state.warnings.length > 10) {
    const paragraph = document.createElement('p');
    paragraph.textContent = `…and ${state.warnings.length - 10} more note(s).`;
    dom.warnings.append(paragraph);
  }
}

function renderStats() {
  dom.statComments.textContent = formatCount(state.stats.comments);
  dom.statMatches.textContent = formatCount(state.results.length);
  dom.statVideos.textContent = formatCount(state.stats.videos);
  dom.statUnits.textContent = formatNumber(state.stats.units);
}

function showToast(message) {
  dom.toast.textContent = message;
  dom.toast.classList.add('show');
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => dom.toast.classList.remove('show'), 2200);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function truncate(value, max) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function safeUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return '';
  try {
    const url = new URL(value, window.location.href);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.protocol === 'http:' && window.location.protocol === 'https:') {
      url.protocol = 'https:';
    }
    return url.href;
  } catch {
    return '';
  }
}
/* ------------------------------------------------------------------ */
/* YouTube Data API calls                                              */
/* ------------------------------------------------------------------ */

function estimateCost(endpoint) {
  return endpoint === 'search' ? 100 : 1;
}

async function apiGet(endpoint, params, signal) {
  const url = new URL(`${API_ROOT}/${endpoint}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  url.searchParams.set('key', state.apiKey);
  state.stats.units += estimateCost(endpoint);

  let response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new AppError('Could not reach YouTube. Check your internet connection and try again.', 'networkError');
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    data = null;
  }

  if (!response.ok) {
    const apiError = data?.error ?? {};
    const reason = apiError.errors?.[0]?.reason
      || apiError.details?.find((detail) => detail?.reason)?.reason
      || `http-${response.status}`;
    throw new AppError(
      apiError.message || `YouTube API request failed (HTTP ${response.status}).`,
      reason,
    );
  }

  renderStats();
  return data ?? {};
}

function isFatalError(error) {
  return error instanceof AppError ? FATAL_REASONS.has(error.reason) : false;
}

function explainError(error) {
  if (error instanceof AppError) {
    switch (error.reason) {
      case 'keyInvalid':
      case 'badRequest':
        return 'Google rejected the API key. Check that it is copied correctly and that the YouTube Data API v3 is enabled for its project.';
      case 'accessNotConfigured':
      case 'SERVICE_DISABLED':
        return 'The YouTube Data API v3 is not enabled for that key’s project. Enable it in Google Cloud Console, wait a minute, then try again.';
      case 'quotaExceeded':
      case 'dailyLimitExceeded':
        return 'The daily YouTube API quota is used up. It resets at midnight Pacific time — or use a different API key/project.';
      case 'userRateLimitExceeded':
      case 'rateLimitExceeded':
        return 'YouTube is rate-limiting requests. Wait a few seconds and try again.';
      case 'commentsDisabled':
        return 'Comments are turned off for that video.';
      case 'videoNotFound':
        return 'That video is private, deleted, or unavailable.';
      case 'channelNotFound':
        return 'That channel could not be found. Try its @handle or a full channel URL.';
      case 'ipRefererBlocked':
      case 'refererBlocked':
        return 'This site is not allowed by the API key’s website restrictions. Add this page’s origin under “Website restrictions” in Google Cloud Console.';
      default:
        return error.message;
    }
  }
  return error?.message || 'Something went wrong while talking to YouTube.';
}

function shortError(error) {
  if (!(error instanceof AppError)) return 'unexpected error';
  switch (error.reason) {
    case 'commentsDisabled':
      return 'comments are turned off';
    case 'videoNotFound':
      return 'video unavailable';
    case 'forbidden':
      return 'access denied';
    default:
      return error.message.length > 120 ? `${error.message.slice(0, 117)}…` : error.message;
  }
}

async function fetchVideoDetails(videoIds, signal) {
  const map = new Map();
  for (let index = 0; index < videoIds.length; index += 50) {
    const batch = videoIds.slice(index, index + 50);
    const data = await apiGet('videos', {
      part: 'snippet,statistics,contentDetails',
      id: batch.join(','),
    }, signal);
    for (const item of data.items ?? []) {
      map.set(item.id, item);
    }
  }
  return map;
}

async function resolveChannel(ref, signal) {
  if (ref.type === 'id') {
    const data = await apiGet('channels', {
      part: 'snippet,contentDetails,statistics',
      id: ref.value,
    }, signal);
    if (data.items?.[0]) return data.items[0];
    throw new AppError('That channel ID was not found.', 'channelNotFound');
  }

  if (ref.type === 'handle' || ref.type === 'username') {
    const lookup = ref.type === 'handle' ? 'forHandle' : 'forUsername';
    try {
      const data = await apiGet('channels', {
        part: 'snippet,contentDetails,statistics',
        [lookup]: ref.value,
      }, signal);
      if (data.items?.[0]) return data.items[0];
    } catch (error) {
      if (isFatalError(error)) throw error;
    }
  }

  const query = ref.value.replace(/^@/, '').trim();
  if (!query) return null;
  const search = await apiGet('search', {
    part: 'snippet',
    type: 'channel',
    q: query,
    maxResults: 1,
  }, signal);
  const channelId = search.items?.[0]?.id?.channelId;
  if (!channelId) return null;
  const data = await apiGet('channels', {
    part: 'snippet,contentDetails,statistics',
    id: channelId,
  }, signal);
  return data.items?.[0] ?? null;
}

async function fetchChannelVideos(channel, maxVideos, signal) {
  const uploads = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const ids = [];
  let pageToken = '';
  do {
    const data = await apiGet('playlistItems', {
      part: 'contentDetails',
      playlistId: uploads,
      maxResults: Math.min(50, Math.max(1, maxVideos - ids.length)),
      pageToken,
    }, signal);
    for (const item of data.items ?? []) {
      const videoId = item.contentDetails?.videoId;
      if (videoId && !ids.includes(videoId)) ids.push(videoId);
      if (ids.length >= maxVideos) break;
    }
    pageToken = data.nextPageToken || '';
  } while (pageToken && ids.length < maxVideos);

  return ids.slice(0, maxVideos);
}

async function searchVideos(query, maxVideos, signal) {
  const data = await apiGet('search', {
    part: 'snippet',
    type: 'video',
    q: query,
    maxResults: Math.min(50, Math.max(1, maxVideos)),
    order: 'relevance',
  }, signal);
  return (data.items ?? [])
    .map((item) => item.id?.videoId)
    .filter(Boolean)
    .slice(0, maxVideos);
}


/* ------------------------------------------------------------------ */
/* Search orchestration                                                */
/* ------------------------------------------------------------------ */

async function runSearch() {
  if (state.running) return;
  hideError();

  const apiKey = dom.apiKeyInput.value.trim();
  if (!apiKey) {
    dom.keyDetails.open = true;
    showError('Add a YouTube Data API key first — it is stored only in this browser.');
    dom.apiKeyInput.focus();
    return;
  }
  state.apiKey = apiKey;
  writeStorage(KEY_STORAGE, apiKey);
  updateKeyStatus();

  const phrase = dom.phraseInput.value.trim();
  const author = dom.authorInput.value.trim();
  const videoInput = dom.videoUrl.value.trim();
  const channelInput = dom.channelInput.value.trim();

  if (!phrase && !author) {
    showError('Enter a phrase, a commenter, or both. At least one is required.');
    return;
  }
  if (!videoInput && !channelInput && !phrase) {
    showError('To search by commenter only, add a video URL or channel — YouTube has no global comment index.');
    dom.videoUrl.focus();
    return;
  }

  const videoId = videoInput ? parseVideoId(videoInput) : null;
  if (videoInput && !videoId) {
    showError('That video URL was not recognized. Paste a youtube.com/watch, youtu.be, Shorts, or Live URL.');
    dom.videoUrl.focus();
    return;
  }

  const channelRef = !videoId && channelInput ? extractChannelRef(channelInput) : null;
  const mode = videoId ? 'video' : channelRef ? 'channel' : 'global';

  const options = {
    maxVideos: clamp(Number(dom.maxVideos.value) || 10, 1, MAX_VIDEOS),
    maxComments: clamp(Number(dom.maxComments.value) || 200, 100, 1000),
    includeReplies: dom.includeReplies.checked,
    matchCase: dom.matchCase.checked,
    order: dom.commentOrder.value === 'time' ? 'time' : 'relevance',
  };
  const filters = { phrase, author, matchCase: options.matchCase };
  saveSettings();

  state.running = true;
  state.controller = new AbortController();
  state.results = [];
  state.seen = new Set();
  state.warnings = [];
  state.stats = { comments: 0, videos: 0, units: 0, skipped: 0 };
  state.visible = RESULTS_BATCH;
  state.mode = mode;
  state.filters = filters;
  state.demo = false;
  state.display = null;

  setRunningUI(true);
  resetRunPanel();
  dom.resultsSection.hidden = true;
  dom.emptyState.hidden = true;

  const startedAt = performance.now();
  const signal = state.controller.signal;

  try {
    await executeSearch({ mode, options, filters, videoId, channelRef, channelInput, signal });
    const seconds = ((performance.now() - startedAt) / 1000).toFixed(1);
    const label = state.results.length === 1 ? 'match' : 'matches';
    updateStatus(
      `Done — ${formatNumber(state.results.length)} ${label} found.`,
      `${formatNumber(state.stats.comments)} comments · ${state.stats.videos} video${state.stats.videos === 1 ? '' : 's'} · ${seconds}s · ~${formatNumber(state.stats.units)} quota units`,
    );
    finishProgress(false);
  } catch (error) {
    const aborted = error?.name === 'AbortError' || signal.aborted;
    if (aborted) {
      updateStatus('Search cancelled — showing comments found so far.');
      finishProgress(true);
    } else {
      const message = explainError(error);
      updateStatus(message, '', true);
      showError(message);
      finishProgress(true);
    }
  } finally {
    state.running = false;
    state.controller = null;
    setRunningUI(false);
    renderStats();
    renderWarnings();
    renderResults();
  }
}

function resetRunPanel() {
  dom.runPanel.hidden = false;
  dom.runBadge.hidden = false;
  dom.progressBar.className = 'progress-fill indeterminate';
  dom.progressBar.style.width = '';
  dom.warnings.replaceChildren();
  dom.videoPanel.hidden = true;
  dom.videoPanel.replaceChildren();
  updateStatus('Starting…');
  renderStats();
}

function finishProgress(halted) {
  dom.progressBar.classList.remove('indeterminate');
  dom.progressBar.classList.add('done');
  dom.progressBar.style.width = '100%';
  dom.progressBar.title = halted ? 'Search stopped before completion' : 'Search complete';
}

async function executeSearch({ mode, options, filters, videoId, channelRef, channelInput, signal }) {
  if (mode === 'video') {
    updateStatus('Looking up video…');
    const metaMap = await fetchVideoDetails([videoId], signal);
    const meta = metaMap.get(videoId);
    if (!meta) {
      throw new AppError('That video is private, deleted, or unavailable.', 'videoNotFound');
    }
    state.display = { type: 'video', meta };
    renderMedia();
    await scanTargets([videoId], metaMap, options, filters, signal);
    return;
  }

  if (mode === 'channel') {
    updateStatus('Resolving channel…');
    const channel = await resolveChannel(channelRef, signal);
    if (!channel) {
      throw new AppError(
        `Couldn’t find a channel for “${truncate(channelInput, 60)}”. Try its @handle or channel URL.`,
        'channelNotFound',
      );
    }
    state.display = { type: 'channel', meta: channel };
    renderMedia();
    updateStatus('Finding recent uploads…', channel.snippet?.title ?? '');
    const videoIds = await fetchChannelVideos(channel, options.maxVideos, signal);
    if (!videoIds.length) {
      throw new AppError('No public uploads were found for that channel.', 'noVideos');
    }
    updateStatus(`Loading ${videoIds.length} video${videoIds.length === 1 ? '' : 's'}…`);
    const metaMap = await fetchVideoDetails(videoIds, signal);
    await scanTargets(videoIds, metaMap, options, filters, signal);
    return;
  }

  updateStatus(`Searching YouTube for “${truncate(filters.phrase, 70)}”…`);
  const videoIds = await searchVideos(filters.phrase, options.maxVideos, signal);
  if (!videoIds.length) {
    throw new AppError('YouTube search returned no videos for that phrase. Try a shorter or more common phrase.', 'noVideos');
  }
  state.display = { type: 'search', query: filters.phrase, count: videoIds.length };
  renderMedia();
  updateStatus(`Loading ${videoIds.length} video${videoIds.length === 1 ? '' : 's'}…`);
  const metaMap = await fetchVideoDetails(videoIds, signal);
  await scanTargets(videoIds, metaMap, options, filters, signal);
}

/* ------------------------------------------------------------------ */
/* Comment scanning                                                    */
/* ------------------------------------------------------------------ */

async function scanTargets(videoIds, metaMap, options, filters, signal) {
  const total = videoIds.length;
  for (let index = 0; index < total; index += 1) {
    if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError');

    const videoId = videoIds[index];
    const meta = metaMap.get(videoId);
    const title = meta?.snippet?.title ?? videoId;
    updateStatus(`Scanning video ${index + 1} of ${total}…`, title);

    if (!meta) {
      state.stats.skipped += 1;
      addWarning(`Skipped an unavailable video (${videoId}).`);
      continue;
    }

    try {
      await scanVideo(videoId, meta, options, filters, signal);
      state.stats.videos += 1;
    } catch (error) {
      if (error?.name === 'AbortError' || signal.aborted) throw error;
      if (isFatalError(error)) throw error;
      state.stats.skipped += 1;
      addWarning(`Skipped “${truncate(title, 70)}”: ${shortError(error)}`);
    }

    renderStats();
    renderWarnings();
  }
}

async function scanVideo(videoId, meta, options, filters, signal) {
  let pageToken = '';
  let pageCount = 0;
  let scanned = 0;
  let warnedReplyLimit = false;
  const replyTasks = [];

  const consider = (comment, isReply) => {
    if (scanned >= options.maxComments) return false;
    scanned += 1;
    state.stats.comments += 1;

    const candidate = toCandidate(comment, videoId, meta, isReply);
    if (!candidate.id || state.seen.has(candidate.id)) return true;
    state.seen.add(candidate.id);

    if (matchesComment({ text: candidate.text, author: candidate.authorHaystack }, filters)) {
      state.results.push(candidate);
      renderStats();
    }
    return true;
  };

  do {
    const data = await apiGet('commentThreads', {
      part: options.includeReplies ? 'snippet,replies' : 'snippet',
      videoId,
      maxResults: PAGE_SIZE,
      order: options.order,
      textFormat: 'plainText',
      pageToken,
    }, signal);

    for (const item of data.items ?? []) {
      const top = item.snippet?.topLevelComment;
      if (top && !consider(top, false)) break;

      if (options.includeReplies) {
        const inline = item.replies?.comments ?? [];
        for (const reply of inline) {
          if (!consider(reply, true)) break;
        }

        const totalReplies = Number(item.snippet?.totalReplyCount ?? 0);
        if (totalReplies > inline.length) {
          if (replyTasks.length < MAX_REPLY_THREAD_FETCHES) {
            replyTasks.push({
              parentId: top?.id ?? item.id,
              known: new Set(inline.map((reply) => reply.id)),
            });
          } else if (!warnedReplyLimit) {
            warnedReplyLimit = true;
            addWarning(`Only the first ${MAX_REPLY_THREAD_FETCHES} reply threads were expanded for “${truncate(meta.snippet?.title ?? videoId, 55)}”.`);
          }
        }
      }

      if (scanned >= options.maxComments) break;
    }

    pageToken = data.nextPageToken || '';
    pageCount += 1;
    renderStats();
    updateStatus(
      `Scanning ${truncate(meta.snippet?.title ?? videoId, 64)}…`,
      `${formatNumber(scanned)} comments checked · ${formatNumber(state.results.length)} match${state.results.length === 1 ? '' : 'es'} so far`,
    );

    if (scanned >= options.maxComments) break;
  } while (pageToken && pageCount < MAX_THREAD_PAGES);

  for (const task of replyTasks) {
    if (signal.aborted) throw new DOMException('Search cancelled', 'AbortError');
    if (scanned >= options.maxComments) break;

    try {
      const replies = await fetchAllReplies(task.parentId, signal);
      for (const reply of replies) {
        if (task.known.has(reply.id)) continue;
        if (!consider(reply, true)) break;
      }
    } catch (error) {
      if (error?.name === 'AbortError' || signal.aborted) throw error;
      if (isFatalError(error)) throw error;
      addWarning(`Could not load some replies: ${shortError(error)}`);
    }
    renderStats();
  }

  updateStatus(
    `Scanned ${truncate(meta.snippet?.title ?? videoId, 64)}`,
    `${formatNumber(scanned)} comments checked · ${formatNumber(state.results.length)} total matches`,
  );
}

async function fetchAllReplies(parentId, signal) {
  const replies = [];
  let pageToken = '';
  let pages = 0;

  do {
    const data = await apiGet('replies', {
      part: 'snippet',
      parentId,
      maxResults: PAGE_SIZE,
      textFormat: 'plainText',
      pageToken,
    }, signal);
    replies.push(...(data.items ?? []));
    pageToken = data.nextPageToken || '';
    pages += 1;
  } while (pageToken && pages < MAX_REPLY_PAGES);

  return replies;
}

function toCandidate(comment, videoId, meta, isReply) {
  const snippet = comment?.snippet ?? {};
  const authorChannelId = snippet.authorChannelId?.value ?? '';
  const authorUrl = snippet.authorChannelUrl
    || (authorChannelId ? `https://www.youtube.com/channel/${encodeURIComponent(authorChannelId)}` : '');
  const thumbnails = meta?.snippet?.thumbnails ?? {};
  const videoThumb = thumbnails.medium?.url
    || thumbnails.default?.url
    || `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/mqdefault.jpg`;

  return {
    id: comment?.id ?? '',
    videoId,
    videoTitle: meta?.snippet?.title ?? 'YouTube video',
    videoThumb: safeUrl(videoThumb),
    author: snippet.authorDisplayName ?? 'Unknown commenter',
    authorUrl: safeUrl(authorUrl),
    authorAvatar: safeUrl(snippet.authorProfileImageUrl),
    authorHaystack: [
      snippet.authorDisplayName ?? '',
      snippet.authorChannelUrl ?? '',
      authorChannelId,
    ].filter(Boolean).join(' '),
    text: snippet.textDisplay ?? snippet.textOriginal ?? '',
    likeCount: Math.max(0, Number(snippet.likeCount ?? 0) || 0),
    publishedAt: snippet.publishedAt ?? '',
    updatedAt: snippet.updatedAt ?? '',
    isReply: Boolean(isReply || snippet.parentId),
    link: commentLink(videoId, comment?.id),
  };
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function renderMedia() {
  const display = state.display;
  dom.videoPanel.replaceChildren();
  if (!display) {
    dom.videoPanel.hidden = true;
    return;
  }

  let card = null;

  if (display.type === 'video') {
    const video = display.meta;
    const snippet = video.snippet ?? {};
    const stats = video.statistics ?? {};
    const thumb = snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url;
    card = buildMediaCard({
      kicker: 'Scanning video',
      title: snippet.title ?? 'YouTube video',
      metaLines: [
        snippet.channelTitle,
        stats.viewCount !== undefined ? `${formatCount(stats.viewCount)} views` : '',
        stats.likeCount !== undefined ? `${formatCount(stats.likeCount)} likes` : '',
        snippet.publishedAt ? formatRelativeTime(snippet.publishedAt) : '',
        formatDuration(video.contentDetails?.duration),
      ],
      thumbUrl: safeUrl(thumb),
      links: [{ label: 'Open on YouTube', href: commentLink(video.id, '') }],
    });
  } else if (display.type === 'channel') {
    const channel = display.meta;
    const snippet = channel.snippet ?? {};
    const stats = channel.statistics ?? {};
    const thumb = snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url;
    card = buildMediaCard({
      kicker: 'Scanning channel',
      title: snippet.title ?? 'YouTube channel',
      metaLines: [
        stats.subscriberCount !== undefined ? `${formatCount(stats.subscriberCount)} subscribers` : 'subscriber count hidden',
        stats.videoCount !== undefined ? `${formatCount(stats.videoCount)} videos` : '',
        snippet.customUrl,
      ],
      thumbUrl: safeUrl(thumb),
      links: [{ label: 'Open channel', href: safeUrl(`https://www.youtube.com/channel/${channel.id}`) }],
    });
  } else if (display.type === 'search') {
    card = buildMediaCard({
      kicker: 'YouTube-wide · best effort',
      title: `Videos matching “${truncate(display.query, 80)}”`,
      metaLines: [
        `${display.count} candidate video${display.count === 1 ? '' : 's'}`,
        'Scanning their comments for your filters',
      ],
      thumbUrl: '',
      links: [{
        label: 'Open YouTube search',
        href: safeUrl(`https://www.youtube.com/results?search_query=${encodeURIComponent(display.query)}`),
      }],
    });
  }

  if (!card) {
    dom.videoPanel.hidden = true;
    return;
  }
  dom.videoPanel.append(card);
  dom.videoPanel.hidden = false;
}

function buildMediaCard({ kicker, title, metaLines, thumbUrl, links }) {
  const fragment = document.createDocumentFragment();

  if (thumbUrl) {
    const thumb = document.createElement('div');
    thumb.className = 'media-thumb';
    const img = document.createElement('img');
    img.src = thumbUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    thumb.append(img);
    fragment.append(thumb);
  }

  const body = document.createElement('div');
  body.className = 'media-body';

  const kick = document.createElement('span');
  kick.className = 'media-kicker';
  kick.textContent = kicker;

  const titleEl = document.createElement('h2');
  titleEl.className = 'media-title';
  titleEl.textContent = title;

  const meta = document.createElement('p');
  meta.className = 'media-meta';
  for (const line of metaLines) {
    if (!line) continue;
    const span = document.createElement('span');
    span.textContent = line;
    meta.append(span);
  }

  body.append(kick, titleEl, meta);

  if (links?.length) {
    const linkRow = document.createElement('div');
    linkRow.className = 'media-links';
    for (const link of links) {
      if (!link?.href) continue;
      const anchor = document.createElement('a');
      anchor.href = link.href;
      anchor.target = '_blank';
      anchor.rel = 'noopener';
      anchor.textContent = `${link.label} ↗`;
      linkRow.append(anchor);
    }
    if (linkRow.childElementCount) body.append(linkRow);
  }

  fragment.append(body);
  return fragment;
}

function renderResults() {
  const sorted = sortResults(state.results);
  const total = sorted.length;

  dom.resultsSection.hidden = false;
  dom.matchCount.textContent = formatNumber(total);
  if (dom.matchLabel) dom.matchLabel.textContent = total === 1 ? 'match' : 'matches';
  dom.resultsSub.textContent = resultsSubtitle();
  dom.resultsList.replaceChildren();

  if (!total) {
    dom.resultsList.append(buildNoResults());
    dom.loadMoreBtn.hidden = true;
    dom.exportBtn.disabled = true;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const result of sorted.slice(0, state.visible)) {
    fragment.append(buildResultCard(result));
  }
  dom.resultsList.append(fragment);
  dom.exportBtn.disabled = false;

  const remaining = total - state.visible;
  dom.loadMoreBtn.hidden = remaining <= 0;
  if (remaining > 0) {
    dom.loadMoreBtn.textContent = `Show ${formatNumber(Math.min(RESULTS_BATCH, remaining))} more (${formatNumber(remaining)} left)`;
  }
}

function sortResults(items) {
  const sorted = items.slice();
  const mode = dom.sortSelect.value;
  const time = (value) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };

  if (mode === 'newest') {
    sorted.sort((a, b) => time(b.publishedAt) - time(a.publishedAt));
  } else if (mode === 'oldest') {
    sorted.sort((a, b) => time(a.publishedAt) - time(b.publishedAt));
  } else if (mode === 'liked') {
    sorted.sort((a, b) => (b.likeCount - a.likeCount) || (time(b.publishedAt) - time(a.publishedAt)));
  }
  return sorted;
}

function resultsSubtitle() {
  const bits = [];
  if (state.demo) bits.push('Demo data — no API calls made');
  else if (state.mode === 'video') bits.push('Single video');
  else if (state.mode === 'channel') bits.push(`Channel · ${state.display?.meta?.snippet?.title ?? ''}`.trim());
  else if (state.mode === 'global') bits.push('Best-effort YouTube-wide search');

  if (state.filters.phrase) bits.push(`phrase “${truncate(state.filters.phrase, 50)}”`);
  if (state.filters.author) bits.push(`commenter “${truncate(state.filters.author, 40)}”`);
  if (state.filters.matchCase) bits.push('case-sensitive');
  bits.push(`${formatNumber(state.stats.comments)} comments scanned`);
  if (state.stats.skipped) {
    bits.push(`${formatNumber(state.stats.skipped)} video${state.stats.skipped === 1 ? '' : 's'} skipped`);
  }
  return bits.filter(Boolean).join(' · ');
}

function buildResultCard(result) {
  const card = document.createElement('article');
  card.className = 'result-card';

  const head = document.createElement('div');
  head.className = 'result-head';

  const avatar = document.createElement('div');
  avatar.className = 'avatar-wrap';
  if (result.authorAvatar) {
    const img = document.createElement('img');
    img.src = result.authorAvatar;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => {
      img.remove();
      avatar.textContent = firstLetter(result.author);
    });
    avatar.append(img);
  } else {
    avatar.textContent = firstLetter(result.author);
  }

  const who = document.createElement('div');
  who.className = 'result-who';

  if (result.authorUrl) {
    const authorLink = document.createElement('a');
    authorLink.className = 'author-link';
    authorLink.href = result.authorUrl;
    authorLink.target = '_blank';
    authorLink.rel = 'noopener';
    authorLink.textContent = result.author;
    authorLink.title = `Open ${result.author} on YouTube`;
    who.append(authorLink);
  } else {
    const authorName = document.createElement('span');
    authorName.className = 'author-link';
    authorName.textContent = result.author;
    who.append(authorName);
  }

  if (result.isReply) {
    const badge = document.createElement('span');
    badge.className = 'reply-badge';
    badge.textContent = 'Reply';
    who.append(badge);
  }

  if (result.publishedAt) {
    const parsed = new Date(result.publishedAt);
    const time = document.createElement('time');
    time.className = 'result-time';
    time.dateTime = result.publishedAt;
    time.textContent = formatRelativeTime(result.publishedAt);
    time.title = Number.isNaN(parsed.getTime()) ? '' : parsed.toLocaleString();
    who.append(time);
  }

  const likes = document.createElement('span');
  likes.className = 'likes';
  likes.title = `${formatNumber(result.likeCount)} likes`;
  likes.append(thumbIcon(), document.createTextNode(formatCount(result.likeCount)));

  head.append(avatar, who, likes);

  const text = document.createElement('p');
  text.className = 'result-text';
  for (const part of highlightParts(result.text, state.filters.phrase, state.filters.matchCase)) {
    if (!part.text) continue;
    if (part.match) {
      const mark = document.createElement('mark');
      mark.textContent = part.text;
      text.append(mark);
    } else {
      text.append(document.createTextNode(part.text));
    }
  }

  const foot = document.createElement('div');
  foot.className = 'result-foot';

  const chip = document.createElement('a');
  chip.className = 'video-chip';
  chip.href = commentLink(result.videoId, '');
  chip.target = '_blank';
  chip.rel = 'noopener';
  chip.title = result.videoTitle;
  if (result.videoThumb) {
    const img = document.createElement('img');
    img.src = result.videoThumb;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    chip.append(img);
  }
  const chipText = document.createElement('span');
  chipText.textContent = result.videoTitle;
  chip.append(chipText);
  foot.append(chip);

  const actions = document.createElement('div');
  actions.className = 'result-actions';

  const open = document.createElement('a');
  open.className = 'text-link';
  open.href = result.link || commentLink(result.videoId, result.id);
  open.target = '_blank';
  open.rel = 'noopener';
  open.textContent = 'Open comment ↗';

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'text-link';
  copy.textContent = 'Copy';
  copy.addEventListener('click', () => copyText(result.text, copy));

  actions.append(open, copy);
  foot.append(actions);

  card.append(head, text, foot);
  return card;
}

function thumbIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M7 10.5 10.7 2h1.4c1 0 1.8.8 1.8 1.8v5.2h4.3c1.2 0 2.2 1.1 2 2.3l-1.2 7c-.2 1-1 1.7-2 1.7H7z');
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.6');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

function firstLetter(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed ? Array.from(trimmed)[0].toLocaleUpperCase() : '?';
}

function buildNoResults() {
  const wrap = document.createElement('div');
  wrap.className = 'no-results';

  const heading = document.createElement('h3');
  heading.textContent = 'No matching comments found';

  const paragraph = document.createElement('p');
  paragraph.textContent = 'Nothing in the comments that were scanned matched all of your filters.';

  const tips = document.createElement('ul');
  const suggestions = [];

  if (state.filters.matchCase) suggestions.push('Turn off “Match case” to ignore capitalization.');
  if (!state.filters.phrase) suggestions.push('Try adding a phrase as well as a commenter.');
  else suggestions.push('Try a shorter phrase, or a distinctive word from the comment.');
  if (state.filters.author) suggestions.push('Check the spelling — display names and @handles can differ.');
  if (!state.demo) {
    suggestions.push('Increase “Max comments per video”, or scan more videos.');
    if (!dom.includeReplies.checked) suggestions.push('Turn on “Include replies” — the comment may be a reply.');
  }
  if (state.mode === 'global') {
    suggestions.push('For reliable results, add the video URL or the channel that posted the video.');
  }

  for (const suggestion of suggestions.slice(0, 5)) {
    const item = document.createElement('li');
    item.textContent = suggestion;
    tips.append(item);
  }

  wrap.append(heading, paragraph, tips);
  return wrap;
}

function resetResults() {
  if (state.running) return;

  state.results = [];
  state.seen = new Set();
  state.warnings = [];
  state.stats = { comments: 0, videos: 0, units: 0, skipped: 0 };
  state.visible = RESULTS_BATCH;
  state.mode = null;
  state.demo = false;
  state.display = null;

  dom.resultsSection.hidden = true;
  dom.resultsList.replaceChildren();
  dom.matchCount.textContent = '0';
  if (dom.matchLabel) dom.matchLabel.textContent = 'matches';
  dom.resultsSub.textContent = '';
  dom.loadMoreBtn.hidden = true;
  dom.exportBtn.disabled = true;

  dom.videoPanel.hidden = true;
  dom.videoPanel.replaceChildren();
  dom.runPanel.hidden = true;
  dom.warnings.replaceChildren();
  dom.progressBar.className = 'progress-fill';
  dom.progressBar.style.width = '0';
  dom.progressBar.title = '';
  dom.emptyState.hidden = false;
  dom.sortSelect.value = 'match';

  hideError();
  updateStatus('Ready');
  renderStats();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exportResults() {
  if (!state.results.length) return;

  const rows = [[
    'Video title',
    'Video URL',
    'Commenter',
    'Comment',
    'Likes',
    'Published at',
    'Is reply',
    'Comment URL',
  ]];

  for (const item of sortResults(state.results)) {
    rows.push([
      item.videoTitle,
      commentLink(item.videoId, ''),
      item.author,
      item.text,
      item.likeCount,
      item.publishedAt,
      item.isReply ? 'yes' : 'no',
      item.link,
    ]);
  }

  const csv = `\uFEFF${toCsv(rows)}`;
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `youtube-comments-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast(`Exported ${formatNumber(state.results.length)} comment${state.results.length === 1 ? '' : 's'}`);
}

async function copyText(text, button) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.append(textarea);
    textarea.select();
    try {
      copied = document.execCommand('copy');
    } catch {
      copied = false;
    }
    textarea.remove();
  }

  if (button) {
    const original = button.textContent;
    button.textContent = copied ? 'Copied!' : 'Copy failed';
    window.setTimeout(() => { button.textContent = original; }, 1500);
  }
  showToast(copied ? 'Comment copied to clipboard' : 'Could not copy — select the text manually');
}

/* ------------------------------------------------------------------ */
/* Demo mode                                                           */
/* ------------------------------------------------------------------ */

function loadDemo() {
  if (state.running) return;
  hideError();

  state.demo = true;
  state.mode = 'video';
  state.filters = { phrase: 'never gonna', author: '', matchCase: false };
  state.results = [];
  state.seen = new Set();
  state.warnings = [];
  state.stats = { comments: 487, videos: 1, units: 0, skipped: 0 };
  state.visible = RESULTS_BATCH;

  dom.videoUrl.value = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  dom.phraseInput.value = state.filters.phrase;
  dom.authorInput.value = '';
  dom.channelInput.value = '';
  dom.includeReplies.checked = true;
  dom.matchCase.checked = false;
  dom.sortSelect.value = 'match';

  const video = demoVideo();
  state.display = { type: 'video', meta: video };
  state.results = demoComments(video);
  state.seen = new Set(state.results.map((item) => item.id));

  addWarning('Demo mode — no API calls were made. Add your own key and run a search for real comments.');

  dom.runPanel.hidden = false;
  dom.runBadge.hidden = true;
  dom.progressBar.className = 'progress-fill done';
  dom.progressBar.style.width = '100%';
  dom.progressBar.title = 'Demo data loaded';
  dom.emptyState.hidden = true;
  dom.resultsSection.hidden = false;

  updateStatus('Demo results loaded.', 'Example data · the real search uses the YouTube Data API');
  renderStats();
  renderWarnings();
  renderMedia();
  renderResults();
  setRunningUI(false);
  dom.cancelBtn.hidden = true;
  dom.keyDetails.open = !state.apiKey;

  dom.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function demoVideo() {
  return {
    id: 'dQw4w9WgXcQ',
    snippet: {
      title: 'Rick Astley – Never Gonna Give You Up (Official Video)',
      channelTitle: 'Rick Astley',
      publishedAt: '2009-10-25T06:57:33Z',
      thumbnails: {
        medium: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg' },
        default: { url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg' },
      },
    },
    statistics: { viewCount: '1700000000', likeCount: '17000000' },
    contentDetails: { duration: 'PT3M33S' },
  };
}

function demoComments(video) {
  const base = {
    videoId: video.id,
    videoTitle: video.snippet.title,
    videoThumb: video.snippet.thumbnails.medium.url,
    authorUrl: '',
    authorAvatar: '',
    likeCount: 0,
    publishedAt: '2026-09-20T12:00:00Z',
    updatedAt: '',
    isReply: false,
  };

  const items = [
    {
      id: 'demo-1',
      author: 'Rick Astley',
      authorUrl: 'https://www.youtube.com/@RickAstleyYT',
      text: 'Never gonna give you up, never gonna let you down — thanks for 1.7 billion views!',
      likeCount: 48200,
      publishedAt: '2026-09-18T18:30:00Z',
      isReply: true,
    },
    {
      id: 'demo-2',
      author: 'MusicNerd92',
      text: 'The phrase “never gonna” appears in the chorus. Obviously.\nStill a banger in 2026.',
      likeCount: 1204,
      publishedAt: '2026-08-02T09:15:00Z',
    },
    {
      id: 'demo-3',
      author: 'DemoUser',
      text: 'I came here from a comment finder demo. Never gonna apologize for that.',
      likeCount: 87,
      publishedAt: '2026-07-11T21:45:00Z',
    },
    {
      id: 'demo-4',
      author: 'RetroFan',
      text: 'Never gonna give this song up. A true classic.',
      likeCount: 15,
      publishedAt: '2026-06-05T07:20:00Z',
    },
  ];

  return items.map((item) => ({
    ...base,
    ...item,
    authorHaystack: `${item.author} ${item.authorUrl}`.trim(),
    link: commentLink(video.id, item.id),
  }));
}

init();
