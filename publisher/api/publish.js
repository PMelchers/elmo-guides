/* Elmo tool - guide publishing service (Vercel serverless function).
 * The app sends a guide here; this function writes it into the marketplace repository on GitHub with a token
 * that only this service knows (environment variable GITHUB_TOKEN). Nobody needs a GitHub account to publish.
 *
 * Environment variables (Vercel project settings):
 *   GITHUB_TOKEN   fine-grained token with "Contents: read and write" (and "Pull requests: read and write" for review mode)
 *                  on the marketplace repository only
 *   GUIDES_REPO    owner/name of the marketplace repository (default PMelchers/elmo-guides)
 *   PUBLISH_MODE   "direct" (default: the guide appears right away) or "review" (a pull request the owner merges)
 *
 * A published guide gets an id and a secret key. The app keeps the key, so the same person can update their guide later;
 * nobody else can overwrite it. */
const crypto = require('crypto');

const REPO = process.env.GUIDES_REPO || 'PMelchers/elmo-guides';
const BRANCH = process.env.GUIDES_BRANCH || 'main';
const MODE = (process.env.PUBLISH_MODE || 'direct').toLowerCase();
const MAX_BYTES = 4 * 1024 * 1024;
const DATA_IMAGE = /^data:image\/(png|webp|jpeg|gif);base64,[A-Za-z0-9+/=]+$/;

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const str = (v, n) => String(v == null ? '' : v).slice(0, n);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'guide';

async function gh(path, opts) {
	const r = await fetch('https://api.github.com/repos/' + REPO + path, Object.assign({}, opts, {
		headers: { Authorization: 'Bearer ' + process.env.GITHUB_TOKEN, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'elmo-guide-publisher', 'Content-Type': 'application/json' }
	}));
	const body = r.status === 204 ? null : await r.json().catch(() => null);
	return { status: r.status, body };
}

/** Keeps only the parts of a guide the app knows, so nothing else can be smuggled into the repository. */
function clean(g) {
	const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
	const out = {
		title: str(g.title, 120), tag: str(g.tag, 8).toUpperCase(), summary: str(g.summary, 400),
		focus: arr(g.focus, 600), tanks: arr(g.tanks, 40), ships: arr(g.ships, 40), templates: arr(g.templates, 40), text: arr(g.text, 60),
		images: arr(g.images, 40).filter((im) => im && typeof im === 'object').map((im) => ({
			title: str(im.title, 120), caption: str(im.caption, 400), w: +im.w || 0, h: +im.h || 0, data: typeof im.data === 'string' && DATA_IMAGE.test(im.data) ? im.data : null
		})),
		icons: {}
	};
	if (g.icons && typeof g.icons === 'object') Object.entries(g.icons).slice(0, 400).forEach(([k, v]) => { if (/^[a-z0-9_@.-]{1,120}$/.test(k) && typeof v === 'string' && DATA_IMAGE.test(v) && v.length < 400000) out.icons[k] = v; });
	return out;
}

module.exports = async (req, res) => {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
	if (req.method === 'OPTIONS') return res.status(204).end();
	if (req.method === 'GET') return res.status(200).json({ ok: true, service: 'elmo-guide-publisher', repo: REPO, mode: MODE, ready: !!process.env.GITHUB_TOKEN });
	if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
	if (!process.env.GITHUB_TOKEN) return res.status(503).json({ error: 'The publishing service is not set up yet (no GitHub token).' });

	let body = req.body;
	if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = null; } }
	const g = body && body.guide;
	if (!g || typeof g !== 'object' || !Array.isArray(g.focus) || !str(g.title, 120).trim()) return res.status(400).json({ error: 'That is not an Elmo tool guide (it needs a title).' });

	const guide = clean(g);
	guide.author = str(body.author, 40).trim() || 'anonymous';
	guide.published = new Date().toISOString();

	let id = typeof body.id === 'string' && /^[a-z0-9-]{8,80}$/.test(body.id) ? body.id : '';
	let key = typeof body.key === 'string' && body.key.length >= 20 ? body.key : '';
	const path = () => 'guides/' + id + '.json';
	let existing = null;
	if (id) {
		const r = await gh('/contents/' + path() + '?ref=' + BRANCH);
		if (r.status === 200) {
			let old = null;
			try { old = JSON.parse(Buffer.from(r.body.content, 'base64').toString('utf8')); } catch (e) { old = null; }
			if (!old || !old.publisher || old.publisher.keyHash !== sha256(key)) return res.status(403).json({ error: 'This guide was published by someone else. Publish it as a new guide instead.' });
			existing = r.body.sha;
		}
	}
	if (!id) { id = (guide.tag ? guide.tag.toLowerCase() + '-' : '') + slug(guide.title) + '-' + crypto.randomBytes(3).toString('hex'); key = ''; }
	if (!key) key = crypto.randomBytes(18).toString('hex');
	guide.publisher = { id, keyHash: sha256(key) };

	const text = JSON.stringify(guide, null, 1);
	if (Buffer.byteLength(text) > MAX_BYTES) return res.status(413).json({ error: 'The guide is too big to publish (over 4 MB). Use fewer or smaller pictures.' });
	const content = Buffer.from(text, 'utf8').toString('base64');
	const message = (existing ? 'Update guide: ' : 'New guide: ') + guide.title + (guide.tag ? ' (' + guide.tag + ')' : '') + ' by ' + guide.author;

	if (MODE === 'review') {
		const ref = await gh('/git/ref/heads/' + BRANCH);
		if (ref.status !== 200) return res.status(502).json({ error: 'GitHub did not answer (branch).' });
		const branch = 'guide/' + id + '-' + Date.now().toString(36);
		const mk = await gh('/git/refs', { method: 'POST', body: JSON.stringify({ ref: 'refs/heads/' + branch, sha: ref.body.object.sha }) });
		if (mk.status !== 201) return res.status(502).json({ error: 'GitHub did not accept the guide (branch).' });
		const put = await gh('/contents/' + path(), { method: 'PUT', body: JSON.stringify(Object.assign({ message, content, branch }, existing ? { sha: existing } : {})) });
		if (put.status !== 200 && put.status !== 201) return res.status(502).json({ error: 'GitHub did not accept the guide.' });
		const pr = await gh('/pulls', { method: 'POST', body: JSON.stringify({ title: message, head: branch, base: BRANCH, body: 'Published from Elmo tool. Merge to show it in the marketplace.' }) });
		return res.status(200).json({ ok: true, status: 'review', id, key, file: path(), url: pr.body && pr.body.html_url });
	}
	const put = await gh('/contents/' + path(), { method: 'PUT', body: JSON.stringify(Object.assign({ message, content, branch: BRANCH }, existing ? { sha: existing } : {})) });
	if (put.status !== 200 && put.status !== 201) return res.status(502).json({ error: 'GitHub did not accept the guide (' + put.status + ').' });
	return res.status(200).json({ ok: true, status: 'published', id, key, file: path(), updated: !!existing });
};
