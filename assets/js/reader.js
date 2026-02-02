// Storage keys
const READ_ITEMS_KEY = 'rss_read_items';
const SELECTED_FEED_KEY = 'rss_selected_feed';
const GITHUB_CONFIG_KEY = 'rss_github_config';

// GitHub config
let githubConfig = null;

// Data from GitHub
let allFeeds = [];
let allItems = [];
let metadata = {};

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

function saveGitHubConfig() {
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
    
    document.getElementById('setupSection').classList.add('hidden');
    showStatus('Configuration saved! You can now add feeds.', false);
}

function checkSetup() {
    githubConfig = getGitHubConfig();
    if (!githubConfig) {
        document.getElementById('setupSection').classList.remove('hidden');
    } else {
        document.getElementById('setupSection').classList.add('hidden');
    }
}

// Load data from GitHub
async function loadData() {
    try {
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
        
        // Mark items as read based on localStorage
        const readItems = getReadItems();
        allItems.forEach(item => {
            item.read = readItems.has(item.id);
        });
        
        renderFeeds();
        renderItems();
        updateLastUpdatedDisplay();
    } catch (error) {
        console.error('Error loading data:', error);
        document.getElementById('feedList').innerHTML = 
            '<div class="empty-state">Loading feeds... If this persists, make sure GitHub Actions has run at least once.</div>';
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
        showStatus('✓ Feed added! GitHub Actions will fetch items within an hour. Refresh this page in a few minutes.', false);
        
        // Update local state
        allFeeds.push(url);
        renderFeeds();
        
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
    
    if (!confirm(`Remove feed "${getFeedName(url)}"? Items will remain in your archive.`)) return;
    
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
        
        showStatus('✓ Feed removed!', false);
        
        // Update local state
        allFeeds = allFeeds.filter(f => f !== url);
        
        if (getSelectedFeed() === url) {
            setSelectedFeed('all');
        }
        
        renderFeeds();
        renderItems();
        
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

function showStatus(message, isError) {
    const status = document.getElementById('feedStatus');
    status.textContent = message;
    status.className = isError ? 'error' : 'loading';
    
    setTimeout(() => {
        status.textContent = '';
    }, isError ? 10000 : 5000);
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
    allButton.onclick = () => selectFeed('all');
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
        remove.onclick = (e) => {
            e.stopPropagation();
            removeFeed(feed);
        };
        button.appendChild(remove);
        
        button.onclick = () => selectFeed(feed);
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

function toggleItem(itemId) {
    const content = document.getElementById(`content-${itemId}`);
    content.classList.toggle('expanded');
}

function renderItems() {
    const selectedFeed = getSelectedFeed();
    let items = allItems;
    
    // Filter by selected feed
    if (selectedFeed !== 'all') {
        items = items.filter(item => item.feedUrl === selectedFeed);
    }
    
    const newItems = items.filter(item => !item.read)
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    const archiveItems = items.filter(item => item.read)
        .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));
    
    renderItemList('newItems', newItems, false);
    renderItemList('archiveItems', archiveItems, true);
}

function renderItemList(containerId, items, isArchive) {
    const container = document.getElementById(containerId);
    
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">No items</div>';
        return;
    }
    
    container.innerHTML = items.map(item => {
        const date = new Date(item.pubDate).toLocaleDateString();
        const safeId = btoa(encodeURIComponent(item.id)).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
        const escapedId = item.id.replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/`/g, '\\`');
        
        return `
            <div class="item">
                <div class="item-header" onclick="toggleItem('${safeId}')">
                    <div class="item-title">${escapeHtml(item.title)}</div>
                    <div class="item-meta">${date}</div>
                </div>
                <div class="item-content" id="content-${safeId}">
                    <div class="item-description">${escapeHtml(item.description)}</div>
                    <div class="item-actions">
                        <a href="${escapeHtml(item.link)}" target="_blank" rel="noopener noreferrer">Read Full Article</a>
                        ${isArchive ? 
                            `<button onclick='markAsUnread(\`${escapedId}\`)'>Mark as New</button>` :
                            `<button onclick='markAsRead(\`${escapedId}\`)'>Mark as Read</button>`
                        }
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Initialize
checkSetup();
loadData();