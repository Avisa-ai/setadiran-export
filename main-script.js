// ==UserScript==
// @name         Setadiran - درخواستهای سامانه
// @namespace    http://tampermonkey.net/
// @version      4.11
// @description  Automates navigation, filters columns, with retry mechanism for dropped pages
// @author       Avisa AI
// @match        https://eproc.setadiran.ir/eproc/home.do*
// @match        https://eproc.setadiran.ir/eproc/needAdvancedSearch.do*
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/Avisa-ai/setadiran-export/refs/heads/main/main-script.js
// @downloadURL  https://raw.githubusercontent.com/Avisa-ai/setadiran-export/refs/heads/main/main-script.js
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    let autoState = localStorage.getItem('setad_auto_state');
    let targetPages = parseInt(localStorage.getItem('setad_export_pages') || "30", 10);
    let MAX_PAGES = targetPages;

    // =========================================================================
    // مرحله 0: صفحه اصلی
    // =========================================================================
    if (window.location.href.includes('home.do')) {
        let btn = document.createElement('button');
        btn.textContent = 'شروع اتوماسیون و EXPORT';
        btn.style.cssText = 'position:fixed; bottom:20px; left:20px; z-index:9999; padding:15px; background:red; color:white; font-size:16px; border:none; border-radius:5px; cursor:pointer; font-family:tahoma;';
        document.body.appendChild(btn);

        btn.addEventListener('click', function() {
            let userInput = prompt("چند صفحه استخراج شود؟", "10");
            if (!userInput) return;

            let pages = parseInt(userInput, 10);
            if (isNaN(pages) || pages <= 0) pages = 10;

            localStorage.setItem('setad_export_pages', pages);
            localStorage.setItem('setad_auto_state', 'STEP_1');
            window.location.href = '/eproc/needAdvancedSearch.do';
        });
        return;
    }

    // =========================================================================
    // مرحله 1: تنظیم گروه کالا
    // =========================================================================
    if (window.location.href.includes('needAdvancedSearch.do') && autoState === 'STEP_1') {
        localStorage.setItem('setad_auto_state', 'STEP_2');

        let selectElements = document.querySelectorAll('select');
        for (let sel of selectElements) {
            if (sel.innerHTML.includes('600189')) {
                sel.value = '600189';
                sel.dispatchEvent(new Event('change'));
                break;
            }
        }

        let searchBtn = document.getElementById('btnSerach');
        if (searchBtn) {
            setTimeout(() => searchBtn.click(), 1500);
        }
        return;
    }

    // =========================================================================
    // مرحله 2: رفتن به صفحه 2
    // =========================================================================
    if (window.location.href.includes('needAdvancedSearch.do') && autoState === 'STEP_2') {
        localStorage.setItem('setad_auto_state', 'STEP_3');

        let page2Link = document.querySelector('a[title="برو به صفحه 2"]');
        if (page2Link) {
            setTimeout(() => page2Link.click(), 2500);
        } else {
            alert('لینک صفحه 2 یافت نشد! ممکن است نتایج کمتر از 2 صفحه باشد.');
            localStorage.removeItem('setad_auto_state');
        }
        return;
    }

    // =========================================================================
    // مرحله 3: اجرای عملیات Export
    // =========================================================================
    if (window.location.href.includes('needAdvancedSearch.do') && autoState === 'STEP_3') {
        localStorage.removeItem('setad_auto_state');

        let uiBtn = document.createElement('button');
        uiBtn.textContent = 'در حال استخراج...';
        uiBtn.disabled = true;
        uiBtn.style.cssText = 'position:fixed; bottom:20px; left:20px; z-index:9999; padding:15px; background:orange; color:white; font-size:14px; border:none; border-radius:5px; font-family:tahoma;';
        document.body.appendChild(uiBtn);

        // افزایش زمان تاخیر برای جلوگیری از بلاک شدن توسط سرور
        const DELAY_MIN_MS = 3000;
        const DELAY_MAX_MS = 6500;
        const MAX_RETRIES = 3; // تعداد دفعات تلاش مجدد برای صفحات ناموفق
        const TABLE_ID = 'needAdvancedSearchDisplayTableId';

        const HEADERS = [
            'شماره نیاز (Need No)',
            'شرح کلي نياز (Need Description)',
            'نام دستگاه خريدار (Organization)',
            'استان محل تحويل (Province)',
            'شهر محل تحويل (City)',
            'requestId'
        ];

        const COLS_AFTER_NEEDNO = [2, 3, 4, 5];

        function log(...args) { console.log('[SETAD DEBUG]', ...args); }

        function getTimestamp() {
            let d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}_${String(d.getHours()).padStart(2,'0')}-${String(d.getMinutes()).padStart(2,'0')}`;
        }

        function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
        function randDelay() { return Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1)) + DELAY_MIN_MS; }

        function detectPageParamKeyFromUrl(url) {
            let params = new URLSearchParams(url.split('?')[1] || '');
            for (let k of params.keys()) {
                if (/^d-\d+-?p$/.test(k) || /^d-\d+p$/.test(k)) return k;
            }
            return null;
        }

        function detectPageParamKeyFromHtml(html) {
            let match = html.match(/name="(d-\d+-?p)"/);
            if (match) return match[1];
            match = html.match(/href="[^"]*(d-\d+-?p)=/);
            if (match) return match[1];
            return null;
        }

        function cellText(td) {
            let span = td.querySelector('span[title]');
            if (span && span.getAttribute('title') && span.getAttribute('title') !== 'null') {
                return span.getAttribute('title').trim();
            }
            return td.textContent.trim();
        }

        function extractRowsAndMaybeKey(html) {
            let parser = new DOMParser();
            let doc = parser.parseFromString(html, 'text/html');
            let table = doc.getElementById(TABLE_ID);
            let pageKey = detectPageParamKeyFromHtml(html);
            let rowsData = [];

            if (!table) return { rows: rowsData, pageKey: pageKey };

            let trs = table.querySelectorAll('tbody tr');
            trs.forEach(tr => {
                let tds = tr.querySelectorAll('td');
                if (tds.length > 1) {
                    let needNoLink = tds[1].querySelector('a.hyperlink');
                    let needNo = needNoLink ? needNoLink.textContent.trim() : cellText(tds[1]);

                    let reqId = "";
                    if (needNoLink && needNoLink.getAttribute('onclick')) {
                        let reqMatch = needNoLink.getAttribute('onclick').match(/requestId=([0-9]+)/);
                        if (reqMatch) reqId = reqMatch[1];
                    }

                    let rowData = [needNo];
                    COLS_AFTER_NEEDNO.forEach(idx => {
                        rowData.push(tds[idx] ? cellText(tds[idx]) : "");
                    });
                    rowData.push(reqId);

                    rowsData.push(rowData);
                }
            });
            return { rows: rowsData, pageKey: pageKey };
        }

        async function fetchPage(url) {
            try {
                let res = await fetch(url, { method: 'GET', credentials: 'include', headers: { 'Accept': 'text/html,application/xhtml+xml' }});
                return { status: res.status, text: await res.text() };
            } catch (error) {
                log("Fetch Error:", error);
                return { status: 500, text: "" };
            }
        }

        function toCsv(headers, rows) {
            let csvContent = "\uFEFF" + headers.map(h => `"${h}"`).join(",") + "\n";
            rows.forEach(r => {
                let rowStr = r.map(cell => {
                    let c = (cell || "").toString().replace(/"/g, '""');
                    return `"${c}"`;
                }).join(",");
                csvContent += rowStr + "\n";
            });
            return csvContent;
        }

        function downloadText(filename, text) {
            let blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
            let url = URL.createObjectURL(blob);
            let a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }

        async function runExport() {
            log("شروع استخراج خودکار...");

            let currentUrl = window.location.href;
            let baseUrlObj = new URL(currentUrl);
            let params = baseUrlObj.searchParams;

            let keysToDelete = [];
            for (let k of params.keys()) {
                if (/^d-\d+-?p$/.test(k) || k === 'pager') keysToDelete.push(k);
            }
            keysToDelete.forEach(k => params.delete(k));

            let baseUrlStr = baseUrlObj.toString();
            let pageKey = detectPageParamKeyFromUrl(currentUrl);

            function pageUrl(pageNo, pKey) {
                let char = baseUrlStr.includes('?') ? '&' : '?';
                let url = baseUrlStr + char + 'pager=true';
                if (pKey) url += `&${pKey}=${pageNo}`;
                return url;
            }

            let allRows = [];

            uiBtn.textContent = `در حال دریافت صفحه 1...`;
            let res1 = await fetchPage(pageUrl(1, pageKey));
            let parsed1 = extractRowsAndMaybeKey(res1.text);

            if (!pageKey && parsed1.pageKey) {
                pageKey = parsed1.pageKey;
                res1 = await fetchPage(pageUrl(1, pageKey));
                parsed1 = extractRowsAndMaybeKey(res1.text);
            }

            if (!pageKey) {
                uiBtn.textContent = "خطا: pageKey پیدا نشد!";
                uiBtn.style.background = "red";
                return;
            }

            allRows.push(...parsed1.rows);

            for (let p = 2; p <= MAX_PAGES; p++) {
                let success = false;

                // مکانیزم Retry برای صفحات ناموفق
                for(let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    uiBtn.textContent = `در حال دریافت صفحه ${p} از ${MAX_PAGES} (تلاش ${attempt})...`;

                    let delay = randDelay();
                    await sleep(delay);

                    let res = await fetchPage(pageUrl(p, pageKey));
                    let parsed = extractRowsAndMaybeKey(res.text);

                    if (res.status === 200 && parsed.rows && parsed.rows.length > 0) {
                        allRows.push(...parsed.rows);
                        success = true;
                        break; // دریافت موفق بود، خروج از حلقه تلاش مجدد
                    } else {
                        log(`خطا یا صفحه خالی در صفحه ${p} (تلاش ${attempt}). صبر برای 5 ثانیه...`);
                        await sleep(5000); // 5 ثانیه صبر اضافی در صورت بروز مشکل
                    }
                }

                if (!success) {
                    log(`صفحه ${p} پس از ${MAX_RETRIES} تلاش دریافت نشد. توقف عملیات.`);
                    uiBtn.textContent = `توقف در صفحه ${p} (خطای شبکه/سرور). در حال ساخت فایل خروجی...`;
                    await sleep(2000);
                    break;
                }
            }

            uiBtn.textContent = 'در حال ساخت فایل CSV...';
            let csvStr = toCsv(HEADERS, allRows);
            let fileName = `Setad_Export_${getTimestamp()}.csv`;
            downloadText(fileName, csvStr);

            uiBtn.textContent = `استخراج ${allRows.length} رکورد پایان یافت!`;
            uiBtn.style.background = 'green';
            setTimeout(() => { uiBtn.remove(); }, 5000);
        }

        setTimeout(runExport, 2000);
    }
})();
