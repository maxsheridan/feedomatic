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

function stripHtml(html) {
return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function parseFeed(xml, feedUrl) {
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

const description = getNodeValue('description') || 
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
    description: stripHtml(description).substring(0, 500),
    pubDate: new Date(pubDate).toISOString(),
    feedUrl: feedUrl
});
}

return items;
}

async function fetchAllFeeds() {
const allItems = [...existingItems];
const existingIds = new Set(existingItems.map(item => item.id));
let newCount = 0;

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