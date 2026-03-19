'use strict';
'require baseclass';
'require uci';

let prev = {};
let last_time = Date.now();

(function loadDynamicCSS() {
	let lastLoadedCss = null;

	function isDarkMode() {
		try {
			const bgColor = getComputedStyle(document.body).backgroundColor;
			if (!bgColor || bgColor === 'transparent') return false;
			const rgb = bgColor.match(/\d+/g);
			if (!rgb || rgb.length < 3) return false;
			const [r, g, b] = rgb.map(Number);
			const luminance = (r * 299 + g * 587 + b * 114) / 1000;
			return luminance < 100;
		} catch (e) {
			return false;
		}
	}

	function loadCSS() {
		const dark = isDarkMode();
		const cssFile = dark ? 'netstat_dark.css' : 'netstat.css';
		
		if (lastLoadedCss === cssFile) return;
		lastLoadedCss = cssFile;

		document.querySelectorAll('link[href*="netstat.css"]').forEach(link => {
			if (link.parentNode) link.parentNode.removeChild(link);
		});

		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = '/luci-static/resources/netstat/' + cssFile + '?t=' + Date.now();
		document.head.appendChild(link);
	}

	setTimeout(loadCSS, 100);
	setInterval(loadCSS, 500);
})();

function parseNetdev(raw) {
	const stats = {};
	const lines = raw.split('\n');
	
	for (let line of lines) {
		line = line.trim();
		if (!line || line.startsWith('face') || line.startsWith('|')) continue;

		const match = line.match(/^([^:]+):\s+(.*)$/);
		if (!match) continue;

		const iface = match[1].trim();
		const values = match[2].trim().split(/\s+/).map(v => parseInt(v) || 0);

		if (values.length >= 9) {
			stats[iface] = { rx: values[0], tx: values[8] };
		}
	}
	return stats;
}

function getBestWAN(stats, preferred) {
	for (const iface of preferred) {
		if (stats[iface]) return iface;
	}

	const dynamic = Object.keys(stats).find(i =>
		/^(wwan|usb|ppp|lte|qmi|modem)/.test(i) && i.includes('_')
	);
	if (dynamic) return dynamic;

	const fallback = ['pppoe-wan', 'lte0', 'usb0', 'wan', 'eth1', 'tun0', 'wg0'];
	for (const iface of fallback) {
		if (stats[iface]) return iface;
	}

	const nonLo = Object.keys(stats).filter(k => k !== 'lo');
	return nonLo[0] || 'wwan0_1';
}

function formatRate(bits) {
	const units = ['Bps', 'Kbps', 'Mbps', 'Gbps'];
	let i = 0;
	while (bits >= 1000 && i < units.length - 1) {
		bits /= 1000;
		i++;
	}
	return { number: bits.toFixed(i > 0 ? 1 : 0), unit: units[i] + '/s' };
}

function formatBytes(value) {
	if (value >= 1099511627776) return (value / 1099511627776).toFixed(2) + ' TB';
	if (value >= 1073741824) return (value / 1073741824).toFixed(2) + ' GB';
	if (value >= 1048576) return (value / 1048576).toFixed(2) + ' MB';
	if (value >= 1024) return (value / 1024).toFixed(2) + ' KB';
	return value + ' B';
}

function createStatBox(label, value, unit, extraClass) {
	const cls = extraClass ? 'netstat-box ' + extraClass : 'netstat-box';
	return E('div', { class: cls }, [
		E('div', { class: 'netstat-number' }, value),
		E('div', { class: 'netstat-unit' }, unit || ''),
		E('div', { class: 'netstat-label' }, label)
	]);
}

function createStatusContainer(status, ip) {
	const isConnected = status === 'Connected';
	const statusText = isConnected ? _('Connected') : _('Disconnected');

	return E('div', { class: 'netstat-box netstat-center ' + (isConnected ? 'is-up' : 'is-down') }, [
		E('div', { class: 'netstat-center-title' }, _('INTERNET')),
		E('div', { class: 'netstat-center-status' }, statusText),
		E('div', { class: 'netstat-center-sep' }, ''),
		E('div', { class: 'netstat-center-title' }, _('IP')),
		E('div', { class: 'netstat-center-ip' }, ip)
	]);
}

return baseclass.extend({
	title: _(''),

	load: function () {
		return L.resolveDefault(
			fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
				.then(res => res.json())
				.catch(() => ({ stats: {}, ip: 'N/A', status: 'Disconnected' })),
			{ stats: {}, ip: 'N/A', status: 'Disconnected' }
		).then(result => ({
			stats: result.stats || result || {},
			ip: result.ip || 'N/A',
			status: result.status || 'Disconnected',
			preferred: []
		}));
	},

	render: function (data) {
		const now = Date.now();
		const dt = Math.max(0.1, (now - last_time) / 1000);
		last_time = now;

		const stats = data.stats;
		if (!stats || typeof stats !== 'object') {
			return E('div', { style: 'padding:20px;text-align:center;color:#999;' }, _('Loading network stats...'));
		}

		const iface = getBestWAN(stats, data.preferred || []);
		const curr = stats[iface] || { rx: 0, tx: 0 };

		const prevStat = prev[iface] || curr;

		let rxSpeed = Math.max(0, (curr.rx - prevStat.rx) / dt);
		let txSpeed = Math.max(0, (curr.tx - prevStat.tx) / dt);

		prev[iface] = { rx: curr.rx, tx: curr.tx };

		const rxRate = formatRate(rxSpeed * 8);
		const txRate = formatRate(txSpeed * 8);

		const totalRx = formatBytes(curr.rx);
		const totalTx = formatBytes(curr.tx);

		const container = E('div', { class: 'stats-grid netstat-wrap' });
		const row = E('div', { class: 'netstat-row' });

		row.appendChild(createStatBox(_('download'), rxRate.number, rxRate.unit, 'is-download'));
		row.appendChild(createStatBox(_('upload'), txRate.number, txRate.unit, 'is-upload'));

		const status = data.status || 'Disconnected';
		const ip = data.ip || 'N/A';

		row.appendChild(createStatusContainer(status, ip));

		row.appendChild(createStatBox(_('downloads'), totalRx.split(' ')[0], totalRx.split(' ')[1], 'is-total'));
		row.appendChild(createStatBox(_('uploaded'), totalTx.split(' ')[0], totalTx.split(' ')[1], 'is-total'));

		container.appendChild(row);

		L.Poll.add(() => {
			return fetch('/cgi-bin/luci/admin/tools/get_netdev_stats')
				.then(res => res.json())
				.then(result => this.render({
					stats: result.stats || {},
					ip: result.ip || 'N/A',
					status: result.status || 'Disconnected',
					preferred: []
				}))
				.catch(() => container);
		}, 1000);

		return container;
	}
});