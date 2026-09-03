// Storage keys
const READ_ITEMS_KEY = 'rss_read_items';
const SELECTED_FEED_KEY = 'rss_selected_feed';
const GITHUB_CONFIG_KEY = 'rss_github_config';
const FAVORITES_KEY = 'rss_favorites';
const DELETED_ITEMS_KEY = 'rss_deleted_items';
const COLLAPSED_SECTIONS_KEY = 'rss_collapsed_sections';
const ARCHIVED_PATH = 'data/archived.json';
const USER_STATE_PATH = 'data/user-state.json';

// GitHub config
let githubConfig = null;

// Data from GitHub
let allFeeds = [];
let allItems = [];
let metadata = {};

function decodeBase64Utf8(value) {
    const normalized = (value || '').replace(/\s/g, '');
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

function encodeBase64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach(byte => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}

// Selection state for batch operations
let selectedItems = new Set();

// Get read items from localStorage
function getReadItems() {
    return new Set(JSON.parse(localStorage.getItem(READ_ITEMS_KEY) || '[]'));
}

function saveReadItems(readItems) {
    localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...readItems]));
}

function getSelectedFeed() {
    return localStorage.getItem(SELECTED_FEED_KEY) || 'all';
}

function setSelectedFeed(feedUrl) {
    localStorage.setItem(SELECTED_FEED_KEY, feedUrl);
}

function getGitHubConfig() {
    const config = localStorage.getItem(GITHUB_CONFIG_KEY);
    return config ? JSON.parse(config) : null;
}

function getFavorites() {
    return new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]'));
}

function saveFavorites(favorites) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify([...favorites]));
}

function getDeletedItems() {
    return new Set(JSON.parse(localStorage.getItem(DELETED_ITEMS_KEY) || '[]'));
}

function saveDeletedItems(deletedItems) {
    localStorage.setItem(DELETED_ITEMS_KEY, JSON.stringify([...deletedItems]));
}

async function bootstrapLocalState() {
    if (localStorage.getItem(FAVORITES_KEY) ||
        localStorage.getItem(READ_ITEMS_KEY) ||
        localStorage.getItem(DELETED_ITEMS_KEY)) return;

    try {
        const response = await fetch(`${USER_STATE_PATH}?${Date.now()}`);
        if (!response.ok) return;
        const state = await response.json();
        if (Array.isArray(state.favorites)) {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(state.favorites));
        }
        if (Array.isArray(state.archived)) {
            localStorage.setItem(READ_ITEMS_KEY, JSON.stringify(state.archived));
        }
        if (Array.isArray(state.deleted)) {
            localStorage.setItem(DELETED_ITEMS_KEY, JSON.stringify(state.deleted));
        }
    } catch (error) {
        console.error('Failed to bootstrap local reader state:', error);
    }
}

function exportLocalBackup() {
    const backup = {
        version: 1,
        favorites: [...getFavorites()],
        archived: [...getReadItems()],
        deleted: [...getDeletedItems()],
        selectedFeed: getSelectedFeed(),
        collapsedSections: [...getCollapsedSections()],
        exportedAt: new Date().toISOString()
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `feedomatic-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showStatus('Backup exported.', false);
}

function importLocalBackup(event) {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const backup = JSON.parse(reader.result);
            const isList = value => Array.isArray(value) && value.every(item => typeof item === 'string');
            if (!isList(backup.favorites) || !isList(backup.archived) || !isList(backup.deleted)) {
                throw new Error('This is not a valid Feedomatic backup.');
            }

            localStorage.setItem(FAVORITES_KEY, JSON.stringify(backup.favorites));
            localStorage.setItem(READ_ITEMS_KEY, JSON.stringify(backup.archived));
            localStorage.setItem(DELETED_ITEMS_KEY, JSON.stringify(backup.deleted));
            if (typeof backup.selectedFeed === 'string') {
                localStorage.setItem(SELECTED_FEED_KEY, backup.selectedFeed);
            }
            if (isList(backup.collapsedSections)) {
                localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(backup.collapsedSections));
            }
            location.reload();
        } catch (error) {
            showStatus(`Unable to import backup: ${error.message}`, true);
        }
    };
    reader.readAsText(file);
}

function getCollapsedSections() {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY) || '["archive", "favorites"]'));
}

function saveCollapsedSections(sections) {
    localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...sections]));
}

function toggleSection(sectionName) {
    const content = document.getElementById(`${sectionName}Items`);
    const caret = document.getElementById(`${sectionName}Caret`);
    const collapsedSections = getCollapsedSections();
    
    if (collapsedSections.has(sectionName)) {
        collapsedSections.delete(sectionName);
        content.classList.remove('collapsed');
        if (caret) caret.style.transform = 'rotate(-180deg)';
    } else {
        collapsedSections.add(sectionName);
        content.classList.add('collapsed');
        if (caret) caret.style.transform = 'rotate(0deg)';
    }
    
    saveCollapsedSections(collapsedSections);
}

function toggleFavorite(itemId) {
    const favorites = getFavorites();
    
    if (favorites.has(itemId)) {
        favorites.delete(itemId);
    } else {
        favorites.add(itemId);
    }
    
    saveFavorites(favorites);
    renderItems();
}

// Poll GitHub Actions workflow status
async function waitForWorkflowCompletion() {
    if (!githubConfig) return;
    
    const { user, repo, token } = githubConfig;
    const workflowName = 'Fetch RSS Feeds';
    
    try {
        // Poll every 5 seconds, max 2 minutes
        let attempts = 0;
        const maxAttempts = 24;
        
        const poll = async () => {
            attempts++;
            
            const response = await fetch(
                `https://api.github.com/repos/${user}/${repo}/actions/runs?per_page=5`,
                {
                    headers: {
                        'Authorization': `token ${token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                }
            );
            
            if (!response.ok) return false;
            
            const data = await response.json();
            const recentRun = data.workflow_runs?.find(run => run.name === workflowName);
            
            if (!recentRun) return false;
            
            if (recentRun.status === 'completed') {
                if (recentRun.conclusion === 'success') {
                    showStatus('✓ Feed data updated! Reloading...', false);
                    setTimeout(() => location.reload(), 1500);
                    return true;
                } else {
                    showStatus('⚠ Workflow completed with issues. Refresh page to check.', true);
                    return true;
                }
            }
            
            if (attempts >= maxAttempts) {
                showStatus('⏱ Still processing... Refresh page manually to check progress.', false);
                return true;
            }
            
            // Continue polling
            setTimeout(poll, 5000);
            return false;
        };
        
        await poll();
    } catch (error) {
        console.error('Error polling workflow:', error);
    }
}

function saveGitHubConfig(e) {
    if (e) e.preventDefault(); // Prevent form submission
    
    const user = document.getElementById('githubUser').value.trim();
    const repo = document.getElementById('githubRepo').value.trim();
    const token = document.getElementById('githubToken').value.trim();
    
    if (!user || !repo || !token) {
        showStatus('Please fill in all fields', true);
        return;
    }
    
    const config = { user, repo, token };
    localStorage.setItem(GITHUB_CONFIG_KEY, JSON.stringify(config));
    githubConfig = config;
    
    const setupSection = document.getElementById('setupSection');
    const settingsButton = document.getElementById('settingsButton');
    setupSection.classList.add('hidden');
    if (settingsButton) {
        settingsButton.classList.remove('active');
    }
    showStatus('Configuration saved! You can now add feeds.', false);
}

function checkSetup() {
    githubConfig = getGitHubConfig();
    if (!githubConfig) {
        document.getElementById('setupSection').classList.remove('hidden');
        updateSetupUI(false);
    } else {
        document.getElementById('setupSection').classList.add('hidden');
    }
}

function toggleSettings() {
    const setupSection = document.getElementById('setupSection');
    const settingsButton = document.getElementById('settingsButton');
    const isHidden = setupSection.classList.contains('hidden');
    
    if (isHidden) {
        // Opening settings
        updateSetupUI(true);
        
        // Pre-fill form with existing values
        if (githubConfig) {
            document.getElementById('githubUser').value = githubConfig.user || '';
            document.getElementById('githubRepo').value = githubConfig.repo || '';
            document.getElementById('githubToken').value = githubConfig.token || '';
        }
        
        setupSection.classList.remove('hidden');
        settingsButton.classList.add('active');
        setupSection.scrollIntoView({ behavior: 'smooth' });
    } else {
        // Closing settings
        setupSection.classList.add('hidden');
        settingsButton.classList.remove('active');
    }
}

function updateSetupUI(isEditing) {
    const title = document.getElementById('setupTitle');
    const description = document.getElementById('setupDescription');
    
    if (isEditing) {
        title.textContent = 'GitHub Configuration';
        description.textContent = 'Update your GitHub details (stored in browser only):';
    } else {
        title.textContent = 'Initial Setup Required';
        description.textContent = 'To add feeds via the UI, add your GitHub details here (stored in browser only):';
    }
}

// Load data from GitHub
async function loadData() {
    try {
        await bootstrapLocalState();
        let archivedItems = null;
        if (!localStorage.getItem(READ_ITEMS_KEY)) {
            try {
                const archivedResponse = await fetch(`${ARCHIVED_PATH}?${Date.now()}`);
                if (archivedResponse.ok) archivedItems = await archivedResponse.json();
            } catch (error) {
                console.error('Failed to load archived items:', error);
            }
        }
        const readItems = getReadItems();
        if (readItems.size === 0 && archivedItems) {
            archivedItems.forEach(itemId => readItems.add(itemId));
            localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...readItems]));
        }
        const deletedItems = getDeletedItems();
        
        // Load feeds
        const feedsResponse = await fetch('feeds.json?' + Date.now());
        allFeeds = await feedsResponse.json();
        
        // Load items
        const itemsResponse = await fetch('data/items.json?' + Date.now());
        const fetchedItems = await itemsResponse.json();
        allItems = fetchedItems.filter(item => !deletedItems.has(item.id));
        
        // Load metadata
        try {
            const metadataResponse = await fetch('data/metadata.json?' + Date.now());
            metadata = await metadataResponse.json();
        } catch (e) {
            metadata = {};
        }
        
        // Mark items as read based on loaded data
        allItems.forEach(item => {
            item.read = readItems.has(item.id);
        });
        
        renderFeeds();
        renderItems();
        updateLastUpdatedDisplay();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('feedList').innerHTML = 
            '<div class="empty-state">Error loading feeds. Make sure GitHub Actions has run at least once.</div>';
        document.getElementById('newItems').innerHTML = 
            '<div class="section-inner"><div class="empty-state">Error loading items.</div></div>';
    }
}

async function addFeed() {
    if (!githubConfig) {
        showStatus('Please complete setup first', true);
        document.getElementById('setupSection').classList.remove('hidden');
        return;
    }
    
    const input = document.getElementById('feedUrl');
    let url = input.value.trim();
    
    if (!url) return;
    
    // Add https:// if no protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = 'https://' + url;
    }
    
    if (allFeeds.includes(url)) {
        showStatus('Feed already added', true);
        return;
    }
    
    showStatus('Adding feed and triggering update...', false);
    
    try {
        // Get current feeds.json
        const { user, repo, token } = githubConfig;
        const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/feeds.json`;
        
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch feeds.json. Check your GitHub config.');
        }
        
        const fileData = await getResponse.json();
        const currentFeeds = JSON.parse(decodeBase64Utf8(fileData.content));
        
        // Add new feed
        currentFeeds.push(url);
        
        // Update feeds.json
        const updateResponse = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Add feed: ${url}`,
                content: encodeBase64Utf8(JSON.stringify(currentFeeds, null, 2)),
                sha: fileData.sha
            })
        });
        
        if (!updateResponse.ok) {
            const errBody = await updateResponse.json();
            console.error('GitHub API error:', errBody);  // <-- add this
            throw new Error('Failed to update feeds.json');
        }
        
        input.value = '';
        
        // Update local state
        allFeeds.push(url);
        renderFeeds();
        
        // Show status and start polling
        showStatus('✓ Feed added! Waiting for GitHub to fetch items...', false);
        setTimeout(() => waitForWorkflowCompletion(), 3000);
        
    } catch (error) {
        console.error('Error adding feed:', error);
        showStatus(`✗ ${error.message}`, true);
    }
}

async function removeFeed(url) {
    if (!githubConfig) {
        showStatus('Cannot remove feed: GitHub config missing', true);
        return;
    }
    
    if (!confirm(`Remove feed "${getFeedName(url)}"? All items from this feed will be deleted.`)) return;
    
    showStatus('Removing feed...', false);
    
    try {
        const { user, repo, token } = githubConfig;
        const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/feeds.json`;
        
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch feeds.json');
        }
        
        const fileData = await getResponse.json();
        const currentFeeds = JSON.parse(decodeBase64Utf8(fileData.content));
        
        // Remove feed
        const updatedFeeds = currentFeeds.filter(f => f !== url);
        
        // Update feeds.json
        const updateResponse = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Remove feed: ${url}`,
                content: encodeBase64Utf8(JSON.stringify(updatedFeeds, null, 2)),
                sha: fileData.sha
            })
        });
        
        if (!updateResponse.ok) {
            throw new Error('Failed to update feeds.json');
        }
        
        // Update local state
        allFeeds = allFeeds.filter(f => f !== url);
        
        if (getSelectedFeed() === url) {
            setSelectedFeed('all');
        }
        
        renderFeeds();
        renderItems();
        
        // Show status and start polling
        showStatus('✓ Feed removed! Updating data...', false);
        setTimeout(() => waitForWorkflowCompletion(), 3000);
        
    } catch (error) {
        console.error('Error removing feed:', error);
        showStatus(`✗ ${error.message}`, true);
    }
}

function getFeedName(url) {
    try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace('www.', '');
    } catch {
        return url;
    }
}

function selectFeed(feedUrl) {
    setSelectedFeed(feedUrl);
    renderFeeds();
    renderItems();
}

function showStatus(message, isError, persist = false) {
    const status = document.getElementById('feedStatus');
    status.textContent = message;
    status.className = isError ? 'error' : 'status';
    
    if (!persist) {
        setTimeout(() => {
            status.textContent = '';
        }, isError ? 10000 : 5000);
    }
}

function updateLastUpdatedDisplay() {
    const container = document.getElementById('lastUpdated');
    
    if (metadata.lastUpdated) {
        const date = new Date(metadata.lastUpdated);
        container.textContent = `Last updated: ${date.toLocaleString()} • ${metadata.totalItems || 0} total items`;
    }
}

function renderFeeds() {
    const container = document.getElementById('feedList');
    const selectedFeed = getSelectedFeed();
    
    if (allFeeds.length === 0) {
        container.innerHTML = '<div class="empty-state">No feeds yet. Add one above!</div>';
        return;
    }
    
    container.innerHTML = '';
    
    // "All Feeds" button
    const allButton = document.createElement('button');
    allButton.className = 'feed-button' + (selectedFeed === 'all' ? ' active' : '');
    allButton.textContent = 'All Feeds';
    allButton.addEventListener('click', () => selectFeed('all'));
    container.appendChild(allButton);
    
    // Individual feed buttons
    const sortedFeeds = [...allFeeds].sort((firstFeed, secondFeed) =>
        getFeedName(firstFeed).localeCompare(getFeedName(secondFeed), undefined, { sensitivity: 'base' })
    );

    sortedFeeds.forEach(feed => {
        const button = document.createElement('button');
        button.className = 'feed-button' + (selectedFeed === feed ? ' active' : '');
        
        const name = document.createElement('span');
        name.textContent = getFeedName(feed);
        button.appendChild(name);
        
        const remove = document.createElement('span');
        remove.className = 'remove';
        remove.textContent = '×';
        remove.addEventListener('click', (e) => {
            e.stopPropagation();
            removeFeed(feed);
        });
        button.appendChild(remove);
        
        button.addEventListener('click', () => selectFeed(feed));
        container.appendChild(button);
    });
}

function markAsRead(itemId) {
    const readItems = getReadItems();
    readItems.add(itemId);
    saveReadItems(readItems);
    
    const item = allItems.find(i => i.id === itemId);
    if (item) item.read = true;
    
    renderItems();
}

function markAsUnread(itemId) {
    const readItems = getReadItems();
    readItems.delete(itemId);
    saveReadItems(readItems);
    
    const item = allItems.find(i => i.id === itemId);
    if (item) item.read = false;
    
    renderItems();
}

function copyLinkToClipboard(link) {
    navigator.clipboard.writeText(link).then(() => {
        alert('Link copied to clipboard');
    }).catch(err => {
        console.error('Failed to copy link:', err);
        alert('Failed to copy link');
    });
}

function removeArchivedItemsFromLocalState(itemIds) {
    if (!itemIds || itemIds.size === 0) return 0;

    allItems = allItems.filter(item => !itemIds.has(item.id));

    const readItems = getReadItems();
    const deletedItems = getDeletedItems();
    itemIds.forEach(id => {
        readItems.delete(id);
        deletedItems.add(id);
    });
    saveReadItems(readItems);
    saveDeletedItems(deletedItems);

    selectedItems.clear();
    renderItems();

    return itemIds.size;
}

async function deleteItem(itemId) {
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    
    if (!confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
    
    showStatus('Deleting item...', false);
    
    try {
        const removedCount = removeArchivedItemsFromLocalState(new Set([itemId]));
        if (removedCount === 0) {
            throw new Error('Item was not found in the local archive list.');
        }

        showStatus('✓ Item deleted', false);
    } catch (error) {
        console.error('Error deleting item locally:', error);
        showStatus(`✗ ${error.message}. Local archive data was updated.`, true);
    }
}

function toggleItem(itemId, isArchive) {
    const content = document.getElementById(`content-${itemId}`);
    const isCurrentlyExpanded = content.classList.contains('expanded');
    
    if (!isArchive) {
        // For new items, close all others (single open)
        document.querySelectorAll('#newItems .item-content.expanded').forEach(item => {
            item.classList.remove('expanded');
            item.style.maxHeight = '0';
            // Remove focusable elements from tab order when collapsing
            item.querySelectorAll('a, button').forEach(el => el.setAttribute('tabindex', '-1'));
        });
    }
    // For archive items, allow multiple to stay open
    
    // Toggle the clicked item
    if (!isCurrentlyExpanded) {
        content.classList.add('expanded');
        // Calculate actual content height
        const scrollHeight = content.querySelector('.item-inner').scrollHeight;
        content.style.maxHeight = scrollHeight + 'px';
        // Make focusable elements accessible when expanding
        content.querySelectorAll('a, button').forEach(el => el.removeAttribute('tabindex'));
    } else {
        content.classList.remove('expanded');
        content.style.maxHeight = '0';
        // Remove focusable elements from tab order when collapsing
        content.querySelectorAll('a, button').forEach(el => el.setAttribute('tabindex', '-1'));
    }
}

function toggleItemSelection(itemId) {
    if (selectedItems.has(itemId)) {
        selectedItems.delete(itemId);
    } else {
        selectedItems.add(itemId);
    }
    updateBatchDeleteButton();
    updateCheckboxes();
}

function updateCheckboxes() {
    updateBatchDeleteButton();
    document.querySelectorAll('.item-checkbox').forEach(checkbox => {
        const itemId = decodeURIComponent(checkbox.dataset.itemId);
        checkbox.checked = selectedItems.has(itemId);
    });
}

function updateBatchDeleteButton() {
    const button = document.getElementById('batchDeleteButton');
    if (!button) return;
    
    if (selectedItems.size > 0) {
        button.textContent = `Delete Selected (${selectedItems.size})`;
        button.style.display = 'block';
    } else {
        button.style.display = 'none';
    }
}

async function batchDeleteItems() {
    if (selectedItems.size === 0) return;
    
    if (!confirm(`Permanently delete ${selectedItems.size} item(s)? This cannot be undone.`)) return;
    
    const itemIdsToDelete = new Set(selectedItems);
    showStatus('Deleting items...', false);
    
    try {
        const removedCount = removeArchivedItemsFromLocalState(itemIdsToDelete);
        showStatus(`✓ ${removedCount} item(s) deleted`, false);
    } catch (error) {
        console.error('Error deleting items locally:', error);
        showStatus(`✗ ${error.message}. Local archive data was updated.`, true);
    }
}

function renderItems() {
    const selectedFeed = getSelectedFeed();
    const favorites = getFavorites();
    let items = allItems;
    
    // Filter by selected feed
    if (selectedFeed !== 'all') {
        items = items.filter(item => item.feedUrl === selectedFeed);
    }
    
    const newItems = items.filter(item => !item.read && !favorites.has(item.id))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const favoriteItems = items.filter(item => favorites.has(item.id))
        .sort((a, b) => {
            const feedComparison = getFeedName(a.feedUrl).localeCompare(getFeedName(b.feedUrl));
            return feedComparison || new Date(b.pubDate) - new Date(a.pubDate);
        });
    const archiveItems = items.filter(item => item.read && !favorites.has(item.id))
        .sort((a, b) => {
            const feedComparison = getFeedName(a.feedUrl).localeCompare(getFeedName(b.feedUrl));
            return feedComparison || new Date(b.pubDate) - new Date(a.pubDate);
        });
    
    renderItemList('newItems', newItems, false, false);
    renderItemList('favoritesItems', favoriteItems, false, true);
    renderItemList('archiveItems', archiveItems, true, false);
    
    // Update collapsed state on render
    const collapsedSections = getCollapsedSections();
    ['archive', 'favorites'].forEach(section => {
        const content = document.getElementById(`${section}Items`);
        const caret = document.getElementById(`${section}Caret`);
        if (content && caret) {
            if (collapsedSections.has(section)) {
                content.classList.add('collapsed');
                caret.style.transform = 'rotate(0deg)';
            } else {
                content.classList.remove('collapsed');
                caret.style.transform = 'rotate(-180deg)';
            }
        }
    });
}

function renderItemList(containerId, items, isArchive, isFavorites) {
    const container = document.getElementById(containerId);
    const favorites = getFavorites();
    
    if (items.length === 0) {
        container.innerHTML = '<div class="section-inner"><div class="empty-state">No items</div></div>';
        return;
    }
    
    const itemsHtml = items.map((item, index) => {
        const date = new Date(item.pubDate).toLocaleDateString();
        const feedName = getFeedName(item.feedUrl);
        const safeId = `${containerId}-${index}`;
        const encodedId = encodeURIComponent(item.id);
        const isFavorited = favorites.has(item.id);
        
        return `
            <div class="item">
                <div class="item-header">
                    <div class="item-heading">
                        ${isArchive ? `<input type="checkbox" class="item-checkbox" data-item-id="${encodedId}">` : ''}
                        <button class="item-title" data-toggle-id="${safeId}" data-is-archive="${isArchive}">${escapeHtml(item.title)}</button>
                    </div>
                    <div class="item-meta" data-toggle-id="${safeId}" data-is-archive="${isArchive}">
                        <span>${escapeHtml(feedName)}</span>
                        <span>${date}</span>
                    </div>
                </div>
                <div class="item-content" id="content-${safeId}">
                    <div class="item-inner">
                        <div class="item-description">${escapeHtml(item.description)}</div>
                        <div class="item-actions">
                            <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="button-link" tabindex="-1">Read Article</a>
                            ${isArchive ? 
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="unread" tabindex="-1">Mark as New</button>
                                <button class="delete-button" data-item-id="${encodedId}" data-action="delete" tabindex="-1">Delete</button>` :
                                isFavorites ?
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="read" data-from-favorites="true" tabindex="-1">Archive Article</button>` :
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="read" tabindex="-1">Mark as Read</button>
                                <button class="favorite-button" data-item-id="${encodedId}" tabindex="-1">Add to Favorites</button>
                                <button class="copy-link-button" data-item-link="${item.link}" tabindex="-1">Copy Link</button>`
                            }
                        </div>
                    </div>
                </div>
            </div>
        `;
    }).join('');
    
    container.innerHTML = `<div class="section-inner">${itemsHtml}</div>`;
    
    // Add event listeners for mark buttons
    container.querySelectorAll('.mark-button').forEach(button => {
        button.addEventListener('click', function() {
            const itemId = decodeURIComponent(this.dataset.itemId);
            const action = this.dataset.action;
            const isFromFavorites = this.dataset.fromFavorites === 'true';
            
            if (action === 'read') {
                // If archiving from Favorites, also remove from favorites
                if (isFromFavorites) {
                    const favorites = getFavorites();
                    favorites.delete(itemId);
                    saveFavorites(favorites);
                }
                markAsRead(itemId);
            } else {
                markAsUnread(itemId);
            }
        });
    });
    
    // Add event listeners for delete buttons
    container.querySelectorAll('.delete-button').forEach(button => {
        button.addEventListener('click', function() {
            const itemId = decodeURIComponent(this.dataset.itemId);
            deleteItem(itemId);
        });
    });
    
    // Add event listeners for favorite buttons
    container.querySelectorAll('.favorite-button').forEach(button => {
        button.addEventListener('click', function() {
            const itemId = decodeURIComponent(this.dataset.itemId);
            toggleFavorite(itemId);
        });
    });
    
    // Add event listeners for copy link buttons
    container.querySelectorAll('.copy-link-button').forEach(button => {
        button.addEventListener('click', function() {
            const link = this.dataset.itemLink;
            copyLinkToClipboard(link);
        });
    });
    
    // Add event listeners for checkboxes
    container.querySelectorAll('.item-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', function() {
            const itemId = decodeURIComponent(this.dataset.itemId);
            toggleItemSelection(itemId);
        });
    });
    
    // Add event listeners for item title/meta clicks (toggle expand/collapse)
    container.querySelectorAll('[data-toggle-id]').forEach(element => {
        element.addEventListener('click', function() {
            const toggleId = this.dataset.toggleId;
            const isArchive = this.dataset.isArchive === 'true';
            toggleItem(toggleId, isArchive);
        });
    });
    
    // Update checkbox states to match current selection
    updateCheckboxes();
}

function smartQuotes(text) {
    return text
        // Replace double quotes
        .replace(/"([^"]*)"/g, '\u201C$1\u201D')  // Quoted text
        .replace(/(\W|^)"(\w)/g, '$1\u201C$2')  // Opening quote
        .replace(/(\w)"(\W|$)/g, '$1\u201D$2')  // Closing quote
        // Replace single quotes/apostrophes
        .replace(/(\w)'(\w)/g, '$1\u2019$2')  // Apostrophes within words
        .replace(/(\s|^)'(\w)/g, '$1\u2018$2')  // Opening single quote
        .replace(/(\w)'(\s|[,.!?;:]|$)/g, '$1\u2019$2');  // Closing single quote
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return smartQuotes(div.innerHTML);
}

// Initialize event listeners
function initEventListeners() {
    // Setup form submission
    const setupForm = document.getElementById('setupForm');
    if (setupForm) {
        setupForm.addEventListener('submit', saveGitHubConfig);
    }
    
    // Add feed button
    const addFeedButton = document.getElementById('addFeedButton');
    if (addFeedButton) {
        addFeedButton.addEventListener('click', addFeed);
    }
    
    // Feed URL input (Enter key)
    const feedUrlInput = document.getElementById('feedUrl');
    if (feedUrlInput) {
        feedUrlInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addFeed();
            }
        });
    }
    
    // Reload button
    const reloadButton = document.getElementById('reloadButton');
    if (reloadButton) {
        reloadButton.addEventListener('click', () => location.reload());
    }
    
    // Batch delete button
    const batchDeleteButton = document.getElementById('batchDeleteButton');
    if (batchDeleteButton) {
        batchDeleteButton.addEventListener('click', batchDeleteItems);
    }
}

// Initialize
initEventListeners();
checkSetup();
loadData();