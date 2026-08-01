import { getRequestHeaders, saveSettingsDebounced } from '../../../../script.js';
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';

const MODULE_NAME = 'third-party/theater-share';
const SETTINGS_KEY = 'theaterShare';
const API_PATH = '/api/plugins/theater-share';
const MAX_FILE_SIZE = 256 * 1024;
const DEFAULT_SETTINGS = {
    serverUrl: '',
    favorites: [],
    deleteTokens: {},
};

function settings() {
    extension_settings[SETTINGS_KEY] ??= structuredClone(DEFAULT_SETTINGS);
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (extension_settings[SETTINGS_KEY][key] === undefined) {
            extension_settings[SETTINGS_KEY][key] = structuredClone(value);
        }
    }
    return extension_settings[SETTINGS_KEY];
}

function normalizeServerUrl(value = settings().serverUrl) {
    const raw = String(value || '').trim();
    if (!raw) {
        return window.location.origin;
    }
    const url = new URL(raw, window.location.origin);
    if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('服务器地址只支持 HTTP 或 HTTPS。');
    }
    return url.origin;
}

function apiUrl(path = '') {
    return `${normalizeServerUrl()}${API_PATH}${path}`;
}

async function readError(response) {
    try {
        const data = await response.json();
        return data.error || `请求失败（HTTP ${response.status}）`;
    } catch {
        return `请求失败（HTTP ${response.status}）`;
    }
}

async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    if (!response.ok) {
        throw new Error(await readError(response));
    }
    return response.status === 204 ? null : response.json();
}

function formatDate(value) {
    try {
        return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
    } catch {
        return value;
    }
}

function makeButton(label, icon, handler) {
    return $('<button class="menu_button"></button>')
        .append($(`<i class="fa-solid ${icon}"></i>`), document.createTextNode(` ${label}`))
        .on('click', handler);
}

function shareUrl(item) {
    const source = item.source || normalizeServerUrl();
    return `${source}${item.sharePath || `/theater-share/${encodeURIComponent(item.id)}.html`}`;
}

function encodeShareCode(item) {
    const bytes = new TextEncoder().encode(shareUrl(item));
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return `TS1.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}

function decodeShareCode(value) {
    const raw = String(value || '').trim();
    if (!raw.startsWith('TS1.')) return raw;
    const encoded = raw.slice(4).replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    try {
        const binary = atob(padded);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    } catch {
        throw new Error('分享码格式无效或已损坏。');
    }
}

async function copyShareLink(item) {
    await navigator.clipboard.writeText(shareUrl(item));
    toastr.success('分享链接已复制。');
}

async function copyShareCode(item) {
    await navigator.clipboard.writeText(encodeShareCode(item));
    toastr.success('分享码已复制。');
}

function saveFavorite(item) {
    const data = settings();
    const index = data.favorites.findIndex(value => value.id === item.id && value.source === item.source);
    const favorite = { ...item, source: item.source || normalizeServerUrl() };
    if (index >= 0) {
        data.favorites[index] = favorite;
    } else {
        data.favorites.unshift(favorite);
    }
    data.favorites = data.favorites.slice(0, 100);
    saveSettingsDebounced();
    toastr.success('已保存到我的收藏。');
}

function removeFavorite(item) {
    const data = settings();
    data.favorites = data.favorites.filter(value => !(value.id === item.id && value.source === item.source));
    saveSettingsDebounced();
}

async function previewItem(item) {
    let body;
    if (item.contentType === 'html') {
        body = $('<div></div>')
            .append($('<p class="theater-share-meta"></p>').text('HTML 在隔离沙箱中运行，无法访问你的酒馆页面。'))
            .append($('<iframe class="theater-share-preview-frame" sandbox="allow-scripts"></iframe>').attr('srcdoc', item.content));
    } else {
        let content = item.content;
        if (item.contentType === 'json') {
            try {
                content = JSON.stringify(JSON.parse(content), null, 2);
            } catch {
                // Keep the original content if an older item contains malformed JSON.
            }
        }
        body = $('<pre class="theater-share-preview-text"></pre>').text(content);
    }
    await callGenericPopup(body, POPUP_TYPE.TEXT, item.title, {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
}

async function loadFullItem(item, source = normalizeServerUrl()) {
    if (typeof item.content === 'string') {
        return { ...item, source };
    }
    const value = await fetchJson(`${source}${API_PATH}/items/${encodeURIComponent(item.id)}`);
    return { ...value, source };
}

function loadPublicShare(url) {
    return new Promise((resolve, reject) => {
        const iframe = $('<iframe hidden sandbox="allow-scripts"></iframe>').attr('src', url.href).appendTo(document.body);
        const timeout = window.setTimeout(() => finish(new Error('读取分享链接超时，请确认链接可以公开访问。')), 15000);
        const onMessage = event => {
            // A sandbox without allow-same-origin deliberately reports an opaque origin.
            // Checking the exact iframe window keeps messages scoped to the requested share page.
            if (event.source !== iframe[0].contentWindow) return;
            if (event.data?.type !== 'sillytavern-theater-share' || !event.data.item) return;
            finish(null, { ...event.data.item, source: url.origin });
        };
        function finish(error, item) {
            window.clearTimeout(timeout);
            window.removeEventListener('message', onMessage);
            iframe.remove();
            error ? reject(error) : resolve(item);
        }
        window.addEventListener('message', onMessage);
    });
}

function renderCard(item, options = {}) {
    const card = $('<article class="theater-share-card"></article>');
    card.append($('<h3></h3>').text(item.title));
    card.append($('<div class="theater-share-meta"></div>').text(`${item.author || '匿名玩家'} · ${formatDate(item.createdAt)}`));
    if (item.description) {
        card.append($('<p></p>').text(item.description));
    }
    if (Array.isArray(item.tags) && item.tags.length) {
        const tags = $('<div class="theater-share-tags"></div>');
        for (const tag of item.tags) {
            tags.append($('<button type="button" class="theater-share-tag"></button>')
                .text(`#${tag}`)
                .attr('title', `搜索标签：${tag}`)
                .on('click', () => {
                    const search = $('#theater_share_search');
                    if (search.length) {
                        search.val(tag).trigger($.Event('keydown', { key: 'Enter' }));
                    }
                }));
        }
        card.append(tags);
    }
    const actions = $('<div class="theater-share-actions"></div>');
    actions.append(makeButton('预览', 'fa-eye', async () => {
        try {
            await previewItem(await loadFullItem(item, item.source));
        } catch (error) {
            toastr.error(error.message);
        }
    }));
    if (!options.local) {
        actions.append(makeButton('收藏', 'fa-bookmark', async () => {
            try {
                saveFavorite(await loadFullItem(item, item.source));
            } catch (error) {
                toastr.error(error.message);
            }
        }));
        actions.append(makeButton('复制分享码', 'fa-ticket', () => copyShareCode(item).catch(error => toastr.error(error.message))));
        actions.append(makeButton('复制链接', 'fa-link', () => copyShareLink(item).catch(error => toastr.error(error.message))));
    } else {
        actions.append(makeButton('移除', 'fa-trash', () => {
            removeFavorite(item);
            card.remove();
        }));
    }
    const token = settings().deleteTokens[item.id];
    if (token && !options.local) {
        actions.append(makeButton('删除上传', 'fa-trash', async () => {
            const confirmed = await callGenericPopup('确定删除这个公开作品吗？此操作不可恢复。', POPUP_TYPE.CONFIRM);
            if (!confirmed) return;
            try {
                await fetchJson(apiUrl(`/items/${encodeURIComponent(item.id)}`), {
                    method: 'DELETE',
                    headers: { ...getRequestHeaders(), 'X-Delete-Token': token },
                });
                delete settings().deleteTokens[item.id];
                saveSettingsDebounced();
                card.remove();
                toastr.success('作品已删除。');
            } catch (error) {
                toastr.error(error.message);
            }
        }));
    }
    card.append(actions);
    return card;
}

async function openWindow() {
    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'window');
    const dialog = $(html);
    let page = 1;
    let total = 0;
    const pageSize = 20;

    function selectTab(name) {
        dialog.find('.theater-share-tab').toggleClass('active', false);
        dialog.find(`.theater-share-tab[data-tab="${name}"]`).toggleClass('active', true);
        dialog.find('[data-panel]').prop('hidden', true);
        dialog.find(`[data-panel="${name}"]`).prop('hidden', false);
        if (name === 'local') {
            const container = dialog.find('#theater_share_local').empty();
            const favorites = settings().favorites;
            if (!favorites.length) container.append($('<p></p>').text('还没有收藏小剧场。'));
            favorites.forEach(item => container.append(renderCard(item, { local: true })));
        }
    }

    async function loadGallery() {
        const container = dialog.find('#theater_share_gallery').empty().append($('<p></p>').text('正在加载…'));
        try {
            const query = dialog.find('#theater_share_search').val();
            const result = await fetchJson(`${apiUrl('/items')}?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(query)}`);
            total = result.total;
            container.empty();
            if (!result.items.length) container.append($('<p></p>').text('暂时没有作品，来上传第一个小剧场吧。'));
            result.items.forEach(item => container.append(renderCard({ ...item, source: normalizeServerUrl() })));
            const pages = Math.max(1, Math.ceil(total / pageSize));
            dialog.find('#theater_share_page').text(`第 ${page} / ${pages} 页，共 ${total} 个`);
            dialog.find('#theater_share_previous').prop('disabled', page <= 1);
            dialog.find('#theater_share_next').prop('disabled', page >= pages);
        } catch (error) {
            container.empty().append($('<p></p>').text(`无法连接分享服务：${error.message}`));
        }
    }

    dialog.find('.theater-share-tab').on('click', function () {
        selectTab($(this).data('tab'));
    });
    dialog.find('#theater_share_refresh').on('click', () => {
        page = 1;
        loadGallery();
    });
    dialog.find('#theater_share_search').on('keydown', event => {
        if (event.key === 'Enter') {
            page = 1;
            loadGallery();
        }
    });
    dialog.find('#theater_share_previous').on('click', () => {
        if (page > 1) {
            page--;
            loadGallery();
        }
    });
    dialog.find('#theater_share_next').on('click', () => {
        if (page * pageSize < total) {
            page++;
            loadGallery();
        }
    });
    dialog.find('#theater_share_file').on('change', async function () {
        const file = this.files?.[0];
        if (!file) return;
        if (file.size > MAX_FILE_SIZE) {
            toastr.error('文件不能超过 256 KB。');
            this.value = '';
            return;
        }
        const extension = file.name.split('.').pop()?.toLowerCase();
        if (['html', 'htm'].includes(extension)) dialog.find('#theater_share_content_type').val('html');
        if (extension === 'json') dialog.find('#theater_share_content_type').val('json');
        if (['txt', 'md'].includes(extension)) dialog.find('#theater_share_content_type').val('text');
        dialog.find('#theater_share_content').val(await file.text());
        if (!dialog.find('#theater_share_title').val()) {
            dialog.find('#theater_share_title').val(file.name.replace(/\.[^.]+$/, ''));
        }
    });
    dialog.find('#theater_share_upload').on('click', async function () {
        const button = $(this).prop('disabled', true);
        const result = dialog.find('#theater_share_upload_result').empty();
        try {
            if (normalizeServerUrl() !== window.location.origin) {
                throw new Error('为保护 CSRF 安全，上传只能提交到当前打开的酒馆服务器；请将分享服务器地址留空后上传。');
            }
            const payload = {
                title: dialog.find('#theater_share_title').val(),
                author: dialog.find('#theater_share_author').val(),
                description: dialog.find('#theater_share_description').val(),
                tags: dialog.find('#theater_share_tags').val(),
                contentType: dialog.find('#theater_share_content_type').val(),
                content: dialog.find('#theater_share_content').val(),
            };
            const response = await fetchJson(apiUrl('/items'), {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify(payload),
            });
            settings().deleteTokens[response.item.id] = response.deleteToken;
            saveSettingsDebounced();
            const url = shareUrl(response.item);
            const code = encodeShareCode(response.item);
            const codeInput = $('<input class="text_pole" readonly>').val(code);
            const linkInput = $('<input class="text_pole" readonly>').val(url);
            result.append(
                $('<p></p>').text('上传成功，删除凭证已保存在当前浏览器。把分享码发给其他插件用户即可：'),
                codeInput,
                makeButton('复制分享码', 'fa-ticket', () => navigator.clipboard.writeText(code).then(() => toastr.success('分享码已复制。'))),
                $('<p></p>').text('也可以分享完整链接：'),
                linkInput,
                makeButton('复制链接', 'fa-copy', () => navigator.clipboard.writeText(url).then(() => toastr.success('链接已复制。'))),
            );
            page = 1;
            await loadGallery();
        } catch (error) {
            toastr.error(error.message);
            result.append($('<p></p>').text(error.message));
        } finally {
            button.prop('disabled', false);
        }
    });
    dialog.find('#theater_share_open_link').on('click', async () => {
        const container = dialog.find('#theater_share_link_result').empty();
        try {
            const input = decodeShareCode(dialog.find('#theater_share_link').val());
            const url = new URL(input);
            const isApiLink = url.pathname.match(/\/api\/plugins\/theater-share\/items\/[^/]+$/);
            const isPublicLink = url.pathname.match(/\/theater-share\/[^/]+\.html$/);
            if (!['http:', 'https:'].includes(url.protocol) || (!isApiLink && !isPublicLink)) {
                throw new Error('这不是有效的小剧场分享链接。');
            }
            const item = isPublicLink
                ? await loadPublicShare(url)
                : { ...await fetchJson(url.href), source: url.origin };
            container.append(renderCard(item));
        } catch (error) {
            container.append($('<p></p>').text(error.message));
        }
    });

    selectTab('gallery');
    loadGallery();
    await callGenericPopup(dialog, POPUP_TYPE.TEXT, '小剧场分享', {
        wide: true,
        large: true,
        allowVerticalScrolling: true,
    });
}

jQuery(async () => {
    settings();
    const menuContainer = $('<div id="theater_share_wand_container" class="extension_container"></div>');
    const menuButton = $(`
        <div id="theater_share_wand_button" class="list-group-item flex-container flexGap5">
            <div class="fa-fw fa-solid fa-masks-theater extensionsMenuExtensionButton"></div>
            <span>小剧场分享</span>
        </div>`);
    menuButton.on('click', () => openWindow().catch(error => toastr.error(error.message)));
    menuContainer.append(menuButton);
    $('#attach_file_wand_container').after(menuContainer);

    const html = await renderExtensionTemplateAsync(MODULE_NAME, 'settings');
    $('#extensions_settings2').append(html);
    $('#theater_share_server_url')
        .val(settings().serverUrl)
        .on('change', function () {
            try {
                const value = String($(this).val()).trim();
                if (value) normalizeServerUrl(value);
                settings().serverUrl = value.replace(/\/+$/, '');
                saveSettingsDebounced();
            } catch (error) {
                toastr.error(error.message);
            }
        });
    $('#theater_share_open').on('click', () => openWindow().catch(error => toastr.error(error.message)));
});
