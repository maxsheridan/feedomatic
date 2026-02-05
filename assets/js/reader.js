// Storage keys
const READ_ITEMS_KEY = 'rss_read_items';
const SELECTED_FEED_KEY = 'rss_selected_feed';
const GITHUB_CONFIG_KEY = 'rss_github_config';
const FAVORITES_KEY = 'rss_favorites';
const COLLAPSED_SECTIONS_KEY = 'rss_collapsed_sections';
const SUPABASE_CONFIG_KEY = 'rss_supabase_config';

// Supabase configuration
let supabaseClient = null;
let supabaseUserId = null;

// GitHub config
let githubConfig = null;

// Data from GitHub
let allFeeds = [];
let allItems = [];
let metadata = {};

// Initialize Supabase
function initSupabase() {
    const config = getSupabaseConfig();
    if (config && config.url && config.key) {
        try {
            supabaseClient = supabase.createClient(config.url, config.key);
            supabaseUserId = config.userId || 'default';
            return true;
        } catch (error) {
            console.error('Failed to initialize Supabase:', error);
            return false;
        }
    }
    return false;
}

function getSupabaseConfig() {
    const config = localStorage.getItem(SUPABASE_CONFIG_KEY);
    return config ? JSON.parse(config) : null;
}

function saveSupabaseConfig(url, key, userId = 'default') {
    localStorage.setItem(SUPABASE_CONFIG_KEY, JSON.stringify({ url, key, userId }));
}

// Sync favorites to Supabase
async function syncFavoritesToSupabase(favorites) {
    if (!supabaseClient) return;
    
    try {
        const { error } = await supabaseClient
            .from('user_data')
            .upsert({
                user_id: supabaseUserId,
                data_type: 'favorites',
                data: [...favorites],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,data_type' });
        
        if (error) console.error('Failed to sync favorites:', error);
    } catch (error) {
        console.error('Error syncing favorites:', error);
    }
}

// Sync archived items to Supabase
async function syncArchivedToSupabase(readItems) {
    if (!supabaseClient) return;
    
    try {
        const { error } = await supabaseClient
            .from('user_data')
            .upsert({
                user_id: supabaseUserId,
                data_type: 'archived',
                data: [...readItems],
                updated_at: new Date().toISOString()
            }, { onConflict: 'user_id,data_type' });
        
        if (error) console.error('Failed to sync archived items:', error);
    } catch (error) {
        console.error('Error syncing archived items:', error);
    }
}

// Load favorites from Supabase
async function loadFavoritesFromSupabase() {
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('user_data')
            .select('data')
            .eq('user_id', supabaseUserId)
            .eq('data_type', 'favorites')
            .single();
        
        if (error) {
            if (error.code !== 'PGRST116') { // Not found error
                console.error('Failed to load favorites:', error);
            }
            return null;
        }
        return data ? new Set(data.data) : null;
    } catch (error) {
        console.error('Error loading favorites:', error);
        return null;
    }
}

// Load archived items from Supabase
async function loadArchivedFromSupabase() {
    if (!supabaseClient) return null;
    
    try {
        const { data, error } = await supabaseClient
            .from('user_data')
            .select('data')
            .eq('user_id', supabaseUserId)
            .eq('data_type', 'archived')
            .single();
        
        if (error) {
            if (error.code !== 'PGRST116') { // Not found error
                console.error('Failed to load archived items:', error);
            }
            return null;
        }
        return data ? new Set(data.data) : null;
    } catch (error) {
        console.error('Error loading archived items:', error);
        return null;
    }
}

// Selection state for batch operations
let selectedItems = new Set();

// Get read items from localStorage
function getReadItems() {
    return new Set(JSON.parse(localStorage.getItem(READ_ITEMS_KEY) || '[]'));
}

function saveReadItems(readItems) {
    localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...readItems]));
    syncArchivedToSupabase(readItems);
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
    syncFavoritesToSupabase(favorites);
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
    
    // Close Supabase settings if open
    const supabaseSection = document.getElementById('supabaseSection');
    if (supabaseSection && !supabaseSection.classList.contains('hidden')) {
        supabaseSection.classList.add('hidden');
        const syncButton = document.getElementById('syncButton');
        if (syncButton) syncButton.classList.remove('active');
    }
    
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

function toggleSyncSettings() {
    const supabaseSection = document.getElementById('supabaseSection');
    const syncButton = document.getElementById('syncButton');
    const isHidden = supabaseSection.classList.contains('hidden');
    
    // Close GitHub settings if open
    const setupSection = document.getElementById('setupSection');
    if (setupSection && !setupSection.classList.contains('hidden')) {
        setupSection.classList.add('hidden');
        const settingsButton = document.getElementById('settingsButton');
        if (settingsButton) settingsButton.classList.remove('active');
    }
    
    if (isHidden) {
        // Pre-fill form with existing values
        const config = getSupabaseConfig();
        if (config) {
            document.getElementById('supabaseUrl').value = config.url || '';
            document.getElementById('supabaseKey').value = config.key || '';
            document.getElementById('supabaseUserId').value = config.userId || '';
        }
        
        supabaseSection.classList.remove('hidden');
        syncButton.classList.add('active');
        supabaseSection.scrollIntoView({ behavior: 'smooth' });
    } else {
        // Closing settings
        supabaseSection.classList.add('hidden');
        syncButton.classList.remove('active');
    }
}

function clearSupabaseConfig() {
    if (confirm('This will clear your Supabase sync settings. Your local data will remain. Continue?')) {
        localStorage.removeItem(SUPABASE_CONFIG_KEY);
        supabaseClient = null;
        supabaseUserId = null;
        
        document.getElementById('supabaseUrl').value = '';
        document.getElementById('supabaseKey').value = '';
        document.getElementById('supabaseUserId').value = '';
        
        alert('Sync settings cleared. Sync is now disabled.');
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
        // Initialize Supabase if configured
        initSupabase();
        
        // Load from Supabase if available, otherwise use localStorage
        let readItems, favorites;
        
        if (supabaseClient) {
            const [supabaseArchived, supabaseFavorites] = await Promise.all([
                loadArchivedFromSupabase(),
                loadFavoritesFromSupabase()
            ]);
            
            // Merge Supabase data with localStorage, preferring Supabase
            readItems = supabaseArchived || getReadItems();
            favorites = supabaseFavorites || getFavorites();
            
            // Update localStorage with Supabase data
            if (supabaseArchived) {
                localStorage.setItem(READ_ITEMS_KEY, JSON.stringify([...supabaseArchived]));
            }
            if (supabaseFavorites) {
                localStorage.setItem(FAVORITES_KEY, JSON.stringify([...supabaseFavorites]));
            }
        } else {
            readItems = getReadItems();
            favorites = getFavorites();
        }
        
        // Load feeds
        const feedsResponse = await fetch('feeds.json?' + Date.now());
        allFeeds = await feedsResponse.json();
        
        // Load items
        const itemsResponse = await fetch('data/items.json?' + Date.now());
        allItems = await itemsResponse.json();
        
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
        const currentFeeds = JSON.parse(atob(fileData.content));
        
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
                content: btoa(JSON.stringify(currentFeeds, null, 2)),
                sha: fileData.sha
            })
        });
        
        if (!updateResponse.ok) {
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
        const currentFeeds = JSON.parse(atob(fileData.content));
        
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
                content: btoa(JSON.stringify(updatedFeeds, null, 2)),
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
    allFeeds.forEach(feed => {
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

async function deleteItem(itemId) {
    if (!githubConfig) {
        showStatus('Cannot delete item: GitHub config missing', true);
        return;
    }
    
    const item = allItems.find(i => i.id === itemId);
    if (!item) return;
    
    if (!confirm(`Permanently delete "${item.title}"? This cannot be undone.`)) return;
    
    showStatus('Deleting item...', false);
    
    try {
        const { user, repo, token } = githubConfig;
        const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/data/items.json`;
        
        // Get current items.json
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch items.json');
        }
        
        const fileData = await getResponse.json();
        const currentItems = JSON.parse(atob(fileData.content));
        
        // Remove the item
        const updatedItems = currentItems.filter(i => i.id !== itemId);
        
        // Update items.json
        const updateResponse = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Delete item: ${item.title}`,
                content: btoa(JSON.stringify(updatedItems, null, 2)),
                sha: fileData.sha
            })
        });
        
        if (!updateResponse.ok) {
            throw new Error('Failed to update items.json');
        }
        
        // Remove from local state
        allItems = allItems.filter(i => i.id !== itemId);
        
        // Remove from localStorage read items
        const readItems = getReadItems();
        readItems.delete(itemId);
        saveReadItems(readItems);
        
        renderItems();
        showStatus('✓ Item deleted', false);
        
    } catch (error) {
        console.error('Error deleting item:', error);
        showStatus(`✗ ${error.message}`, true);
    }
}

function toggleItem(itemId, isArchive) {
    const content = document.getElementById(`content-${itemId}`);
    const isCurrentlyExpanded = content.classList.contains('expanded');
    
    if (!isArchive) {
        // For new items, close all others (single open)
        document.querySelectorAll('#newItems .item-content.expanded').forEach(item => {
            item.classList.remove('expanded');
        });
    }
    // For archive items, allow multiple to stay open
    
    // Toggle the clicked item
    if (!isCurrentlyExpanded) {
        content.classList.add('expanded');
    } else {
        content.classList.remove('expanded');
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
    if (!githubConfig) {
        showStatus('Cannot delete items: GitHub config missing', true);
        return;
    }
    
    if (selectedItems.size === 0) return;
    
    if (!confirm(`Permanently delete ${selectedItems.size} item(s)? This cannot be undone.`)) return;
    
    showStatus('Deleting items...', false);
    
    try {
        const { user, repo, token } = githubConfig;
        const apiUrl = `https://api.github.com/repos/${user}/${repo}/contents/data/items.json`;
        
        // Get current items.json
        const getResponse = await fetch(apiUrl, {
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json'
            }
        });
        
        if (!getResponse.ok) {
            throw new Error('Failed to fetch items.json');
        }
        
        const fileData = await getResponse.json();
        const currentItems = JSON.parse(atob(fileData.content));
        
        // Remove selected items
        const updatedItems = currentItems.filter(i => !selectedItems.has(i.id));
        
        // Update items.json
        const updateResponse = await fetch(apiUrl, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: `Delete ${selectedItems.size} items`,
                content: btoa(JSON.stringify(updatedItems, null, 2)),
                sha: fileData.sha
            })
        });
        
        if (!updateResponse.ok) {
            throw new Error('Failed to update items.json');
        }
        
        // Remove from local state
        allItems = allItems.filter(i => !selectedItems.has(i.id));
        
        // Remove from localStorage read items
        const readItems = getReadItems();
        selectedItems.forEach(id => readItems.delete(id));
        saveReadItems(readItems);
        
        // Clear selection
        selectedItems.clear();
        
        renderItems();
        showStatus(`✓ ${updatedItems.length !== currentItems.length ? currentItems.length - updatedItems.length : 0} item(s) deleted`, false);
        
    } catch (error) {
        console.error('Error deleting items:', error);
        showStatus(`✗ ${error.message}`, true);
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
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const archiveItems = items.filter(item => item.read && !favorites.has(item.id))
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
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
        const safeId = `${containerId}-${index}`;
        const encodedId = encodeURIComponent(item.id);
        const isFavorited = favorites.has(item.id);
        
        return `
            <div class="item">
                <div class="item-header">
                    ${isArchive ? `<input type="checkbox" class="item-checkbox" data-item-id="${encodedId}">` : ''}
                    <div class="item-title" data-toggle-id="${safeId}" data-is-archive="${isArchive}">${escapeHtml(item.title)}</div>
                    <div class="item-meta" data-toggle-id="${safeId}" data-is-archive="${isArchive}">${date}</div>
                </div>
                <div class="item-content" id="content-${safeId}">
                    <div class="item-inner">
                        <div class="item-description">${escapeHtml(item.description)}</div>
                        <div class="item-actions">
                            <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer" class="button-link">Read Article</a>
                            ${isArchive ? 
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="unread">Mark as New</button>
                                <button class="delete-button" data-item-id="${encodedId}" data-action="delete">Delete</button>` :
                                isFavorites ?
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="read">Archive Article</button>` :
                                `<button class="mark-button" data-item-id="${encodedId}" data-action="read">Mark as Read</button>
                                <button class="favorite-button" data-item-id="${encodedId}">Add to Favorites</button>
                                <button class="copy-link-button" data-item-link="${item.link}">Copy Link</button>`
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
            if (action === 'read') {
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
        element.addEventListener('click', function(e) {
            const toggleId = this.dataset.toggleId;
            const isArchive = this.dataset.isArchive === 'true';
            toggleItem(toggleId, isArchive);
        }, { passive: true });
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
    
    // Supabase form submission
    const supabaseForm = document.getElementById('supabaseForm');
    if (supabaseForm) {
        supabaseForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const url = document.getElementById('supabaseUrl').value.trim();
            const key = document.getElementById('supabaseKey').value.trim();
            const userId = document.getElementById('supabaseUserId').value.trim();
            
            if (url && key && userId) {
                saveSupabaseConfig(url, key, userId);
                
                // Initialize Supabase with new config
                if (initSupabase()) {
                    alert('Sync settings saved! Reloading to sync data...');
                    location.reload();
                } else {
                    alert('Settings saved, but failed to connect to Supabase. Check your credentials.');
                }
            }
        });
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