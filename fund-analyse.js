(function () {
    // ---------- 从云端加载数据 ----------
    let STORED_DATA = null;

    async function loadCloudData() {
        try {
            const resp = await fetch('data.json');
            if (!resp.ok) throw new Error('数据加载失败');
            STORED_DATA = await resp.json();
            return STORED_DATA;
        } catch (err) {
            console.error(err);
            alert('净值数据加载失败，请刷新页面重试。');
            return null;
        }
    }

    // ---------- 金融计算引擎（风险利率直接从云端数据读取） ----------
    function calcMetrics(dates, prodNV, benchNV) {
        if (dates.length < 2) return null;
        const start = new Date(dates[0]), end = new Date(dates[dates.length - 1]);
        const years = (end - start) / (1000 * 60 * 60 * 24) / 365;
        const prodRets = [], benchRets = [];
        for (let i = 1; i < prodNV.length; i++) {
            prodRets.push(prodNV[i] / prodNV[i - 1] - 1);
            benchRets.push(benchNV[i] / benchNV[i - 1] - 1);
        }
        const pTotal = prodNV[prodNV.length - 1] / prodNV[0] - 1;
        const bTotal = benchNV[benchNV.length - 1] / benchNV[0] - 1;
        const pAnn = Math.pow(1 + pTotal, 1 / years) - 1;
        const bAnn = Math.pow(1 + bTotal, 1 / years) - 1;
        const avgPRet = prodRets.reduce((a, b) => a + b, 0) / prodRets.length;
        const variance = prodRets.reduce((s, r) => s + (r - avgPRet) ** 2, 0) / (prodRets.length - 1);
        const pVol = Math.sqrt(variance) * Math.sqrt(52);
        let peak = prodNV[0], maxDD = 0;
        prodNV.forEach(v => { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < maxDD) maxDD = dd; });
        const minLen = Math.min(prodRets.length, benchRets.length);
        const pR = prodRets.slice(0, minLen), bR = benchRets.slice(0, minLen);
        const avgB = bR.reduce((a, b) => a + b, 0) / bR.length;
        let cov = 0, varB = 0;
        for (let i = 0; i < minLen; i++) { cov += (pR[i] - avgPRet) * (bR[i] - avgB); varB += (bR[i] - avgB) ** 2; }
        const beta = varB ? cov / varB : 1;
        // 直接从 STORED_DATA 读取无风险利率，避免依赖 DOM 元素
        const rf = (STORED_DATA && STORED_DATA.riskFreeRate) ? STORED_DATA.riskFreeRate / 100 : 0.02;
        const alpha = (pAnn - rf) - beta * (bAnn - rf);
        const sharpe = pVol ? (pAnn - rf) / pVol : 0;
        const calmar = maxDD ? pAnn / Math.abs(maxDD) : 0;
        const excess = pR.map((pr, i) => pr - bR[i]);
        return { pTotalRet: pTotal, pAnnRet: pAnn, pAnnVol: pVol, maxDD, sharpe, calmar, beta, alpha, prodReturns: prodRets, benchReturns: benchRets, excessRets: excess };
    }

    function buildSequence(data) {
        const dates = Object.keys(data.weeklyData).sort();
        if (!dates.length) return null;
        const base = data.baseBenchmarkNV || 1.0;
        const prodNV = [], benchNV = [];
        let prev = base;
        dates.forEach(d => {
            const e = data.weeklyData[d];
            prodNV.push(e.prod);
            if (e.open && e.close && e.open !== 0) {
                const r = (e.close - e.open) / e.open;
                prev = prev * (1 + r);
            }
            benchNV.push(prev);
        });
        return { dates, prodNV, benchNV };
    }

    // ---------- 图表 ----------
    let nvChart, ddChart;
    function initCharts() {
        nvChart = echarts.init(document.getElementById('nvChart'));
        ddChart = echarts.init(document.getElementById('ddChart'));
    }
    function updateCharts(dates, prod, bench, dd) {
        if (!nvChart || !ddChart) initCharts();
        nvChart.setOption({
            tooltip: { trigger: 'axis' },
            legend: { data: ['犇势2号', '沪深300 (基准)'], bottom: 0 },
            xAxis: { type: 'category', data: dates },
            yAxis: { type: 'value', min: 'dataMin' },
            series: [
                { name: '犇势2号', type: 'line', data: prod, color: '#2563eb', lineStyle: { width: 3 }, smooth: true, showSymbol: false },
                { name: '沪深300 (基准)', type: 'line', data: bench, color: '#9ca3af', lineStyle: { width: 2, type: 'dashed' }, smooth: true, showSymbol: false }
            ]
        }, { notMerge: true });
        ddChart.setOption({
            tooltip: { trigger: 'axis' },
            xAxis: { type: 'category', data: dates },
            yAxis: { type: 'value', max: 0 },
            series: [{
                name: '回撤', type: 'line', data: dd,
                areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: 'rgba(16,185,129,0.1)' }, { offset: 1, color: 'rgba(16,185,129,0.4)' }]) },
                lineStyle: { color: '#10b981' }, showSymbol: false
            }]
        }, { notMerge: true });
    }

    function updateUI(stored, filterStart = null, filterEnd = null) {
        let filteredData = { ...stored };
        if (filterStart && filterEnd) {
            const start = new Date(filterStart);
            const end = new Date(filterEnd);
            const newWeekly = {};
            Object.keys(stored.weeklyData).forEach(date => {
                const d = new Date(date);
                if (d >= start && d <= end) newWeekly[date] = stored.weeklyData[date];
            });
            filteredData.weeklyData = newWeekly;
        }
        const seq = buildSequence(filteredData);
        if (!seq) return;
        const { dates, prodNV, benchNV } = seq;
        const metrics = calcMetrics(dates, prodNV, benchNV);
        if (!metrics) return;
        const drawdowns = [];
        let peak = prodNV[0];
        prodNV.forEach(v => { if (v > peak) peak = v; drawdowns.push(parseFloat(((v / peak - 1) * 100).toFixed(2))); });

        document.getElementById('latestNV').textContent = prodNV[prodNV.length - 1].toFixed(4);
        document.getElementById('dataRange').textContent = `${dates[0]} 至 ${dates[dates.length - 1]}`;
        document.getElementById('totalRet').textContent = (metrics.pTotalRet * 100).toFixed(2) + '%';
        document.getElementById('annRet').textContent = (metrics.pAnnRet * 100).toFixed(2) + '%';
        document.getElementById('maxDD').textContent = (metrics.maxDD * 100).toFixed(2) + '%';
        document.getElementById('sharpe').textContent = metrics.sharpe.toFixed(2);
        document.getElementById('calmar').textContent = metrics.calmar.toFixed(2);
        document.getElementById('annVol').textContent = (metrics.pAnnVol * 100).toFixed(2) + '%';
        document.getElementById('alphaVal').textContent = (metrics.alpha * 100).toFixed(2) + '%';
        document.getElementById('betaVal').textContent = metrics.beta.toFixed(2);
        document.getElementById('totalRet').className = 'value ' + (metrics.pTotalRet >= 0 ? 'pos' : 'neg');
        document.getElementById('annRet').className = 'value ' + (metrics.pAnnRet >= 0 ? 'pos' : 'neg');
        document.getElementById('maxDD').className = 'value neg';
        document.getElementById('alphaVal').className = 'value ' + (metrics.alpha >= 0 ? 'pos' : 'neg');

        updateCharts(dates, prodNV, benchNV, drawdowns);
        const tbody = document.getElementById('dataTable');
        tbody.innerHTML = '';
        for (let i = dates.length - 1; i >= 0; i--) {
            const pRet = i > 0 ? metrics.prodReturns[i - 1] : null;
            const bRet = i > 0 ? metrics.benchReturns[i - 1] : null;
            const ex = i > 0 ? metrics.excessRets[i - 1] : null;
            const row = document.createElement('tr');
            row.innerHTML = `<td>${dates[i]}</td><td>${prodNV[i].toFixed(4)}</td><td>${benchNV[i].toFixed(4)}</td><td class="${pRet > 0 ? 'pos' : pRet < 0 ? 'neg' : ''}">${pRet !== null ? (pRet * 100).toFixed(2) + '%' : '-'}</td><td class="${bRet > 0 ? 'pos' : bRet < 0 ? 'neg' : ''}">${bRet !== null ? (bRet * 100).toFixed(2) + '%' : '-'}</td><td class="${ex > 0 ? 'pos' : ex < 0 ? 'neg' : ''}" style="font-weight:bold;">${ex !== null ? (ex * 100).toFixed(2) + '%' : '-'}</td>`;
            tbody.appendChild(row);
        }
    }

    // ---------- 导出 PDF（已移除 maintenancePanel 相关代码） ----------
    async function exportPDF() {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);backdrop-filter:blur(4px);z-index:9999;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;';
        overlay.innerHTML = '<div style="background:#1e293b;padding:30px 50px;border-radius:12px;">📄 正在生成极简报告…</div>';
        document.body.appendChild(overlay);
        try {
            await new Promise(resolve => setTimeout(resolve, 300));
            const container = document.getElementById('mainContainer');
            const fullCanvas = await html2canvas(container, { scale: 1.5, useCORS: true, backgroundColor: '#ffffff' });
            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
            const margin = 15, contentW = pageW - 2 * margin, contentH = pageH - 2 * margin;
            const scaleRatio = contentW / fullCanvas.width;
            const imgTotalHeightMM = fullCanvas.height * scaleRatio;
            const totalPages = Math.ceil(imgTotalHeightMM / contentH);
            for (let page = 0; page < totalPages; page++) {
                const startY_px = page * (contentH / scaleRatio);
                const pageHeight_px = Math.min(contentH / scaleRatio, fullCanvas.height - startY_px);
                const pageCanvas = document.createElement('canvas');
                pageCanvas.width = fullCanvas.width;
                pageCanvas.height = pageHeight_px;
                const ctx = pageCanvas.getContext('2d');
                ctx.drawImage(fullCanvas, 0, startY_px, fullCanvas.width, pageHeight_px, 0, 0, fullCanvas.width, pageHeight_px);
                if (page > 0) pdf.addPage();
                const imgData = pageCanvas.toDataURL('image/jpeg', 0.9);
                const imgDisplayHeight = pageHeight_px * scaleRatio;
                pdf.addImage(imgData, 'JPEG', margin, margin + (contentH - imgDisplayHeight) / 2, contentW, imgDisplayHeight);
            }
            const cName = document.getElementById('contactName').value.trim();
            const cPhone = document.getElementById('contactPhone').value.trim();
            let contactStr = '';
            if (cName) contactStr += `联系人：${cName}`;
            if (cPhone) { if (contactStr) contactStr += '      '; contactStr += `电话：${cPhone}`; }
            const pageCount = pdf.internal.getNumberOfPages();
            for (let i = 1; i <= pageCount; i++) {
                pdf.setPage(i);
                pdf.setFontSize(9);
                pdf.setTextColor(128);
                pdf.text(` ${i} / ${pageCount}`, pageW - margin, pageH - 8, { align: 'right' });
                if (contactStr) {
                    const textCanvas = document.createElement('canvas');
                    const tCtx = textCanvas.getContext('2d');
                    const fontSize = 18;
                    tCtx.font = `${fontSize}px "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
                    const textWidth = tCtx.measureText(contactStr).width;
                    textCanvas.width = textWidth + 20;
                    textCanvas.height = fontSize + 16;
                    tCtx.font = `${fontSize}px "Segoe UI", -apple-system, BlinkMacSystemFont, "PingFang SC", "Microsoft YaHei", sans-serif`;
                    tCtx.fillStyle = '#666666';
                    tCtx.textBaseline = 'middle';
                    tCtx.fillText(contactStr, 10, textCanvas.height / 2);
                    const imgW = Math.min(80, textCanvas.width * 0.15);
                    const imgH = (textCanvas.height / textCanvas.width) * imgW;
                    pdf.addImage(textCanvas.toDataURL('image/png'), 'PNG', pageW / 2 - imgW / 2, pageH - 8 - imgH, imgW, imgH);
                }
            }
            pdf.save(`犇势2号_极简报告_${new Date().toISOString().slice(0, 10)}.pdf`);
        } catch (err) {
            console.error(err);
            alert('报告生成失败，请重试');
        } finally {
            document.body.removeChild(overlay);
        }
    }

    // ---------- 联系人自动记忆 ----------
    function saveContact(name, phone) {
        localStorage.setItem('bull_contact', JSON.stringify({ name, phone }));
    }
    function loadContact() {
        const saved = localStorage.getItem('bull_contact');
        if (saved) { try { return JSON.parse(saved); } catch (e) { } }
        return { name: '', phone: '' };
    }

    // ---------- 关于它的一生 ----------
    function showAboutModal() {
        const existing = document.querySelector('.secret-modal-overlay');
        if (existing) existing.remove();
        const overlay = document.createElement('div');
        overlay.className = 'secret-modal-overlay';
        overlay.innerHTML = `
    <div class="secret-modal">
        <span class="close-btn" id="closeSecretModal">&times;</span>
        <h2>犇牛之势 核心基线 (V2.0 云端版)</h2>
        <p style="margin-bottom:0; color:#6b7280;">现在，所有用户看到同一份真实的业绩，不再各自为战。</p>
        <h3>📌 数据层</h3><ul><li>每周由管理员维护云端 data.json，自动同步给所有用户</li><li>东方财富自动抓取行情（管理员专属）</li><li>浏览器仍会记住你的联系人信息</li></ul>
        <h3>📊 分析层</h3><ul><li>累计净值走势、动态回撤、历史收益明细、八大核心指标</li></ul>
        <h3>🖨️ 输出层</h3><ul><li>极简 PDF 报告，底部可印上你的联系方式</li></ul>
        <h3>🕰️ V1.1 时间漫游，V2.0 云端共享</h3><ul><li>自定义分析区间依然可用，但数据源已切换至云端</li></ul>
        <div class="footer-note">本软件目前功能到此为止，但它还年轻，随时可能长出更多触角。</div>
    </div>`;
        document.body.appendChild(overlay);
        overlay.querySelector('#closeSecretModal').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    }

    // ---------- 页面启动 ----------
    document.addEventListener('DOMContentLoaded', async () => {
        const stored = await loadCloudData();
        if (!stored) return;

        // 恢复联系人
        const contact = loadContact();
        document.getElementById('contactName').value = contact.name || '';
        document.getElementById('contactPhone').value = contact.phone || '';

        // 初始化所有分析内容
        updateUI(stored);

        // 日期筛选器默认值
        const allDates = Object.keys(stored.weeklyData).sort();
        if (allDates.length) {
            document.getElementById('startDate').value = allDates[0];
            document.getElementById('endDate').value = allDates[allDates.length - 1];
        }

        // 事件绑定
        document.getElementById('showSecretBtn').addEventListener('click', showAboutModal);

        document.getElementById('applyRangeBtn').addEventListener('click', () => {
            const start = document.getElementById('startDate').value;
            const end = document.getElementById('endDate').value;
            if (!start || !end) { alert('请选择开始和结束日期'); return; }
            if (new Date(start) > new Date(end)) { alert('开始日期不能晚于结束日期'); return; }
            updateUI(stored, start, end);
        });
        document.getElementById('showAllBtn').addEventListener('click', () => {
            if (allDates.length) {
                document.getElementById('startDate').value = allDates[0];
                document.getElementById('endDate').value = allDates[allDates.length - 1];
            }
            updateUI(stored);
        });

        document.getElementById('exportPdfBtn').addEventListener('click', exportPDF);

        document.getElementById('contactName').addEventListener('blur', () => {
            saveContact(
                document.getElementById('contactName').value.trim(),
                document.getElementById('contactPhone').value.trim()
            );
        });
        document.getElementById('contactPhone').addEventListener('blur', () => {
            saveContact(
                document.getElementById('contactName').value.trim(),
                document.getElementById('contactPhone').value.trim()
            );
        });

        window.addEventListener('resize', () => { nvChart?.resize(); ddChart?.resize(); });
    });
})();