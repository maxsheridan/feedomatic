const fs = require('fs');
const https = require('https');
const http = require('http');
const { DOMParser } = require('xmldom');

let feeds = [];
try {
feeds = JSON.parse(fs.readFileSync('feeds.json', 'utf8'));
} catch (error) {
console.log('No feeds.json found. Creating default.');
feeds = [];
fs.writeFileSync('feeds.json', JSON.stringify(feeds, null, 2));
}

let existingItems = [];
try {
existingItems = JSON.parse(fs.readFileSync('data/items.json', 'utf8'));
} catch (error) {
console.log('No existing items.json found.');
}

function fetchUrl(url) {
return new Promise((resolve, reject) => {
const client = url.startsWith('https') ? https : http;
const req = client.get(url, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
    fetchUrl(res.headers.location).then(resolve).catch(reject);
    return;
    }
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve(data));
});
req.on('error', reject);
req.setTimeout(10000, () => {
    req.destroy();
    reject(new Error('Request timeout'));
});
});
}

function decodeHtmlEntities(text) {
    if (!text) return '';
    return text
        .replace(/&nbsp;|&#160;|&#xA0;/gi, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>');
}

function stripHtml(html) {
    return decodeHtmlEntities(html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim());
}

function summarizeDescription(text, maxLength = 500) {
    const normalized = stripHtml(text);
    if (normalized.length <= maxLength) {
        return normalized;
    }

    const truncated = normalized.slice(0, maxLength);
    let sentenceEndIndex = -1;
    const sentenceEndRegex = /[.?!](?=\s|$)/g;
    let match;
    while ((match = sentenceEndRegex.exec(truncated)) !== null) {
        sentenceEndIndex = match.index + 1;
    }

    if (sentenceEndIndex > 0) {
        return truncated.slice(0, sentenceEndIndex).trim() + '...';
    }

    return truncated.trim() + '...';
}

function parseJsonFeed(json, feedUrl) {
const items = [];

for (const entry of json.items || []) {
const title = entry.title || 'Untitled';
const link = entry.url || entry.external_url || '';
const descriptionSource = entry.content_html ||
                    entry.content_text ||
                    entry.summary || '';
const pubDate = entry.date_published || entry.date_modified || new Date().toISOString();
const guid = entry.id || '';
const itemId = guid || (link + pubDate + title);

items.push({
    id: itemId,
    title: title.trim(),
    link: link.trim(),
    description: summarizeDescription(descriptionSource, 500),
    pubDate: new Date(pubDate).toISOString(),
    feedUrl: feedUrl
});
}

return items;
}

function parseFeed(data, feedUrl) {
const trimmedData = data.trim();
if (trimmedData.startsWith('{') || trimmedData.startsWith('[')) {
    const json = JSON.parse(trimmedData);
    if (json && Array.isArray(json.items)) {
        return parseJsonFeed(json, feedUrl);
    }
}

const xml = data;
const parser = new DOMParser();
const doc = parser.parseFromString(xml, 'text/xml');

const items = [];
let entries = doc.getElementsByTagName('item');
let isAtom = false;

if (entries.length === 0) {
entries = doc.getElementsByTagName('entry');
isAtom = true;
}

for (let i = 0; i < entries.length; i++) {
const entry = entries[i];

const getNodeValue = (tagName) => {
    const node = entry.getElementsByTagName(tagName)[0];
    return node ? node.textContent : '';
};

const title = getNodeValue('title') || 'Untitled';
let link = getNodeValue('link');

if (isAtom && !link) {
    const linkNode = entry.getElementsByTagName('link')[0];
    if (linkNode) link = linkNode.getAttribute('href') || '';
}

const descriptionSource = getNodeValue('description') || 
                    getNodeValue('summary') || 
                    getNodeValue('content') ||
                    getNodeValue('itunes:summary') || '';

const pubDate = getNodeValue('pubDate') || 
                getNodeValue('published') || 
                getNodeValue('updated') ||
                new Date().toISOString();

const guid = getNodeValue('guid') || '';
const itemId = guid || (link + pubDate + title);

items.push({
    id: itemId,
    title: title.trim(),
    link: link.trim(),
    description: summarizeDescription(descriptionSource, 500),
    pubDate: new Date(pubDate).toISOString(),
    feedUrl: feedUrl
});
}

return items;
}

async function fetchAllFeeds() {
// Get current feed URLs as a Set for fast lookup
const currentFeeds = new Set(feeds);

// Filter existing items to only keep those from current feeds
const allItems = existingItems.filter(item => currentFeeds.has(item.feedUrl));
const existingIds = new Set(allItems.map(item => item.id));
let newCount = 0;
const removedCount = existingItems.length - allItems.length;

if (removedCount > 0) {
console.log(`Removed ${removedCount} items from deleted feeds`);
}

for (const feedUrl of feeds) {
try {
    console.log(`Fetching: ${feedUrl}`);
    const xml = await fetchUrl(feedUrl);
    const items = parseFeed(xml, feedUrl);
    
    for (const item of items) {
    if (!existingIds.has(item.id)) {
        allItems.push(item);
        existingIds.add(item.id);
        newCount++;
    }
    }
    
    console.log(`✓ ${feedUrl}: ${items.length} items`);
} catch (error) {
    console.error(`✗ ${feedUrl}: ${error.message}`);
}
}

if (!fs.existsSync('data')) {
fs.mkdirSync('data');
}

fs.writeFileSync('data/items.json', JSON.stringify(allItems, null, 2));

const metadata = {
lastUpdated: new Date().toISOString(),
totalItems: allItems.length,
newItems: newCount,
feedCount: feeds.length
};
fs.writeFileSync('data/metadata.json', JSON.stringify(metadata, null, 2));

console.log(`\n✓ Complete: ${allItems.length} total items (${newCount} new)`);
}

fetchAllFeeds().catch(console.error);